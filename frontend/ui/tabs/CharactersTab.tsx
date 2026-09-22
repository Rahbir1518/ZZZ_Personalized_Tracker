/**
 * Characters tab: the roster grid.
 *
 * Modelled on the in-game agent-selection screen — a dense scrollable grid of
 * card tiles. Shows the full catalog; un-owned agents are dimmed ghosts.
 */

import { useMemo, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { AgentTile } from '../components/AgentTile'
import { AgentModal } from '../components/AgentModal'
import { EmptyState } from '../components/ComicBits'
import type { Agent, BuildGap } from '../types'
import './CharactersTab.css'

type Filter = 'all' | 'owned' | 'missing'

interface Props {
  agents: Agent[]
  gaps: BuildGap[]
  loading: boolean
}

export function CharactersTab({ agents, gaps, loading }: Props): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<{ agent: Agent; origin: DOMRect } | null>(null)

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

  const ownedCount = useMemo(() => agents.filter((a) => a.owned).length, [agents])

  return (
    <div className="characters">
      <div className="characters-toolbar">
        <div className="characters-filters" role="group" aria-label="Filter roster">
          {(['all', 'owned', 'missing'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={`ink-button ink-button-quiet ${filter === value ? 'is-active' : ''}`}
              onClick={() => setFilter(value)}
              aria-pressed={filter === value}
            >
              {value === 'all' ? 'All' : value === 'owned' ? 'Owned' : 'Missing'}
            </button>
          ))}
        </div>

        <input
          className="characters-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an agent…"
          aria-label="Search agents"
        />

        <span className="characters-count">
          {ownedCount} / {agents.length} owned
        </span>
      </div>

      {visible.length === 0 ? (
        <EmptyState title={loading ? 'Loading roster…' : 'Nothing here'}>
          {loading
            ? 'Fetching your agents.'
            : agents.length === 0
              ? 'Hit Sync to pull your roster from HoYoLAB.'
              : 'No agents match that filter.'}
        </EmptyState>
      ) : (
        <div className="characters-grid">
          {visible.map((agent) => (
            <AgentTile
              key={agent.id}
              agent={agent}
              gap={gapByAgentId.get(agent.id)}
              onOpen={(a, origin) => setSelected({ agent: a, origin })}
            />
          ))}
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
