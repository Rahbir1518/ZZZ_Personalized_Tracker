import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * A packaged Electron app on Windows is normally a GUI-subsystem executable
 * with no attached console — `console.log`/`console.error` go nowhere a user
 * (or a bug report) can ever recover, even when the process is launched from
 * a terminal with stdio redirected. Startup failures in particular (sidecar
 * didn't spawn, single-instance lock behaved unexpectedly) need *some*
 * durable trail, since "please file an issue with the terminal log" isn't
 * something most users can actually produce.
 *
 * This writes to <userData>/main.log alongside the console, best-effort — a
 * failure to write the log itself must never be what crashes startup.
 */
function logPath(): string {
  return join(app.getPath('userData'), 'main.log')
}

export function logMain(message: string): void {
  console.log(message)
  try {
    appendFileSync(logPath(), `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // Logging is a diagnostic nicety, not a requirement — never let a failed
    // write (e.g. userData not yet created) take down startup.
  }
}

export function logMainError(context: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  logMain(`${context}: ${detail}`)
}
