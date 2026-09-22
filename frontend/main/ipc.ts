import { ipcMain, shell } from 'electron'
import { getSidecar } from './sidecar'
import {
  saveCookies,
  loadCookies,
  clearCookies,
  hasCookies,
  isEncryptionAvailable,
  type StoredCookies
} from './credentials'

/**
 * The renderer gets a deliberately narrow surface: where the sidecar lives,
 * credential storage, and opening external links in the real browser. It has no
 * Node access and cannot spawn, read files, or reach the network directly.
 */
export function registerIpc(): void {
  ipcMain.handle('sidecar:info', () => {
    const handle = getSidecar()
    if (handle === null) throw new Error('Sidecar is not running')
    return handle
  })

  ipcMain.handle('credentials:status', () => ({
    stored: hasCookies(),
    encryptionAvailable: isEncryptionAvailable()
  }))

  ipcMain.handle('credentials:save', (_event, cookies: StoredCookies) => {
    saveCookies(cookies)
  })

  ipcMain.handle('credentials:load', () => loadCookies())

  ipcMain.handle('credentials:clear', () => {
    clearCookies()
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    // Only ever open real web links, never file:// or custom schemes.
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') throw new Error(`Refusing to open ${parsed.protocol} URL`)
    await shell.openExternal(url)
  })
}
