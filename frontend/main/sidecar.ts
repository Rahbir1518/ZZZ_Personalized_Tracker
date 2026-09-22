import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { app } from 'electron'

export interface SidecarHandle {
  /** Base URL of the running sidecar, e.g. http://127.0.0.1:53124 */
  origin: string
  /** Shared secret the renderer must send as X-Sidecar-Token on every request. */
  token: string
}

let child: ChildProcessWithoutNullStreams | null = null
let handle: SidecarHandle | null = null

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

/** Poll /health until the sidecar answers or we give up. */
async function waitForReady(origin: string, token: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown = null

  while (Date.now() < deadline) {
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

  const port = await findFreePort()
  const token = randomBytes(32).toString('hex')
  const origin = `http://127.0.0.1:${port}`
  const { cmd, baseArgs } = resolveCommand()

  child = spawn(
    cmd,
    [...baseArgs, '--port', String(port), '--token', token, '--data-dir', app.getPath('userData')],
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
    console.warn(`[sidecar] exited code=${code} signal=${signal}`)
    child = null
    handle = null
  })

  await waitForReady(origin, token)
  handle = { origin, token }
  return handle
}

export function getSidecar(): SidecarHandle | null {
  return handle
}

export function stopSidecar(): void {
  if (child === null) return
  // SIGTERM is not meaningful on Windows; kill() maps to TerminateProcess.
  child.kill()
  child = null
  handle = null
}
