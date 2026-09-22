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

export interface CredentialStatus {
  stored: boolean
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
  credentials: {
    status: (): Promise<CredentialStatus> => ipcRenderer.invoke('credentials:status'),
    save: (cookies: StoredCookies): Promise<void> =>
      ipcRenderer.invoke('credentials:save', cookies),
    load: (): Promise<StoredCookies | null> => ipcRenderer.invoke('credentials:load'),
    clear: (): Promise<void> => ipcRenderer.invoke('credentials:clear')
  },
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url)
}

export type TrackerApi = typeof api

contextBridge.exposeInMainWorld('tracker', api)
