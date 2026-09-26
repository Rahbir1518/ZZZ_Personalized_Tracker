import { app, ipcMain, type WebContents } from 'electron'
import { autoUpdater } from 'electron-updater'
import { logMain, logMainError } from './log'

/**
 * "Check for updates" in Settings. Only ever runs when the person presses the
 * button — nothing checks on launch or in the background.
 *
 * The source is this project's public GitHub Releases (the `publish` block in
 * electron-builder.yml): the check reads the release's `latest.yml`, and the
 * download is the installer attached to that release. No account data, and
 * nothing identifying the person, is sent — it is an ordinary anonymous
 * download from GitHub.
 *
 * Unsigned builds still update: electron-updater verifies the download's
 * SHA-512 against `latest.yml` before running it.
 */

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'unsupported'; message: string }
  | { state: 'up-to-date'; version: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

let current: UpdateState = { state: 'idle' }
let target: WebContents | null = null

function publish(next: UpdateState): void {
  current = next
  if (target !== null && !target.isDestroyed()) target.send('update:state', next)
}

export function registerUpdater(): void {
  // Download only when asked: the person sees the version first and chooses.
  autoUpdater.autoDownload = false
  // Closing the app normally after a download does not install behind the
  // person's back; the Settings button is the one way in.
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.logger = {
    info: (m: unknown) => logMain(`[updater] ${String(m)}`),
    warn: (m: unknown) => logMain(`[updater] ${String(m)}`),
    error: (m: unknown) => logMainError('[updater]', m),
    debug: () => undefined
  }

  autoUpdater.on('update-available', (info) => publish({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () =>
    publish({ state: 'up-to-date', version: app.getVersion() })
  )
  autoUpdater.on('download-progress', (progress) => {
    if (current.state === 'downloading' || current.state === 'available') {
      publish({
        state: 'downloading',
        version: current.version,
        percent: Math.round(progress.percent)
      })
    }
  })
  autoUpdater.on('update-downloaded', (info) => publish({ state: 'ready', version: info.version }))
  autoUpdater.on('error', (err) =>
    publish({ state: 'error', message: err instanceof Error ? err.message : String(err) })
  )

  ipcMain.handle('update:state', (event) => {
    target = event.sender
    return current
  })

  ipcMain.handle('update:check', async (event) => {
    target = event.sender
    if (!app.isPackaged) {
      publish({
        state: 'unsupported',
        message: 'Updates only work in the installed app, not in development.'
      })
      return current
    }
    if (current.state === 'downloading' || current.state === 'ready') return current

    publish({ state: 'checking' })
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      publish({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return current
  })

  ipcMain.handle('update:download', async () => {
    if (current.state !== 'available') return current
    publish({ state: 'downloading', version: current.version, percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      publish({ state: 'error', message: err instanceof Error ? err.message : String(err) })
    }
    return current
  })

  ipcMain.handle('update:install', () => {
    if (current.state !== 'ready') return
    // Quits the app (which stops the sidecar via before-quit) and runs the
    // installer. isSilent=false shows the normal installer; forceRunAfter
    // reopens the app once it finishes.
    autoUpdater.quitAndInstall(false, true)
  })
}
