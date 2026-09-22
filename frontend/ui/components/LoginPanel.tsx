/**
 * Manual cookie paste (milestone 1). QR login lands later and will sit
 * alongside this, not replace it — pasted cookies stay as the fallback.
 *
 * Cookies go straight to the main process, which encrypts them with the OS
 * keystore (safeStorage / DPAPI). They are never logged and never leave the
 * machine except to HoYoLAB itself.
 */

import { useState } from 'react'
import { ApiError, api } from '../api'
import { Panel } from './ComicBits'
import './LoginPanel.css'

const HOYOLAB_URL = 'https://www.hoyolab.com'

interface Props {
  onAuthenticated: () => void
}

export function LoginPanel({ onAuthenticated }: Props): React.JSX.Element {
  const [ltoken, setLtoken] = useState('')
  const [ltuid, setLtuid] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy(true)
    setError(null)

    const cookies = { ltoken_v2: ltoken.trim(), ltuid_v2: ltuid.trim() }

    try {
      await api.login(cookies)
      if (remember) await window.tracker.credentials.save(cookies)
      onAuthenticated()
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('UNKNOWN', String(err)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <Panel tilt="left" className="login-panel">
        <h1 className="display-outline login-title">Sign in to HoYoLAB</h1>

        <p className="login-intro">
          Paste two cookies from your own HoYoLAB session. They stay on this machine, encrypted by
          Windows, and are only ever sent to HoYoLAB.
        </p>

        <form onSubmit={(e) => void submit(e)} className="login-form">
          <label className="login-field">
            <span>ltoken_v2</span>
            <input
              value={ltoken}
              onChange={(e) => setLtoken(e.target.value)}
              placeholder="v2_xxxxxxxxxxxxxxxx"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>

          <label className="login-field">
            <span>ltuid_v2</span>
            <input
              value={ltuid}
              onChange={(e) => setLtuid(e.target.value)}
              placeholder="123456789"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>

          <label className="login-remember">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Remember me on this computer</span>
          </label>

          <button type="submit" className="ink-button" disabled={busy}>
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
            Treat these like a password. A leaked cookie exposes account <i>data</i> — it cannot by
            itself take over your account without your password, email access and 2FA.
          </p>
        </details>
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
      <strong className="display">{recordDisabled ? 'One setting to flip' : 'That did not work'}</strong>
      <p>{error.message}</p>
      {error.hint !== '' && <p className="login-error-hint">{error.hint}</p>}
      {recordDisabled && (
        <button
          type="button"
          className="ink-button ink-button-quiet"
          onClick={() => void window.tracker.openExternal(`${HOYOLAB_URL}/setting/privacy`)}
        >
          Open HoYoLAB settings
        </button>
      )}
    </div>
  )
}
