import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'
import { startBrowserFetchServer } from './browserFetch'
import { logMain, logMainError } from './log'

export interface SidecarHandle {
  /** Base URL of the running sidecar, e.g. http://127.0.0.1:53124 */
  origin: string
  /** Shared secret the renderer must send as X-Sidecar-Token on every request. */
  token: string
}

let child: ChildProcessWithoutNullStreams | null = null
let handle: SidecarHandle | null = null
//: Set by the child's 'error' event — spawn() failing to actually launch the
//: exe (missing, blocked by antivirus, permission denied) surfaces there,
//: asynchronously, not as a synchronous throw from spawn() itself. Checked by
//: waitForReady() so that case fails fast with the real reason instead of
//: silently retrying /health for the full 30s timeout.
let spawnError: Error | null = null

/** Ask the OS for a free ephemeral port, then release it for the sidecar. */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr === null || typeof addr === 'string') {
        srv.close(() => reject(new Error('Could not determine a free port')))
        return
      }
      const { port } = addr
      srv.close(() => resolve(port))
    })
  })
}

/**
 * In development we run the sidecar from the local venv so edits take effect
 * without a rebuild. In production we spawn the PyInstaller binary that
 * electron-builder unpacked into resources/sidecar/.
 */
function resolveCommand(): { cmd: string; baseArgs: string[] } {
  if (app.isPackaged) {
    const exe = join(process.resourcesPath, 'sidecar', 'zzz-sidecar.exe')
    if (!existsSync(exe)) {
      throw new Error(
        `Sidecar binary missing at ${exe}. Run "npm run sidecar:build" before packaging.`
      )
    }
    return { cmd: exe, baseArgs: [] }
  }

  const venvPython = join(app.getAppPath(), 'backend', '.venv', 'Scripts', 'python.exe')
  const python = existsSync(venvPython) ? venvPython : 'python'
  return { cmd: python, baseArgs: ['-m', 'zzz_sidecar'] }
}

/** Narrows an arbitrary string to a valid transport name, or undefined. */
function asTransport(value: string | undefined): 'primp' | 'httpx' | 'browser' | undefined {
  return value === 'primp' || value === 'httpx' || value === 'browser' ? value : undefined
}

/**
 * Which `prydwen/transport.py` implementation the sidecar should fetch guide
 * pages through — see that module's docstring for what each one does.
 * Three layers, checked in order:
 *
 * 1. `ZZZ_PRYDWEN_TRANSPORT`, a *runtime* environment variable — the fast
 *    override for `npm run dev`, so you can flip to `browser` for a quick
 *    check without rebuilding anything:
 *
 *        $env:ZZZ_PRYDWEN_TRANSPORT = 'browser'; npm run dev
 *
 * 2. `__ZZZ_DIST_TRANSPORT__`, baked in at **build time** by
 *    electron.vite.config.ts from the `ZZZ_DIST_TRANSPORT` env var that was
 *    set when `npm run dist` ran — this is what decides what a *packaged*
 *    installer permanently ships with, independent of anything on the
 *    machine that later runs it:
 *
 *        $env:ZZZ_DIST_TRANSPORT = 'primp'; npm run dist    # your own build
 *        npm run dist                                       # public default: browser
 *
 * 3. The fallback: `primp` in dev (fast local iteration), `browser` in an
 *    unlabelled packaged build (the safe default for anyone downloading the
 *    installer without having set `ZZZ_DIST_TRANSPORT` at all).
 */
function resolvePrydwenTransport(): 'primp' | 'httpx' | 'browser' {
  const runtimeOverride = asTransport(process.env['ZZZ_PRYDWEN_TRANSPORT'])
  if (runtimeOverride !== undefined) return runtimeOverride

  if (app.isPackaged) {
    const bakedIn = asTransport(__ZZZ_DIST_TRANSPORT__)
    return bakedIn ?? 'browser'
  }
  return 'primp'
}

/** Poll /health until the sidecar answers or we give up. */
async function waitForReady(origin: string, token: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null

  while (Date.now() < deadline) {
    if (spawnError !== null) {
      throw new Error(`Sidecar failed to launch: ${spawnError.message}`)
    }
    if (child !== null && child.exitCode !== null) {
      throw new Error(`Sidecar exited early with code ${child.exitCode}`)
    }
    try {
      const res = await fetch(`${origin}/health`, { headers: { 'X-Sidecar-Token': token } })
      if (res.ok) return
      lastError = new Error(`health returned ${res.status}`)
    } catch (err) {
      lastError = err
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  throw new Error(`Sidecar did not become ready in ${timeoutMs}ms: ${String(lastError)}`)
}

export async function startSidecar(): Promise<SidecarHandle> {
  if (handle !== null) return handle
  spawnError = null

  const port = await findFreePort()
  const token = randomBytes(32).toString('hex')
  const origin = `http://127.0.0.1:${port}`
  const { cmd, baseArgs } = resolveCommand()

  const prydwenTransport = resolvePrydwenTransport()
  const transportArgs: string[] = ['--prydwen-transport', prydwenTransport]
  if (prydwenTransport === 'browser') {
    // Only spun up when actually needed — no hidden BrowserWindow exists at
    // all while running primp/httpx.
    const browserFetch = await startBrowserFetchServer()
    transportArgs.push(
      '--browser-fetch-origin',
      browserFetch.origin,
      '--browser-fetch-token',
      browserFetch.token
    )
  }

  child = spawn(
    cmd,
    [
      ...baseArgs,
      '--port',
      String(port),
      '--token',
      token,
      '--data-dir',
      app.getPath('userData'),
      // The sidecar exits on its own when this process does, so a crash or a
      // Task Manager kill of the app can't leave it orphaned (stopSidecar
      // only runs on a normal quit).
      '--parent-pid',
      String(process.pid),
      ...transportArgs
    ],
    {
      cwd: app.isPackaged ? undefined : join(app.getAppPath(), 'backend'),
      windowsHide: true,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONUTF8: '1' }
    }
  ) as ChildProcessWithoutNullStreams

  // The sidecar never logs credentials; forwarding its output is safe and makes
  // Python tracebacks visible in the Electron terminal during development.
  child.stdout.on('data', (d: Buffer) => process.stdout.write(`[sidecar] ${d.toString()}`))
  child.stderr.on('data', (d: Buffer) => process.stderr.write(`[sidecar] ${d.toString()}`))
  child.on('exit', (code, signal) => {
    logMain(`[sidecar] exited code=${code} signal=${signal}`)
    child = null
    handle = null
  })
  // spawn() itself does not throw for a bad/blocked/missing exe on Windows —
  // that surfaces here instead, asynchronously (ENOENT, EACCES, antivirus
  // having quarantined the freshly-built PyInstaller binary, etc.).
  child.on('error', (err) => {
    logMainError('[sidecar] failed to launch', err)
    spawnError = err
  })

  try {
    await waitForReady(origin, token)
  } catch (err) {
    logMainError('[sidecar] never became ready', err)
    throw err
  }
  handle = { origin, token }
  logMain(`[sidecar] ready at ${origin}`)
  return handle
}

export function getSidecar(): SidecarHandle | null {
  return handle
}

export function stopSidecar(): void {
  if (child === null) return
  const pid = child.pid
  // The packaged sidecar is a PyInstaller one-file exe: a bootloader process
  // that unpacks and then runs the real Python server as its *child*.
  // kill() (TerminateProcess) only stops the bootloader, orphaning the server
  // — which then holds zzz-sidecar.exe open and blocks both rebuilding it and
  // an update's installer from replacing it. /T takes the whole tree.
  if (process.platform === 'win32' && pid !== undefined) {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
  } else {
    child.kill()
  }
  child = null
  handle = null
}
