import { createServer, type Server } from 'node:http'
import { randomBytes } from 'node:crypto'
import { BrowserWindow } from 'electron'

/**
 * The legitimate alternative to the sidecar's `primp` transport
 * (backend/zzz_sidecar/prydwen/transport.py): instead of a Python HTTP
 * client spoofing a Chrome TLS fingerprint to slip past Prydwen's Cloudflare
 * challenge, this loads the page in a *real* Chromium `BrowserWindow`. The
 * ordinary invisible JS challenge clears itself the way it would for any
 * visitor; if Cloudflare ever serves an interactive one instead, the window
 * is shown so an actual human can click it.
 *
 * The sidecar is a separate OS process (spawned by sidecar.ts) with no
 * access to Chromium, so this exposes a tiny loopback-only HTTP endpoint for
 * it to call — the same shape as the sidecar's own API: bound to 127.0.0.1,
 * gated by a random per-run bearer token, one purpose only.
 */

export interface BrowserFetchHandle {
  origin: string
  token: string
}

//: Mirrors backend/zzz_sidecar/prydwen/transport.py's `_ALLOWED_PATH_RE`.
//: Kept in sync by hand deliberately — this is a second, independent check,
//: not a shared source of truth; the Python side is still the one that
//: decides what a caller is allowed to ask for.
const ALLOWED_PATH_RE = /^\/zenless\/characters(?:\/[a-z0-9][a-z0-9-]*)?$/
const BASE_URL = 'https://www.prydwen.gg'

//: How long to wait for the ordinary, invisible Cloudflare JS challenge to
//: clear itself before concluding a human needs to see the window.
const AUTO_CLEAR_TIMEOUT_MS = 20_000
//: How long to leave the window visible waiting for a human to clear an
//: interactive challenge, once shown.
const INTERACTIVE_TIMEOUT_MS = 90_000
const POLL_INTERVAL_MS = 500

let win: BrowserWindow | null = null
//: Single-flight: the crawl-delay gate on the Python side already serializes
//: requests to one at a time, but this is the same "don't trust the caller,
//: be the final safety boundary" posture transport.py itself documents —
//: two navigations racing on one shared window would otherwise interleave.
let queue: Promise<unknown> = Promise.resolve()

function getWindow(): BrowserWindow {
  if (win !== null && !win.isDestroyed()) return win
  win = new BrowserWindow({
    width: 1200,
    height: 900,
    show: false,
    webPreferences: {
      // Real third-party content runs here (Prydwen's own page, Cloudflare's
      // challenge script) — same hardening as the main UI window, no preload,
      // no Node access, nothing this page can reach back into the app with.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      // Persistent partition: a cleared Cloudflare challenge sets a
      // `cf_clearance` cookie, and keeping it around (across fetches, and
      // across app restarts) means most requests after the first one never
      // need to show the window at all.
      partition: 'persist:prydwen-fetch'
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.on('closed', () => {
    win = null
  })
  return win
}

async function isChallengePage(target: BrowserWindow): Promise<boolean> {
  try {
    return await target.webContents.executeJavaScript(`(() => {
      const t = document.title || '';
      if (/just a moment/i.test(t) || /attention required/i.test(t)) return true;
      if (document.querySelector('#challenge-running, #cf-challenge-running, .cf-turnstile, #challenge-form')) return true;
      return false;
    })()`)
  } catch {
    // The page navigated away mid-check (e.g. the challenge just cleared)
    // — treat that as "no longer a challenge" rather than an error.
    return false
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForChallengeToClear(target: BrowserWindow): Promise<void> {
  const autoDeadline = Date.now() + AUTO_CLEAR_TIMEOUT_MS
  while (Date.now() < autoDeadline) {
    if (!(await isChallengePage(target))) return
    await sleep(POLL_INTERVAL_MS)
  }

  // Still challenged after the auto-clear window: this is presumably an
  // interactive one (a visible Turnstile checkbox), so a human needs to see
  // it. Showing a window the user didn't ask to see is unusual, but it's the
  // one case where that's the entire point — the alternative is failing the
  // sync silently for no reason a person could act on.
  target.show()
  target.focus()
  try {
    const interactiveDeadline = Date.now() + INTERACTIVE_TIMEOUT_MS
    while (Date.now() < interactiveDeadline) {
      if (!(await isChallengePage(target))) return
      await sleep(POLL_INTERVAL_MS)
    }
    throw new Error('Cloudflare challenge was not cleared in time')
  } finally {
    target.hide()
  }
}

async function fetchHtml(path: string): Promise<string> {
  if (!ALLOWED_PATH_RE.test(path)) {
    throw new Error(`Refusing to fetch a disallowed path: ${path}`)
  }

  const target = getWindow()
  const url = `${BASE_URL}${path}`

  await target.loadURL(url)
  await waitForChallengeToClear(target)

  const html: string = await target.webContents.executeJavaScript(
    'document.documentElement.outerHTML'
  )
  if (html.trim() === '') {
    throw new Error(`Loaded ${path} but the document was empty`)
  }
  return html
}

/** Runs `fetchHtml` after every fetch already queued ahead of it, so at most
 * one navigation ever happens on the shared window at a time. */
function fetchHtmlSerialized(path: string): Promise<string> {
  const result = queue.then(() => fetchHtml(path))
  // Swallow so one failed fetch doesn't wedge the queue for the next one —
  // the caller below still sees (and reports) the real rejection.
  queue = result.catch(() => undefined)
  return result
}

export async function startBrowserFetchServer(): Promise<BrowserFetchHandle> {
  const token = randomBytes(32).toString('hex')

  const server: Server = createServer((req, res) => {
    void (async () => {
      if (req.method !== 'POST' || req.url !== '/fetch') {
        res.writeHead(404).end()
        return
      }
      if (req.headers['x-browser-fetch-token'] !== token) {
        res.writeHead(403).end()
        return
      }

      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(chunk as Buffer)

      let path: unknown
      try {
        path = JSON.parse(Buffer.concat(chunks).toString('utf-8')).path
      } catch {
        res.writeHead(400).end()
        return
      }
      if (typeof path !== 'string') {
        res.writeHead(400).end()
        return
      }

      try {
        const html = await fetchHtmlSerialized(path)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ html }))
      } catch (err) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ html: '', error: err instanceof Error ? err.message : String(err) }))
      }
    })()
  })

  const origin = await new Promise<string>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr === null || typeof addr === 'string') {
        reject(new Error('Could not determine the browser-fetch server address'))
        return
      }
      resolve(`http://127.0.0.1:${addr.port}`)
    })
  })

  return { origin, token }
}
