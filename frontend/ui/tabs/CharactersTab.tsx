/**
 * Characters: the agent roster.
 *
 * Composed as one tilted sheet of cards rather than a rectangular grid — the
 * container carries a skew and each tile counter-skews its face, so the block
 * reads as a printed collection set down at an angle while every portrait and
 * label stays upright.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AgentTile } from '../components/AgentTile'
import { AgentModal } from '../components/AgentModal'
import { AgentSearch, type Suggestion } from '../components/AgentSearch'
import { EmptyState, Tech } from '../components/Ui'
import type { Agent, BuildGap, TeamStatus } from '../types'
import './CharactersTab.css'

type Filter = 'all' | 'owned' | 'missing'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'missing', label: 'Missing' }
]

type Sort = 'default' | 'level-desc' | 'level-asc' | 'priority'

const SORTS: { id: Sort; label: string; hint: string }[] = [
  { id: 'default', label: 'Roster order', hint: 'As the catalog lists them' },
  { id: 'level-desc', label: 'Highest level first', hint: 'Your most-invested agents' },
  { id: 'level-asc', label: 'Lowest level first', hint: 'Who still needs levelling' },
  {
    id: 'priority',
    label: 'Build priority',
    hint: 'Agents who show up in the most recommended teams first'
  }
]

interface Props {
  agents: Agent[]
  gaps: BuildGap[]
  /** For "Build priority": how many recommended comps an agent shows up in. */
  myTeams: TeamStatus[]
  suggestedTeams: TeamStatus[]
  loading: boolean
  /** A disc-set click inside the agent modal goes here instead of opening
   *  in place — see DisksTab.tsx. */
  onNavigateToSet: (name: string, returnTo?: { agentId: number; agentName: string }) => void
  /** Set when the Disks tab's back button is sending the person back to the
   *  agent they clicked a set from — reopens that agent's modal once the
   *  tile exists to animate from. Consumed once, same pattern as Disks'
   *  own `initialSet`. */
  initialAgentId: number | null
  onConsumeInitialAgent: () => void
}

export function CharactersTab({
  agents,
  gaps,
  myTeams,
  suggestedTeams,
  loading,
  onNavigateToSet,
  initialAgentId,
  onConsumeInitialAgent
}: Props): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('default')
  const [sortOpen, setSortOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{ agent: Agent; origin: DOMRect } | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const sortRef = useRef<HTMLDivElement>(null)

  const gapByAgentId = useMemo(() => {
    const map = new Map<number, BuildGap>()
    for (const gap of gaps) map.set(gap.agent_id, gap)
    return map
  }, [gaps])

  /**
   * "Build priority": how many recommended comps (My Teams + Suggested,
   * combined — a comp you're still missing pieces of is still evidence this
   * agent is worth building) an agent's name shows up in. An agent who slots
   * into a lot of teams pays off building sooner than one only one comp
   * wants.
   */
  const teamAppearances = useMemo(() => {
    const counts = new Map<string, number>()
    for (const status of [...myTeams, ...suggestedTeams]) {
      for (const name of status.team.agent_names) {
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }
    return counts
  }, [myTeams, suggestedTeams])

  // Close the sort menu on an outside click, same convention as the
  // agent-search and goal-picker dropdowns elsewhere in the app.
  useEffect(() => {
    if (!sortOpen) return
    const onDocDown = (event: MouseEvent): void => {
      if (sortRef.current !== null && !sortRef.current.contains(event.target as Node)) {
        setSortOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [sortOpen])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = agents.filter((agent) => {
      if (filter === 'owned' && !agent.owned) return false
      if (filter === 'missing' && agent.owned) return false
      if (needle !== '' && !agent.name.toLowerCase().includes(needle)) return false
      return true
    })

    if (sort === 'default') {
      // Owned still leads even with no explicit sort — a roster screen that
      // buries your own agents under ghost tiles by catalog order alone
      // reads as broken, not neutral.
      return [...filtered].sort((a, b) => Number(b.owned) - Number(a.owned))
    }

    const rank = (agent: Agent): number => {
      if (sort === 'priority') return teamAppearances.get(agent.name) ?? 0
      // Absent level (an unowned ghost tile) sorts last within its own
      // group either way, which is where "no data" belongs regardless of
      // direction.
      return agent.level ?? -1
    }
    // Higher rank first for both "highest level" and "priority"; only
    // "lowest level" reverses it.
    const byRank =
      sort === 'level-asc'
        ? (a: Agent, b: Agent): number => rank(a) - rank(b)
        : (a: Agent, b: Agent): number => rank(b) - rank(a)

    // Owned first as a whole group, THEN the chosen sort applied within
    // each group separately — an unowned S-rank must never outrank an
    // owned one just because "priority" or "level" says so.
    const owned = filtered.filter((a) => a.owned).sort(byRank)
    const unowned = filtered.filter((a) => !a.owned).sort(byRank)
    return [...owned, ...unowned]
  }, [agents, filter, query, sort, teamAppearances])

  /**
   * Suggestions cover the whole catalog, not the filtered view: searching for
   * an agent is how you find out you do not have them.
   */
  const suggestions: Suggestion[] = useMemo(
    () =>
      agents.map((agent) => ({
        name: agent.name,
        icon: agent.card_icon || agent.square_icon,
        owned: agent.owned,
        // Owned agents first among equally good name matches.
        weight: agent.owned ? 1 : 0,
        meta: agent.owned
          ? `Lv.${agent.level ?? 0} · M${agent.mindscape ?? 0}`
          : `Not owned · ${agent.rarity || '?'}-rank`
      })),
    [agents]
  )

  const tileRefs = useRef(new Map<number, HTMLButtonElement>())

  /**
   * Picking a suggestion clears the filter first: the agent may well be one
   * the current tab hides, and a search that finds nothing because of a filter
   * set earlier is the most annoying possible outcome.
   */
  const goToAgent = (name: string): void => {
    const agent = agents.find((a) => a.name === name)
    if (agent === undefined) return
    setFilter('all')
    setFocused(agent.id)

    // Two frames: one for React to re-render the unfiltered sheet, one to
    // measure the tile once it is in the document.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        tileRefs.current.get(agent.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    })
  }

  // Coming back from a set's detail page: reopen that agent's modal once its
  // tile actually exists in the (freshly mounted, unfiltered) sheet to
  // animate from — same two-frame wait `goToAgent` uses, for the same
  // reason: the first frame commits this render, the second finds a tile
  // that is actually there to measure.
  useEffect(() => {
    if (initialAgentId === null) return
    const agent = agents.find((a) => a.id === initialAgentId)
    if (agent === undefined) {
      onConsumeInitialAgent()
      return
    }
    setFocused(agent.id)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const origin = tileRefs.current.get(agent.id)?.getBoundingClientRect()
        if (origin !== undefined) setSelected({ agent, origin })
        onConsumeInitialAgent()
      })
    })
  }, [initialAgentId, agents, onConsumeInitialAgent])

  const ownedCount = useMemo(() => agents.filter((a) => a.owned).length, [agents])
  const builtCount = useMemo(
    () => gaps.filter((g) => g.severity === 'COMPLETE').length,
    [gaps]
  )

  return (
    <div className="roster">
      <div className="roster-bar">
        <div className="roster-filters" role="group" aria-label="Filter roster">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              className={`btn roster-filter ${filter === id ? 'btn-active' : ''}`}
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="roster-sort" ref={sortRef}>
          <button
            type="button"
            className={`btn roster-sort-toggle ${sort !== 'default' ? 'btn-active' : ''}`}
            onClick={() => setSortOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={sortOpen}
          >
            <SortIcon />
            {SORTS.find((s) => s.id === sort)?.label ?? 'Sort'}
          </button>

          {sortOpen && (
            <ul className="roster-sort-menu" role="listbox">
              {SORTS.map((option) => (
                <li key={option.id} role="option" aria-selected={sort === option.id}>
                  <button
                    type="button"
                    className={sort === option.id ? 'is-active' : ''}
                    onClick={() => {
                      setSort(option.id)
                      setSortOpen(false)
                    }}
                  >
                    <span className="roster-sort-label">{option.label}</span>
                    <Tech className="roster-sort-hint">{option.hint}</Tech>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <AgentSearch
          className="roster-search"
          value={query}
          onChange={setQuery}
          onPick={goToAgent}
          suggestions={suggestions}
          placeholder="Search agents"
        />

        <div className="roster-counts">
          <span className="roster-count">
            <b>{ownedCount}</b>
            <Tech>/ {agents.length} owned</Tech>
          </span>
          <span className="roster-count">
            <b>{builtCount}</b>
            <Tech>built</Tech>
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title={loading ? 'Loading roster' : 'No agents'}>
          {loading
            ? 'Pulling your roster from HoYoLAB.'
            : agents.length === 0
              ? 'Run a sync to pull your roster.'
              : 'Nothing matches that filter.'}
        </EmptyState>
      ) : (
        <div className="roster-scroll">
          {/* Decorative frame marks, cropped by the sheet's edges. */}
          <span className="roster-corner is-tl" aria-hidden="true" />
          <span className="roster-corner is-br" aria-hidden="true" />

          <div className="roster-sheet">
            {visible.map((agent) => (
              <AgentTile
                key={agent.id}
                ref={(node) => {
                  if (node === null) tileRefs.current.delete(agent.id)
                  else tileRefs.current.set(agent.id, node)
                }}
                agent={agent}
                gap={gapByAgentId.get(agent.id)}
                selected={focused === agent.id}
                onOpen={(a, origin) => {
                  setFocused(a.id)
                  setSelected({ agent: a, origin })
                }}
              />
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {selected !== null && (
          <AgentModal
            agent={selected.agent}
            origin={selected.origin}
            onClose={() => setSelected(null)}
            onNavigateToSet={onNavigateToSet}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/** A short stack of horizontal bars — reads as "sort/order" at a glance,
 *  distinct from the filter buttons beside it. */
function SortIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M4 12h11M4 17h6" />
    </svg>
  )
}
