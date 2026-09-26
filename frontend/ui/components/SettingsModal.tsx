/**
 * The settings modal: small and centred, unlike the tile-expanding agent and
 * team overlays — there is no origin tile to expand from (it opens from the
 * rail's settings icon, not a card in a grid), and the content is a short
 * list of account-level actions rather than a page of detail. Its own scrim
 * and close button rather than reusing AgentModal's `.ov-*` classes, so this
 * file has no implicit dependency on that one happening to be loaded first.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Panel, Tech } from './Ui'
import './SettingsModal.css'

type UpdateState = Awaited<ReturnType<typeof window.tracker.updates.state>>

interface Props {
  open: boolean
  onClose: () => void
  onLogout: () => void
}

/** Wrapped in AnimatePresence here so callers don't have to remember to. */
export function SettingsModal({ open, onClose, onLogout }: Props): React.JSX.Element {
  return <AnimatePresence>{open && <Dialog onClose={onClose} onLogout={onLogout} />}</AnimatePresence>
}

function Dialog({
  onClose,
  onLogout
}: {
  onClose: () => void
  onLogout: () => void
}): React.JSX.Element {
  const reduced = useReducedMotion() ?? false

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="settings-ov" role="dialog" aria-modal="true" aria-label="Settings">
      <motion.div
        className="settings-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      <motion.div
        className="settings-wrap"
        initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: reduced ? 0.12 : 0.18 }}
      >
        <Panel className="settings-panel" tick>
          <button type="button" className="settings-close" onClick={onClose} aria-label="Close">
            ✕
          </button>

          <h2 className="display settings-title">Settings</h2>
          <Tech>Account</Tech>

          <button
            type="button"
            className="btn settings-logout"
            onClick={() => {
              onClose()
              onLogout()
            }}
          >
            Log out
          </button>
          <p className="settings-note">
            Remembered accounts stay on this computer — pick any of them on the sign-in screen to
            switch.
          </p>

          <div className="settings-section">
            <Tech>App</Tech>
            <UpdateControl />
          </div>
        </Panel>
      </motion.div>
    </div>
  )
}

/**
 * One button that walks through the update: check -> download -> restart.
 * Each step only happens on a click; nothing updates on its own.
 */
function UpdateControl(): React.JSX.Element {
  const [update, setUpdate] = useState<UpdateState>({ state: 'idle' })
  const [version, setVersion] = useState('')

  useEffect(() => {
    let live = true
    void window.tracker.updates.state().then((s) => live && setUpdate(s))
    void window.tracker.appVersion().then((v) => live && setVersion(v))
    const off = window.tracker.updates.onState(setUpdate)
    return () => {
      live = false
      off()
    }
  }, [])

  const busy = update.state === 'checking' || update.state === 'downloading'

  const label =
    update.state === 'checking'
      ? 'Checking…'
      : update.state === 'available'
        ? `Download v${update.version}`
        : update.state === 'downloading'
          ? `Downloading… ${update.percent}%`
          : update.state === 'ready'
            ? `Restart to install v${update.version}`
            : 'Check for updates'

  const act = (): void => {
    if (update.state === 'available') void window.tracker.updates.download()
    else if (update.state === 'ready') void window.tracker.updates.install()
    else void window.tracker.updates.check()
  }

  const note =
    update.state === 'up-to-date'
      ? `You're on the latest version (v${update.version}).`
      : update.state === 'available'
        ? `Version ${update.version} is available.`
        : update.state === 'ready'
          ? 'Downloaded. The app will close, install the update, and reopen.'
          : update.state === 'unsupported'
            ? update.message
            : update.state === 'error'
              ? `Couldn't check for updates: ${update.message}`
              : `Installed version: v${version || '…'}. Checks GitHub Releases for this app.`

  return (
    <>
      <button
        type="button"
        className={`btn settings-update ${update.state === 'available' || update.state === 'ready' ? 'btn-primary' : ''}`}
        onClick={act}
        disabled={busy}
        aria-busy={busy}
      >
        {label}
      </button>
      {update.state === 'downloading' && (
        <div
          className="settings-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={update.percent}
        >
          <span style={{ width: `${update.percent}%` }} />
        </div>
      )}
      <p className={`settings-note ${update.state === 'error' ? 'settings-note-error' : ''}`}>
        {note}
      </p>
    </>
  )
}
