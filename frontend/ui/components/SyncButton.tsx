/**
 * The one refresh affordance in the app.
 *
 * Behaviour that matters (see the brief's Sync section):
 *  - per-source progress, because a cold Prydwen pass is slow by design
 *  - partial failure is shown, not thrown: one dead source never blanks the UI
 *  - single-flight, so the button reflects an in-flight run instead of
 *    starting a second
 *  - cancellable
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { SourceProgress, SyncStatus } from '../types'
import { Burst } from './ComicBits'
import './SyncButton.css'

const POLL_MS = 600
/** How long the "SYNCED!" burst stays up after a run finishes. */
const CELEBRATE_MS = 2600

const SOURCE_LABELS: Record<string, string> = {
  account: 'Account',
  metadata: 'Catalog',
  guides: 'Guides'
}

function relativeTime(epochSeconds: number | null): string {
  if (epochSeconds === null) return 'never'
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - epochSeconds))
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

function stateTone(progress: SourceProgress): string {
  switch (progress.state) {
    case 'OK':
      return 'ok'
    case 'FAILED':
      return 'failed'
    case 'RUNNING':
      return 'running'
    case 'CANCELLED':
      return 'cancelled'
    default:
      return 'idle'
  }
}

export function SyncButton({ onFinished }: { onFinished?: () => void }): React.JSX.Element {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<string>('')
  const [celebrating, setCelebrating] = useState(false)
  const wasRunning = useRef(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.syncStatus())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  // Poll only while a run is in flight; otherwise just pick up the last-synced
  // timestamps once on mount.
  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (status?.running !== true) return
    const handle = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(handle)
  }, [status?.running, refresh])

  // Keep the latest callback in a ref so it is not an effect dependency.
  // Callers pass an inline arrow, which changes identity on every parent
  // render; depending on it would re-run the effect constantly.
  const onFinishedRef = useRef(onFinished)
  useEffect(() => {
    onFinishedRef.current = onFinished
  }, [onFinished])

  // Fire the completion callback (and the burst) on the running -> idle edge.
  useEffect(() => {
    const running = status?.running === true
    const justFinished = wasRunning.current && !running

    // Update the guard *before* any early return. Leaving it stale made this
    // effect re-detect the same edge on every subsequent render, so the
    // completion callback refetched in a loop and the UI flickered between
    // "loading" and an error.
    wasRunning.current = running

    if (!justFinished) return undefined

    onFinishedRef.current?.()

    if (status?.cancelled === true) return undefined

    setCelebrating(true)
    const handle = window.setTimeout(() => setCelebrating(false), CELEBRATE_MS)
    return () => window.clearTimeout(handle)
  }, [status?.running, status?.cancelled])

  const start = async (): Promise<void> => {
    try {
      setStatus(await api.startSync())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const cancel = async (): Promise<void> => {
    try {
      setStatus(await api.cancelSync())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const running = status?.running === true
  const sources = status?.sources ?? []
  const used = status?.syncs_used_today ?? 0
  const perDay = status?.syncs_per_day ?? 0
  const remaining = Math.max(0, perDay - used)
  // The cap keeps us a light, predictable consumer of upstream services -
  // HoYoLAB enforces its own per-cookie daily limit.
  const outOfSyncs = perDay > 0 && remaining === 0

  return (
    <div className="sync">
      <div className="sync-actions">
        <button
          type="button"
          className="ink-button sync-button"
          onClick={() => void start()}
          disabled={running || outOfSyncs}
          aria-busy={running}
          title={outOfSyncs ? 'Daily sync limit reached. Resets at midnight.' : undefined}
        >
          {running ? 'Syncing…' : 'Sync'}
        </button>

        {running && (
          <button type="button" className="ink-button ink-button-quiet" onClick={() => void cancel()}>
            Cancel
          </button>
        )}

        {celebrating && (
          <span className="sync-celebrate">
            <Burst tone={status?.partial_failure === true ? 'warn' : 'good'}>
              {status?.partial_failure === true ? 'Partial' : 'Synced!'}
            </Burst>
          </span>
        )}
      </div>

      <ul className="sync-sources">
        {sources.map((source) => (
          <li key={source.source} className={`sync-source sync-source-${stateTone(source)}`}>
            <span className="sync-source-name">{SOURCE_LABELS[source.source] ?? source.source}</span>
            <span className="sync-source-detail">
              {source.state === 'RUNNING' && source.total > 0
                ? `${source.done}/${source.total}`
                : source.state === 'FAILED'
                  ? source.message || 'failed'
                  : relativeTime(source.last_success_at)}
            </span>
          </li>
        ))}
      </ul>

      {perDay > 0 && (
        <p className={`sync-quota ${outOfSyncs ? 'sync-quota-spent' : ''}`}>
          {outOfSyncs
            ? 'Daily sync limit reached — resets at midnight.'
            : `${remaining} of ${perDay} syncs left today`}
        </p>
      )}

      {status?.partial_failure === true && !running && (
        <p className="sync-note">
          Some sources failed; showing the newest data that did load.
        </p>
      )}

      {error !== '' && <p className="sync-note sync-note-error">{error}</p>}
    </div>
  )
}
