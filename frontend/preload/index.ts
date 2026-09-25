import { contextBridge, ipcRenderer } from 'electron'

export interface SidecarInfo {
  origin: string
  token: string
}

export interface StoredCookies {
  ltoken_v2: string
  ltuid_v2: string
  account_mid_v2?: string
  account_id_v2?: string
}

export interface ProfileMeta {
  id: string
  uid: string
  nickname: string
  level: number
  region: string
  lastUsedAt: number
}

export type AccountInfo = Pick<ProfileMeta, 'uid' | 'nickname' | 'level' | 'region'>

export interface ProfileList {
  profiles: ProfileMeta[]
  active: string | null
  encryptionAvailable: boolean
}

/**
 * The entire surface the renderer is allowed to touch. Deliberately small:
 * no generic "invoke any channel" escape hatch.
 */
const api = {
  sidecar: {
    info: (): Promise<SidecarInfo> => ipcRenderer.invoke('sidecar:info')
  },
  profiles: {
    list: (): Promise<ProfileList> => ipcRenderer.invoke('profiles:list'),
    load: (id: string): Promise<StoredCookies | null> => ipcRenderer.invoke('profiles:load', id),
    save: (cookies: StoredCookies, account: AccountInfo): Promise<void> =>
      ipcRenderer.invoke('profiles:save', cookies, account),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('profiles:remove', id),
    deactivate: (): Promise<void> => ipcRenderer.invoke('profiles:deactivate')
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
}

export type TrackerApi = typeof api

contextBridge.exposeInMainWorld('tracker', api)
