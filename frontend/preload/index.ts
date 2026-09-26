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

export type UpdateState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'unsupported'; message: string }
  | { state: 'up-to-date'; version: string }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string }

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
  updates: {
    /** Current state; also subscribes this window to changes. */
    state: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update:check'),
    download: (): Promise<UpdateState> => ipcRenderer.invoke('update:download'),
    install: (): Promise<void> => ipcRenderer.invoke('update:install'),
    /** Returns an unsubscribe function. */
    onState: (listener: (state: UpdateState) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState): void =>
        listener(state)
      ipcRenderer.on('update:state', handler)
      return () => ipcRenderer.removeListener('update:state', handler)
    }
  },
  appVersion: (): Promise<string> => ipcRenderer.invoke('app:version'),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
}

export type TrackerApi = typeof api

contextBridge.exposeInMainWorld('tracker', api)
