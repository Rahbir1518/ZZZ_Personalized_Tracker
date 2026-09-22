/**
 * Characters: the agent roster.
 *
 * Composed as one tilted sheet of cards rather than a rectangular grid — the
 * container carries a skew and each tile counter-skews its face, so the block
 * reads as a printed collection set down at an angle while every portrait and
 * label stays upright.
 */

import { useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AgentTile } from '../components/AgentTile'
import { AgentModal } from '../components/AgentModal'
import { AgentSearch, type Suggestion } from '../components/AgentSearch'
import { EmptyState, Tech } from '../components/Ui'
import type { Agent, BuildGap } from '../types'
import './CharactersTab.css'

type Filter = 'all' | 'owned' | 'missing'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'owned', label: 'Owned' },
  { id: 'missing', label: 'Missing' }
]

interface Props {
  agents: Agent[]
  gaps: BuildGap[]
  loading: boolean
}

export function CharactersTab({ agents, gaps, loading }: Props): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{ agent: Agent; origin: DOMRect } | null>(null)
  const [focused, setFocused] = useState<number | null>(null)

  const gapByAgentId = useMemo(() => {
    const map = new Map<number, BuildGap>()
    for (const gap of gaps) map.set(gap.agent_id, gap)
    return map
  }, [gaps])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return agents.filter((agent) => {
      if (filter === 'owned' && !agent.owned) return false
      if (filter === 'missing' && agent.owned) return false
      if (needle !== '' && !agent.name.toLowerCase().includes(needle)) return false
      return true
    })
  }, [agents, filter, query])

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
          />
        )}
      </AnimatePresence>
    </div>
  )
}
