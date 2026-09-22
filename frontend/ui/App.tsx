/**
 * App shell: auth gate, the two top-level tabs, and the sync header.
 *
 * Data flow is deliberately simple — the sidecar owns all state and the
 * renderer refetches after a sync finishes. No client-side cache to keep
 * coherent, which for a single-user desktop app is the right trade.
 */

import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from './api'
import { ErrorStrip } from './components/ComicBits'
import { LoginPanel } from './components/LoginPanel'
import { SyncButton } from './components/SyncButton'
import { CharactersTab } from './tabs/CharactersTab'
import { TeamsTab } from './tabs/TeamsTab'
import type { Agent, Analysis } from './types'
import './App.css'

type Tab = 'characters' | 'teams'
type Phase = 'starting' | 'needs-login' | 'ready' | 'sidecar-failed'

export function App(): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('starting')
  const [tab, setTab] = useState<Tab>('characters')
  const [agents, setAgents] = useState<Agent[]>([])
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [nextAgents, nextAnalysis] = await Promise.all([api.agents(), api.analysis()])
      setAgents(nextAgents)
      setAnalysis(nextAnalysis)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError('UNKNOWN', String(err)))
    } finally {
      setLoading(false)
    }
  }, [])

  // Startup: if we have stored cookies, sign in with them silently.
  useEffect(() => {
    void (async () => {
      try {
        await window.tracker.sidecar.info()
      } catch {
        setPhase('sidecar-failed')
        return
      }

      try {
        const stored = await window.tracker.credentials.load()
        if (stored === null) {
          setPhase('needs-login')
          return
        }
        await api.login(stored as unknown as Record<string, string>)
        setPhase('ready')
        await loadData()
      } catch {
        // Stored cookies are stale or rejected — fall back to the paste form.
        setPhase('needs-login')
      }
    })()
  }, [loadData])

  if (phase === 'starting') {
    return (
      <div className="boot">
        <p className="display-outline boot-text">Warming up…</p>
      </div>
    )
  }

  if (phase === 'sidecar-failed') {
    return (
      <div className="boot">
        <div className="boot-failed">
          <h1 className="display-outline">Local service did not start</h1>
          <p>
            The Python sidecar failed to launch, so there is nothing to talk to. In development run{' '}
            <code>npm run sidecar:install</code> first. If you installed the packaged app, please
            file an issue with the log from the terminal.
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'needs-login') {
    return (
      <LoginPanel
        onAuthenticated={() => {
          setPhase('ready')
          void loadData()
        }}
      />
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="display-outline app-title">ZZZ Team Tracker</h1>

        <nav className="app-tabs" role="tablist" aria-label="Main sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'characters'}
            className={`ink-button ${tab === 'characters' ? 'is-active' : 'ink-button-quiet'}`}
            onClick={() => setTab('characters')}
          >
            Characters
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'teams'}
            className={`ink-button ${tab === 'teams' ? 'is-active' : 'ink-button-quiet'}`}
            onClick={() => setTab('teams')}
          >
            Teams
          </button>
        </nav>

        <SyncButton onFinished={() => void loadData()} />
      </header>

      {error !== null && (
        <div className="app-error">
          <ErrorStrip message={error.message} hint={error.hint} onRetry={() => void loadData()} />
        </div>
      )}

      <main className="app-main">
        {tab === 'characters' ? (
          <CharactersTab agents={agents} gaps={analysis?.build_gaps ?? []} loading={loading} />
        ) : (
          <TeamsTab analysis={analysis} loading={loading} />
        )}
      </main>
    </div>
  )
}
