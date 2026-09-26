import { app, ipcMain, shell } from 'electron'
import { getSidecar } from './sidecar'
import {
  listProfiles,
  loadProfileCookies,
  saveProfile,
  removeProfile,
  deactivateProfile,
  type AccountInfo,
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

  ipcMain.handle('profiles:list', () => listProfiles())

  ipcMain.handle('profiles:load', (_event, id: string) => loadProfileCookies(String(id)))

  ipcMain.handle('profiles:save', (_event, cookies: StoredCookies, account: AccountInfo) => {
    saveProfile(cookies, account)
  })

  ipcMain.handle('profiles:remove', (_event, id: string) => {
    removeProfile(String(id))
  })

  ipcMain.handle('profiles:deactivate', () => {
    deactivateProfile()
  })

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    // Only ever open real web links, never file:// or custom schemes.
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') throw new Error(`Refusing to open ${parsed.protocol} URL`)
    await shell.openExternal(url)
  })
}
