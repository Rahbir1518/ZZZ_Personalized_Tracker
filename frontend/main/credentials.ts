import { join } from 'node:path'
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { app, safeStorage } from 'electron'

/**
 * HoYoLAB cookies are session tokens — treated like passwords.
 *
 * They are encrypted at rest with Electron's safeStorage, which on Windows is
 * DPAPI scoped to the current user account. They are never written in plain
 * text, never logged, and are only ever sent to the localhost sidecar (which in
 * turn only sends them to HoYoLAB's own domains).
 *
 * safeStorage is preferred over keytar here: no native module to rebuild, and
 * no separate credential-manager entry for the user to clean up by hand.
 */

export interface StoredCookies {
  ltoken_v2: string
  ltuid_v2: string
  /** Optional; some flows also want these. Accepted but not required. */
  account_mid_v2?: string
  account_id_v2?: string
}

function credentialPath(): string {
  return join(app.getPath('userData'), 'credentials.bin')
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function saveCookies(cookies: StoredCookies): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS-level encryption is unavailable, so cookies will not be stored. ' +
        'You can still use the app for this session.'
    )
  }
  const blob = safeStorage.encryptString(JSON.stringify(cookies))
  writeFileSync(credentialPath(), blob, { mode: 0o600 })
}

export function loadCookies(): StoredCookies | null {
  const path = credentialPath()
  if (!existsSync(path)) return null
  try {
    const plain = safeStorage.decryptString(readFileSync(path))
    return JSON.parse(plain) as StoredCookies
  } catch {
    // Corrupt, or encrypted under a different OS user — drop it and re-prompt
    // rather than leaving the app wedged.
    clearCookies()
    return null
  }
}

export function clearCookies(): void {
  rmSync(credentialPath(), { force: true })
}

export function hasCookies(): boolean {
  return existsSync(credentialPath())
}
