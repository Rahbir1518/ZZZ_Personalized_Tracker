/**
 * The settings modal: small and centred, unlike the tile-expanding agent and
 * team overlays — there is no origin tile to expand from (it opens from the
 * rail's settings icon, not a card in a grid), and the content is a short
 * list of account-level actions rather than a page of detail. Its own scrim
 * and close button rather than reusing AgentModal's `.ov-*` classes, so this
 * file has no implicit dependency on that one happening to be loaded first.
 */

import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Panel, Tech } from './Ui'
import './SettingsModal.css'

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
        </Panel>
      </motion.div>
    </div>
  )
}
