import { join } from 'node:path'
import { app, shell, BrowserWindow } from 'electron'
import { startSidecar, stopSidecar } from './sidecar'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null

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
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow === null) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    registerIpc()

    try {
      await startSidecar()
    } catch (err) {
      // Surface the failure in the UI rather than dying silently; the renderer
      // shows a "sidecar failed to start" panel when sidecar:info rejects.
      console.error('[main] sidecar failed to start:', err)
    }

    createWindow()

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
