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
 *
 * Every remembered account is a *profile*, keyed by its `ltuid_v2` (the
 * HoYoLAB account id), so someone with two accounts can switch between them
 * from the sign-in screen without re-pasting cookies. The whole store —
 * metadata included — is one encrypted blob; the renderer only ever sees the
 * metadata half via `listProfiles`, and gets one profile's cookies only when
 * it asks to sign in as that profile.
 */

export interface StoredCookies {
  ltoken_v2: string
  ltuid_v2: string
  /** Optional; some flows also want these. Accepted but not required. */
  account_mid_v2?: string
  account_id_v2?: string
}

/** What the sign-in screen shows on a profile card. Never includes cookies. */
export interface ProfileMeta {
  /** The profile's key: the account's `ltuid_v2`. */
  id: string
  /** In-game ZZZ UID, which is what the person actually recognises. */
  uid: string
  nickname: string
  level: number
  region: string
  lastUsedAt: number
}

/** The account details the sidecar hands back from a successful login. */
export type AccountInfo = Pick<ProfileMeta, 'uid' | 'nickname' | 'level' | 'region'>

export interface ProfileList {
  profiles: ProfileMeta[]
  /** The profile signed in automatically on launch, or null after a logout. */
  active: string | null
  encryptionAvailable: boolean
}

interface StoredProfile extends ProfileMeta {
  cookies: StoredCookies
}

interface ProfileStore {
  version: 1
  active: string | null
  profiles: StoredProfile[]
}

function storePath(): string {
  return join(app.getPath('userData'), 'profiles.bin')
}

/** Pre-profiles builds kept a single account here. Migrated on first read. */
function legacyCredentialPath(): string {
  return join(app.getPath('userData'), 'credentials.bin')
}

function emptyStore(): ProfileStore {
  return { version: 1, active: null, profiles: [] }
}

function decryptJson<T>(path: string): T | null {
  try {
    return JSON.parse(safeStorage.decryptString(readFileSync(path))) as T
  } catch {
    // Corrupt, or encrypted under a different OS user — drop it and re-prompt
    // rather than leaving the app wedged.
    rmSync(path, { force: true })
    return null
  }
}

function readStore(): ProfileStore {
  if (existsSync(storePath())) return decryptJson<ProfileStore>(storePath()) ?? emptyStore()

  const legacy = legacyCredentialPath()
  if (!existsSync(legacy)) return emptyStore()

  // The single saved account becomes the first profile, still active so the
  // next launch signs in exactly as it used to. Its nickname is blank until
  // that sign-in succeeds and fills it in.
  const cookies = decryptJson<StoredCookies>(legacy)
  const store = emptyStore()
  if (cookies !== null && cookies.ltuid_v2) {
    store.profiles.push({
      id: cookies.ltuid_v2,
      uid: '',
      nickname: '',
      level: 0,
      region: '',
      lastUsedAt: Date.now(),
      cookies
    })
    store.active = cookies.ltuid_v2
    writeStore(store)
  }
  rmSync(legacy, { force: true })
  return store
}

function writeStore(store: ProfileStore): void {
  if (store.profiles.length === 0) {
    rmSync(storePath(), { force: true })
    return
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS-level encryption is unavailable, so cookies will not be stored. ' +
        'You can still use the app for this session.'
    )
  }
  writeFileSync(storePath(), safeStorage.encryptString(JSON.stringify(store)), { mode: 0o600 })
}

export function isEncryptionAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function listProfiles(): ProfileList {
  const store = readStore()
  return {
    profiles: store.profiles
      .map(({ cookies: _cookies, ...meta }) => meta)
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt),
    active: store.active,
    encryptionAvailable: isEncryptionAvailable()
  }
}

export function loadProfileCookies(id: string): StoredCookies | null {
  return readStore().profiles.find((p) => p.id === id)?.cookies ?? null
}

/**
 * Adds or refreshes the profile for these cookies and makes it the active
 * one. Called after every successful sign-in, so re-pasting fresh cookies for
 * an account that already has a profile replaces its expired ones in place.
 */
export function saveProfile(cookies: StoredCookies, account: AccountInfo): void {
  const id = cookies.ltuid_v2.trim()
  if (id === '') throw new Error('Cannot save a profile without ltuid_v2')

  const store = readStore()
  const profile: StoredProfile = {
    id,
    uid: account.uid,
    nickname: account.nickname,
    level: account.level,
    region: account.region,
    lastUsedAt: Date.now(),
    cookies
  }
  store.profiles = [...store.profiles.filter((p) => p.id !== id), profile]
  store.active = id
  writeStore(store)
}

export function removeProfile(id: string): void {
  const store = readStore()
  store.profiles = store.profiles.filter((p) => p.id !== id)
  if (store.active === id) store.active = null
  writeStore(store)
}

/**
 * Logging out keeps the profile — it just stops the next launch from signing
 * in as it automatically, so the person lands on the profile picker instead.
 */
export function deactivateProfile(): void {
  const store = readStore()
  if (store.active === null) return
  store.active = null
  writeStore(store)
}
