/**
 * Manual cookie paste — the one sign-in path. A QR flow was scaffolded and
 * removed: the QR helper `genshin.py` ships is Chinese-Miyoushe-only, not
 * Global HoYoLAB, which is what this app authenticates against.
 *
 * Cookies go straight to the main process, which encrypts them with the OS
 * keystore (safeStorage / DPAPI). They are never logged and never leave the
 * machine except to HoYoLAB itself.
 *
 * Every account signed in with "remember" ticked becomes a profile card above
 * the form, so switching between accounts is one click instead of a re-paste.
 */

import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api'
import type { AuthResult } from '../types'
import { Panel, Tech } from './Ui'
import './LoginPanel.css'

const HOYOLAB_URL = 'https://www.hoyolab.com'

type Profile = Awaited<ReturnType<typeof window.tracker.profiles.list>>['profiles'][number]

interface Props {
  onAuthenticated: (account: AuthResult) => void
  /** Why the launch-time auto sign-in didn't go through, if it didn't. */
  notice?: string | null
}

function toAccount(result: AuthResult): Pick<Profile, 'uid' | 'nickname' | 'level' | 'region'> {
  return { uid: result.uid, nickname: result.nickname, level: result.level, region: result.region }
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError('UNKNOWN', String(err))
}

function profileName(profile: Profile): string {
  return profile.nickname || `HoYoLAB ${profile.id}`
}

export function LoginPanel({ onAuthenticated, notice = null }: Props): React.JSX.Element {
  const [ltoken, setLtoken] = useState('')
  const [ltuid, setLtuid] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  // null until the first list comes back, so the form doesn't flash open and
  // then collapse for someone who has saved profiles.
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [encryptionAvailable, setEncryptionAvailable] = useState(true)
  const [showForm, setShowForm] = useState(false)
  // Which card is mid sign-in, and which one is asking "forget — sure?".
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [confirmForget, setConfirmForget] = useState<string | null>(null)
  const ltokenRef = useRef<HTMLInputElement>(null)

  const refreshProfiles = async (): Promise<Profile[]> => {
    const list = await window.tracker.profiles.list()
    setProfiles(list.profiles)
    setEncryptionAvailable(list.encryptionAvailable)
    return list.profiles
  }

  useEffect(() => {
    refreshProfiles()
      .then((list) => setShowForm(list.length === 0))
      .catch(() => {
        setProfiles([])
        setShowForm(true)
      })
  }, [])

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const cookies = { ltoken_v2: ltoken.trim(), ltuid_v2: ltuid.trim() }

    try {
      const account = await api.login(cookies)
      // Unchecked has to actively remove, not just skip saving — otherwise a
      // profile saved on an earlier, checked login would keep this account's
      // cookies (and keep signing it in on relaunch) even after the person
      // unchecked the box this time.
      if (remember && encryptionAvailable) {
        await window.tracker.profiles.save(cookies, toAccount(account))
      } else {
        await window.tracker.profiles.remove(cookies.ltuid_v2)
        // And no other profile should auto-sign-in next launch either, e.g.
        // one whose launch-time sign-in just failed and brought us here.
        await window.tracker.profiles.deactivate()
      }
      onAuthenticated(account)
    } catch (err) {
      setError(toApiError(err))
    } finally {
      setBusy(false)
    }
  }

  const signInAs = async (profile: Profile): Promise<void> => {
    setPendingId(profile.id)
    setConfirmForget(null)
    setError(null)

    try {
      const cookies = await window.tracker.profiles.load(profile.id)
      if (cookies === null) {
        throw new ApiError('NOT_AUTHENTICATED', 'This saved account is no longer on this computer.')
      }
      const account = await api.login(cookies as unknown as Record<string, string>)
      await window.tracker.profiles.save(cookies, toAccount(account))
      onAuthenticated(account)
    } catch (err) {
      setError(toApiError(err))
      // The usual cause is expired cookies. Open the form with this account's
      // ltuid already filled in: pasting a fresh ltoken_v2 then replaces the
      // stale profile in place rather than adding a duplicate.
      setLtuid(profile.id)
      setLtoken('')
      setShowForm(true)
      requestAnimationFrame(() => ltokenRef.current?.focus())
    } finally {
      setPendingId(null)
    }
  }

  const forget = async (profile: Profile): Promise<void> => {
    if (confirmForget !== profile.id) {
      setConfirmForget(profile.id)
      return
    }
    setConfirmForget(null)
    await window.tracker.profiles.remove(profile.id)
    const remaining = await refreshProfiles()
    if (remaining.length === 0) setShowForm(true)
  }

  const hasProfiles = profiles !== null && profiles.length > 0
  const anyBusy = busy || pendingId !== null

  return (
    <div className="login-screen">
      <Panel className="login-panel" tick>
        <h1 className="display login-title">
          {hasProfiles ? 'Choose an account' : 'Sign in to HoYoLAB'}
        </h1>

        {notice !== null && error === null && (
          <p className="login-notice" role="status">
            {notice}
          </p>
        )}

        {hasProfiles && (
          <ul className="login-profiles" aria-label="Saved accounts">
            {profiles.map((profile) => (
              <li key={profile.id} className="login-profile">
                <button
                  type="button"
                  className="login-profile-main"
                  disabled={anyBusy}
                  onClick={() => void signInAs(profile)}
                >
                  <span className="login-profile-avatar display" aria-hidden="true">
                    {(profile.nickname || '?').slice(0, 1).toUpperCase()}
                  </span>
                  <span className="login-profile-text">
                    <span className="display login-profile-name">
                      {pendingId === profile.id ? 'Signing in…' : profileName(profile)}
                    </span>
                    <Tech>
                      {[
                        profile.uid !== '' && `UID ${profile.uid}`,
                        profile.region,
                        profile.level > 0 && `Lv ${profile.level}`
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Details load after the next sign-in'}
                    </Tech>
                  </span>
                </button>
                <button
                  type="button"
                  className={
                    confirmForget === profile.id
                      ? 'login-profile-forget is-confirming'
                      : 'login-profile-forget'
                  }
                  disabled={anyBusy}
                  onClick={() => void forget(profile)}
                  onBlur={() => setConfirmForget((id) => (id === profile.id ? null : id))}
                  aria-label={`Forget ${profileName(profile)} on this computer`}
                  title="Forget this account on this computer"
                >
                  {confirmForget === profile.id ? 'Forget?' : '✕'}
                </button>
              </li>
            ))}
          </ul>
        )}

        {hasProfiles && !showForm && (
          <button type="button" className="btn login-add" onClick={() => setShowForm(true)}>
            + Add another account
          </button>
        )}

        {showForm && (
          <>
            {hasProfiles && <hr className="login-divider" />}

            <p className="login-intro">
              Paste two cookies from your own HoYoLAB session. They stay on this machine, encrypted
              by Windows, and are only ever sent to HoYoLAB.
            </p>

            <form onSubmit={(e) => void submit(e)} className="login-form">
              <label className="login-field">
                <Tech>ltoken_v2</Tech>
                <input
                  ref={ltokenRef}
                  value={ltoken}
                  onChange={(e) => setLtoken(e.target.value)}
                  placeholder="v2_xxxxxxxxxxxxxxxx"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>

              <label className="login-field">
                <Tech>ltuid_v2</Tech>
                <input
                  value={ltuid}
                  onChange={(e) => setLtuid(e.target.value)}
                  placeholder="123456789"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
              </label>

              {encryptionAvailable ? (
                <label className="login-remember">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  <span>Remember this account on this computer</span>
                </label>
              ) : (
                <p className="login-remember">
                  Windows encryption is unavailable, so this account can't be remembered.
                </p>
              )}

              <button type="submit" className="btn btn-primary" disabled={anyBusy}>
                {busy ? 'Checking…' : 'Connect'}
              </button>
            </form>

            {error !== null && <LoginError error={error} />}

            <details className="login-help">
              <summary>Where do I find these?</summary>
              <ol>
                <li>
                  Log in at{' '}
                  <a
                    href={HOYOLAB_URL}
                    onClick={(e) => {
                      e.preventDefault()
                      void window.tracker.openExternal(HOYOLAB_URL)
                    }}
                  >
                    hoyolab.com
                  </a>
                  .
                </li>
                <li>
                  Open DevTools (<kbd>F12</kbd>) and go to <b>Application → Cookies</b>.
                </li>
                <li>
                  Copy the values of <code>ltoken_v2</code> and <code>ltuid_v2</code>.
                </li>
              </ol>
              <p className="login-risk">
                Treat these like a password. A leaked cookie exposes account <i>data</i> — it cannot
                by itself take over your account without your password, email access and 2FA.
              </p>
            </details>
          </>
        )}
      </Panel>
    </div>
  )
}

/**
 * Error rendering branches on the sidecar's code, never on message text.
 * "Battle record switched off" needs a different fix from "bad cookies", and
 * conflating them is the single most confusing failure this app can have.
 */
function LoginError({ error }: { error: ApiError }): React.JSX.Element {
  const recordDisabled = error.code === 'GAME_RECORD_DISABLED'

  return (
    <div className={`login-error ${recordDisabled ? 'login-error-fixable' : ''}`} role="alert">
      <strong className="display">{recordDisabled ? 'One setting to flip' : 'Rejected'}</strong>
      <p>{error.message}</p>
      {error.hint !== '' && <p className="login-error-hint">{error.hint}</p>}
      {recordDisabled && (
        <button
          type="button"
          className="btn"
          onClick={() => void window.tracker.openExternal(`${HOYOLAB_URL}/setting/privacy`)}
        >
          Open HoYoLAB settings
        </button>
      )}
    </div>
  )
}
