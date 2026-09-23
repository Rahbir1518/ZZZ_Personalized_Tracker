import { join } from 'node:path'
import { app, shell, BrowserWindow } from 'electron'
import { startSidecar, stopSidecar } from './sidecar'
import { registerIpc } from './ipc'
import { logMain, logMainError } from './log'

let mainWindow: BrowserWindow | null = null

// An uncaught error anywhere in main-process startup would otherwise just
// crash the process silently on a GUI-subsystem Windows build — nothing
// prints, nothing shows, the app just isn't there a moment later.
process.on('uncaughtException', (err) => logMainError('Uncaught exception', err))
process.on('unhandledRejection', (err) => logMainError('Unhandled rejection', err))

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#f4efe1',
    autoHideMenuBar: true,
    title: 'ZZZ Team Tracker',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Hardening: the renderer is untrusted UI code with no Node access.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Without this, a closed window leaves `mainWindow` pointing at a
  // destroyed BrowserWindow instead of null — the next 'second-instance'
  // event (someone relaunching while this process is still alive) would then
  // call .isMinimized()/.focus() on it and throw "Object has been
  // destroyed", crashing the still-running instance instead of just
  // refocusing a window that no longer exists.
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Anything trying to open a new window goes to the user's real browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Block in-page navigation away from our own UI.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devServer = process.env['ELECTRON_RENDERER_URL']
    const isOwnUi = devServer !== undefined ? url.startsWith(devServer) : url.startsWith('file://')
    if (!isOwnUi) event.preventDefault()
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl !== undefined) {
    void mainWindow.loadURL(rendererUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Only ever one instance, so two copies cannot race on the credential file.
if (!app.requestSingleInstanceLock()) {
  // Previously silent: on a GUI-subsystem Windows build this exit is
  // otherwise invisible, indistinguishable from any other startup failure.
  logMain('Another instance already holds the single-instance lock — quitting.')
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === null || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    logMain(`App ready. isPackaged=${app.isPackaged} version=${app.getVersion()}`)
    registerIpc()

    try {
      const handle = await startSidecar()
      logMain(`Sidecar started at ${handle.origin}`)
    } catch (err) {
      // Surface the failure in the UI rather than dying silently; the renderer
      // shows a "sidecar failed to start" panel when sidecar:info rejects.
      logMainError('Sidecar failed to start', err)
    }

    try {
      createWindow()
    } catch (err) {
      logMainError('Failed to create the main window', err)
      throw err
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Make sure we never leave an orphaned Python process behind.
  app.on('before-quit', stopSidecar)
  process.on('exit', stopSidecar)
}
