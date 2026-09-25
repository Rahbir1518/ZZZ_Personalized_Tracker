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
import { SettingsModal } from './components/SettingsModal'
import { SyncButton } from './components/SyncButton'
import { CharactersTab } from './tabs/CharactersTab'
import { DisksTab } from './tabs/DisksTab'
import { TeamsTab } from './tabs/TeamsTab'
import type { Agent, Analysis, AuthResult } from './types'
import './App.css'

type Tab = 'characters' | 'teams' | 'disks'
type Phase = 'starting' | 'needs-login' | 'ready' | 'sidecar-failed'

const TABS: { id: Tab; label: string; code: string }[] = [
  { id: 'characters', label: 'Agents', code: 'R-01' },
  { id: 'teams', label: 'Teams', code: 'R-02' },
  { id: 'disks', label: 'Disks', code: 'R-03' }
]

/**
 * The layered, low-contrast background. Purely decorative. `word` is the
 * fixed oversized wordmark; the main shell omits it and sets its section
 * word in the top bar instead, where layout can keep it clear of the
 * controls around it.
 */
function Backdrop({ word }: { word?: string }): React.JSX.Element {
  return (
    <>
      <div className="backdrop" />
      <div className="backdrop-marks" aria-hidden="true">
        <span className="ring-a" />
        <span className="ring-b" />
        <span className="slab" />
      </div>
      {word !== undefined && (
        <div className="backdrop-word display" aria-hidden="true">
          {word}
        </div>
      )}
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  // A disc-set click inside the agent/team overlays hands its name here and
  // switches to Disks, rather than opening yet another nested panel — the
  // full "who's it for, ranked" answer needs real space, not a modal aside.
  // `returnTo` travels with it so the set's own back button can send the
  // person back to the agent they clicked from, not to the set grid — only
  // AgentModal ever supplies one; a click from Teams has no single agent to
  // return to, so its own back button behaves like the plain "close" it
  // always has.
  const [pendingSet, setPendingSet] = useState<{
    name: string
    returnTo: { agentId: number; agentName: string } | null
  } | null>(null)

  const navigateToSet = useCallback(
    (name: string, returnTo?: { agentId: number; agentName: string }) => {
      setPendingSet({ name, returnTo: returnTo ?? null })
      setTab('disks')
    },
    []
  )

  // The Disks tab's back button hands the agent id back here once the person
  // asks to return to it; this is what actually reopens CharactersTab on
  // that agent.
  const [pendingAgentId, setPendingAgentId] = useState<number | null>(null)

  const returnToAgent = useCallback((agentId: number) => {
    setPendingAgentId(agentId)
    setTab('characters')
  }, [])

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

  // Why the launch-time auto sign-in fell through to the login screen, if it
  // did — shown there so a saved profile with expired cookies doesn't just
  // silently look logged out.
  const [autoLoginFailure, setAutoLoginFailure] = useState<string | null>(null)
  // Who is signed in, shown under Sync so two accounts' rosters are never
  // mistaken for each other.
  const [account, setAccount] = useState<AuthResult | null>(null)

  /**
   * Drops the sidecar's session and hands back to the login screen, which
   * doubles as the account switcher. The saved profile is kept (forgetting
   * one is a separate action on its card); it just stops being the one the
   * next launch signs in as automatically.
   *
   * Best-effort on the sidecar call: a session that is already gone (sidecar
   * restarted, cookies expired) must not block leaving it, or the person is
   * stuck unable to log back in as anyone.
   */
  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // Nothing left to log out of server-side; still leave locally.
    }
    await window.tracker.profiles.deactivate()
    setAutoLoginFailure(null)
    setAccount(null)
    setAgents([])
    setAnalysis(null)
    setError(null)
    setPhase('needs-login')
  }, [])

  useEffect(() => {
    void (async () => {
      try {
        await window.tracker.sidecar.info()
      } catch {
        setPhase('sidecar-failed')
        return
      }

      let profileName = ''
      try {
        const { profiles, active } = await window.tracker.profiles.list()
        const profile = profiles.find((p) => p.id === active)
        const stored = active === null ? null : await window.tracker.profiles.load(active)
        if (profile === undefined || stored === null) {
          setPhase('needs-login')
          return
        }
        profileName = profile.nickname || `account ${profile.id}`
        const result = await api.login(stored as unknown as Record<string, string>)
        // Refreshes the card's nickname/level, and fills them in for a
        // profile migrated from the old single-account store.
        await window.tracker.profiles.save(stored, result)
        setAccount(result)
        setPhase('ready')
        await loadData()
      } catch (err) {
        if (profileName !== '') {
          const reason = err instanceof ApiError ? err.message : String(err)
          setAutoLoginFailure(`Couldn't sign in as ${profileName} automatically. ${reason}`)
        }
        setPhase('needs-login')
      }
    })()
  }, [loadData])

  if (phase === 'starting') {
    return (
      <div className="boot">
        <Backdrop word="ZZZ" />
        <div className="boot-spinner" role="status" aria-live="polite">
          <span className="boot-ring" aria-hidden="true" />
          <p className="boot-text display">Loading</p>
        </div>
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
          notice={autoLoginFailure}
          onAuthenticated={(result) => {
            setAutoLoginFailure(null)
            setAccount(result)
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
      <Backdrop />

      <div className="shell-stage">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true" />
            <span className="stage-word display" aria-hidden="true">
              {tab === 'characters' ? 'AGENTS' : tab === 'teams' ? 'TEAMS' : 'DISKS'}
            </span>
          </div>

          <div className="topbar-end">
            <SyncButton onFinished={() => void loadData()} />
            {account !== null && (
              <div className="account-badge" title="Signed-in account">
                <span className="display account-name">
                  {account.nickname || 'HoYoLAB account'}
                </span>
                <Tech className="account-meta">
                  {[account.uid !== '' && `UID ${account.uid}`, account.region]
                    .filter(Boolean)
                    .join(' · ')}
                </Tech>
              </div>
            )}
          </div>
        </header>

        {error !== null && (
          <div className="shell-error">
            <ErrorStrip message={error.message} hint={error.hint} onRetry={() => void loadData()} />
          </div>
        )}

        <main className="shell-main">
          {tab === 'characters' ? (
            <CharactersTab
              agents={agents}
              gaps={analysis?.build_gaps ?? []}
              myTeams={analysis?.my_teams ?? []}
              suggestedTeams={analysis?.suggested_teams ?? []}
              loading={loading}
              onNavigateToSet={navigateToSet}
              initialAgentId={pendingAgentId}
              onConsumeInitialAgent={() => setPendingAgentId(null)}
            />
          ) : tab === 'teams' ? (
            <TeamsTab
              analysis={analysis}
              agents={agents}
              loading={loading}
              onNavigateToSet={navigateToSet}
            />
          ) : (
            <DisksTab
              farming={analysis?.farming ?? []}
              domainCoverage={analysis?.domain_coverage ?? []}
              loading={loading}
              initialSet={pendingSet}
              onConsumeInitialSet={() => setPendingSet(null)}
              onReturnToAgent={returnToAgent}
            />
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

        <button
          type="button"
          className="rail-settings"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon />
        </button>
      </nav>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onLogout={() => void logout()}
      />
    </div>
  )
}

/** A plain drawn gear, matching the rail's other hand-drawn marks (the brand
 *  wedge, the rank badges) rather than pulling in an icon font for one glyph. */
function SettingsIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="3.2" />
      {/* 8 spokes, evenly spaced at 45° with matching inner/outer radii —
          the previous version's diagonals were hand-guessed and landed at
          different distances from centre, which is what read as "off". */}
      <path
        d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8
           M16.67 7.33 18.51 5.49M7.33 7.33 5.49 5.49
           M7.33 16.67 5.49 18.51M16.67 16.67 18.51 18.51"
      />
    </svg>
  )
}
