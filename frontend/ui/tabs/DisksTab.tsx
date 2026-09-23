/**
 * Disks: every Drive Disc set the game catalog knows, each tile showing who
 * it's recommended for — and Farm Next, moved here from Teams, since both
 * answer the same question ("what should I be farming") from opposite ends:
 * Farm Next starts from your roster and asks what it needs, this tab starts
 * from a set and asks who wants it.
 *
 * Clicking a tile opens the set's own page in place — the same `CodexPage`
 * the character and team overlays use for their drill-through, so the two
 * can never show different numbers for the same set. This tab is also where
 * a disc-set click from *inside* those overlays now lands (see
 * `onNavigateToSet` in App.tsx): the fuller "who's it for, ranked" answer
 * only really has room to live somewhere with real screen space, not a
 * modal's aside.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import { BackBar, CodexPage } from '../components/Codex'
import { AgentSearch, type Suggestion } from '../components/AgentSearch'
import { EmptyState, ItemIcon, Panel, Tech } from '../components/Ui'
import type { DiscSetOverview, FarmingPriority } from '../types'
import './DisksTab.css'

interface PendingSet {
  name: string
  /** Present only when this set was opened from an agent's modal — the set's
   *  own back button returns there instead of to the grid. Absent for a
   *  click from the grid itself or from Teams, where there is no single
   *  agent to send the person back to. */
  returnTo: { agentId: number; agentName: string } | null
}

interface Props {
  farming: FarmingPriority[]
  loading: boolean
  /** Set from outside (a disc-set click inside an agent/team overlay) — see
   *  App.tsx. Consumed once, then handed back via `onConsumeInitialSet`. */
  initialSet: PendingSet | null
  onConsumeInitialSet: () => void
  onReturnToAgent: (agentId: number) => void
}

export function DisksTab({
  farming,
  loading,
  initialSet,
  onConsumeInitialSet,
  onReturnToAgent
}: Props): React.JSX.Element {
  const [sets, setSets] = useState<DiscSetOverview[] | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [farmOpen, setFarmOpen] = useState(true)
  const [selected, setSelected] = useState<
    (PendingSet & { icon: string }) | null
  >(null)

  useEffect(() => {
    let cancelled = false
    api
      .discSetsOverview()
      .then((rows) => {
        if (!cancelled) setSets(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Arriving from a click elsewhere in the app: open that set once, then
  // tell the parent it's been handled so switching tabs away and back
  // doesn't reopen it.
  useEffect(() => {
    if (initialSet === null) return
    const icon = sets?.find((s) => s.set_name === initialSet.name)?.icon ?? ''
    setSelected({ ...initialSet, icon })
    onConsumeInitialSet()
  }, [initialSet, sets, onConsumeInitialSet])

  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => {
    if (sets === null) return []
    if (needle === '') return sets
    return sets.filter(
      (row) =>
        row.set_name.toLowerCase().includes(needle) ||
        row.top_users.some((u) => u.agent_name.toLowerCase().includes(needle))
    )
  }, [sets, needle])

  const suggestions: Suggestion[] = useMemo(
    () =>
      (sets ?? []).map((row) => ({
        name: row.set_name,
        icon: row.icon,
        owned: row.top_users.some((u) => u.owned),
        meta:
          row.top_users.length === 0
            ? 'No cached recommendation'
            : `Best for ${row.top_users[0]?.agent_name ?? ''}`
      })),
    [sets]
  )

  return (
    <div className="disks">
      <div className="disks-bar">
        <h2 className="display disks-title">Drive Discs</h2>
        <AgentSearch
          className="disks-search"
          value={query}
          onChange={setQuery}
          onPick={(name) => setQuery(name)}
          suggestions={suggestions}
          placeholder="Find a set or an agent"
        />
      </div>

      {selected !== null ? (
        <div className="disks-detail">
          <BackBar
            label={selected.returnTo !== null ? selected.returnTo.agentName : 'Drive Discs'}
            onBack={() => {
              // Back to the agent this set was opened from, when there is
              // one — otherwise this is just "back to the grid".
              if (selected.returnTo !== null) onReturnToAgent(selected.returnTo.agentId)
              else setSelected(null)
            }}
          />
          <div className="disks-detail-body">
            <CodexPage target={{ kind: 'set', name: selected.name, icon: selected.icon }} />
          </div>
        </div>
      ) : (
        <div className="disks-body">
          {farming.length > 0 && (
            <Panel className={`disks-farming ${farmOpen ? '' : 'is-collapsed'}`} tick>
              <h3 className="disks-farming-head">
                <button
                  type="button"
                  className="disks-farming-toggle"
                  onClick={() => setFarmOpen((open) => !open)}
                  aria-expanded={farmOpen}
                  aria-controls="farm-list"
                >
                  <span className="display disks-farming-title">Farm next</span>
                  {!farmOpen && (
                    <Tech className="disks-farming-count">
                      {farming.length} target{farming.length === 1 ? '' : 's'}
                    </Tech>
                  )}
                  <span className="disks-farming-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              </h3>

              {farmOpen && (
                <ol className="farm-list" id="farm-list">
                  {farming.map((priority) => (
                    <FarmRow key={priority.label} priority={priority} />
                  ))}
                </ol>
              )}
            </Panel>
          )}

          {error !== '' ? (
            <EmptyState title="Couldn't load sets">{error}</EmptyState>
          ) : sets === null ? (
            <EmptyState title={loading ? 'Loading' : 'Loading sets'}>
              Pulling the Drive Disc catalog.
            </EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState title="No match">
              {needle !== ''
                ? `No set or user matches "${query.trim()}".`
                : 'The catalog has no sets to show.'}
            </EmptyState>
          ) : (
            <div className="disks-grid">
              {visible.map((row) => (
                <SetTile
                  key={row.set_name}
                  row={row}
                  onOpen={() => setSelected({ name: row.set_name, icon: row.icon, returnTo: null })}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SetTile({ row, onOpen }: { row: DiscSetOverview; onOpen: () => void }): React.JSX.Element {
  return (
    <motion.button
      type="button"
      className="disk-tile"
      onClick={onOpen}
      layout={false}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.12 }}
    >
      <div className="disk-tile-head">
        <ItemIcon src={row.icon} size={54} />
        <span className="disk-tile-name">{row.set_name}</span>
      </div>

      {row.top_users.length === 0 ? (
        <p className="disk-tile-empty">No cached recommendation yet.</p>
      ) : (
        <ul className="disk-tile-users">
          {row.top_users.slice(0, 6).map((user) => (
            <li
              key={user.agent_name}
              className={`disk-tile-user ${user.owned ? 'is-owned' : 'is-missing'}`}
              title={
                user.rank > 0
                  ? `${user.agent_name} — #${user.rank} pick`
                  : user.agent_name
              }
            >
              {user.icon !== '' ? (
                <img src={user.icon} alt={user.agent_name} loading="lazy" draggable={false} />
              ) : (
                <span className="disk-tile-user-blank">{user.agent_name.slice(0, 2)}</span>
              )}
              {user.rank === 1 && <span className="disk-tile-best" aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </motion.button>
  )
}

/** One farming target: the set (or agent) art, then who it serves. Identical
 *  markup to the row that used to live in the Teams tab. */
function FarmRow({ priority }: { priority: FarmingPriority }): React.JSX.Element {
  return (
    <li className="farm-row">
      <ItemIcon src={priority.icon} size={58} />

      <div className="farm-text">
        <strong>{priority.label}</strong>
        <span className="farm-reason">{priority.reason}</span>

        {priority.agents.length > 0 && (
          <ul className="farm-users">
            {priority.agents.map((user) => (
              <li
                key={user.name}
                className={`farm-user ${user.owned ? 'is-owned' : 'is-missing'}`}
                title={user.owned ? user.name : `${user.name} — not owned`}
              >
                {user.icon !== '' ? (
                  <img src={user.icon} alt={user.name} loading="lazy" draggable={false} />
                ) : (
                  <span className="farm-user-blank">{user.name.slice(0, 2)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}
