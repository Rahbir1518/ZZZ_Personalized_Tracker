/**
 * App shell: layered backdrop, the roster stage, and a vertical navigation
 * rail welded to the right edge in place of a conventional sidebar.
 *
 * The sidecar owns all state; the renderer refetches after a sync finishes.
 * No client cache to keep coherent, which is the right trade for a
 * single-user desktop app.
 */

import { useCallback, useEffect, useState } from 'react'
import { ApiError, api } from './api'
import { ErrorStrip, Tech } from './components/Ui'
import { LoginPanel } from './components/LoginPanel'
import { SyncButton } from './components/SyncButton'
import { CharactersTab } from './tabs/CharactersTab'
import { TeamsTab } from './tabs/TeamsTab'
import type { Agent, Analysis } from './types'
import './App.css'

type Tab = 'characters' | 'teams'
type Phase = 'starting' | 'needs-login' | 'ready' | 'sidecar-failed'

const TABS: { id: Tab; label: string; code: string }[] = [
  { id: 'characters', label: 'Agents', code: 'R-01' },
  { id: 'teams', label: 'Teams', code: 'R-02' }
]

/** The layered, low-contrast background. Purely decorative. */
function Backdrop({ word }: { word: string }): React.JSX.Element {
  return (
    <>
      <div className="backdrop" />
      <div className="backdrop-marks" aria-hidden="true">
        <span className="ring-a" />
        <span className="ring-b" />
        <span className="slab" />
      </div>
      <div className="backdrop-word display" aria-hidden="true">
        {word}
      </div>
    </>
  )
}

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
        setPhase('needs-login')
      }
    })()
  }, [loadData])

  if (phase === 'starting') {
    return (
      <div className="boot">
        <Backdrop word="ZZZ" />
        <p className="boot-text display">Booting</p>
      </div>
    )
  }

  if (phase === 'sidecar-failed') {
    return (
      <div className="boot">
        <Backdrop word="ERR" />
        <div className="boot-fail panel">
          <h1 className="display boot-fail-title">Local service offline</h1>
          <p>
            The Python sidecar did not start, so there is nothing to talk to. In development run{' '}
            <code>npm run sidecar:install</code> first. If you installed the packaged app, please
            file an issue with the terminal log.
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'needs-login') {
    return (
      <>
        <Backdrop word="AUTH" />
        <LoginPanel
          onAuthenticated={() => {
            setPhase('ready')
            void loadData()
          }}
        />
      </>
    )
  }

  const active = TABS.find((t) => t.id === tab) ?? TABS[0]

  return (
    <div className="shell">
      <Backdrop word={tab === 'characters' ? 'AGENTS' : 'TEAMS'} />

      <div className="shell-stage">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <div className="brand-text">
              <span className="display brand-name">ZZZ Tracker</span>
              <Tech>Agent progression</Tech>
            </div>
          </div>

          <SyncButton onFinished={() => void loadData()} />
        </header>

        {error !== null && (
          <div className="shell-error">
            <ErrorStrip message={error.message} hint={error.hint} onRetry={() => void loadData()} />
          </div>
        )}

        <main className="shell-main">
          {tab === 'characters' ? (
            <CharactersTab agents={agents} gaps={analysis?.build_gaps ?? []} loading={loading} />
          ) : (
            <TeamsTab analysis={analysis} agents={agents} loading={loading} />
          )}
        </main>
      </div>

      {/* Vertical rail: an in-game menu tab, not a sidebar. */}
      <nav className="rail" role="tablist" aria-label="Sections">
        <span className="rail-code tech">{active?.code}</span>

        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`rail-tab ${tab === id ? 'is-active' : ''}`}
            onClick={() => setTab(id)}
          >
            <span className="rail-label display">{label}</span>
          </button>
        ))}

        <span className="rail-cursor" aria-hidden="true">
          ›
        </span>
      </nav>
    </div>
  )
}
