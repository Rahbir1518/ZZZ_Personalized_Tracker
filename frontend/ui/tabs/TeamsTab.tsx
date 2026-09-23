/**
 * Teams tab, with two sub-tabs:
 *
 *  - Suggested  — comps you are missing pieces of, nearest-first.
 *  - My Teams   — recommended comps every member of which you own.
 *
 * Suggested leads and opens by default: it is the one that tells you what to
 * do next. My Teams is a record of what you have already finished, and for a
 * roster with no complete comps yet it is empty.
 *
 * Farm Next used to live in this tab; it moved to Disks (see App.tsx), which
 * answers the matching question from the other direction — this tab is about
 * comps, that one is about sets.
 */

import { useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Chip, EmptyState, Meter, Panel, Tech } from '../components/Ui'
import { TeamModal } from '../components/TeamModal'
import { TeamSynergy } from '../components/TeamSynergy'
import { AgentSearch, type Suggestion } from '../components/AgentSearch'
import { sortPinnedFirst, usePinnedTeams } from '../hooks/usePinnedTeams'
import type { Agent, Analysis, TeamMember, TeamStatus } from '../types'
import './TeamsTab.css'

/** The key a team is pinned/keyed under everywhere in this tab. */
function teamKey(team: TeamStatus): string {
  return team.team.agent_names.join('|')
}

type SubTab = 'mine' | 'suggested'

interface Props {
  analysis: Analysis | null
  /** Roster, so a team member's name can be resolved to an agent id. */
  agents: Agent[]
  loading: boolean
  /** A disc-set click inside the team modal goes here instead of opening
   *  in place — see DisksTab.tsx. */
  onNavigateToSet: (name: string) => void
}

/** Match a team on any member's name. */
function matchesQuery(team: TeamStatus, needle: string): boolean {
  if (needle === '') return true
  return team.team.agent_names.some((name) => name.toLowerCase().includes(needle))
}

export function TeamsTab({
  analysis,
  agents,
  loading,
  onNavigateToSet
}: Props): React.JSX.Element {
  const [sub, setSub] = useState<SubTab>('suggested')
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<{ team: TeamStatus; origin: DOMRect } | null>(null)
  const pins = usePinnedTeams()

  const allMine = analysis?.my_teams ?? []
  const allSuggested = analysis?.suggested_teams ?? []

  const needle = query.trim().toLowerCase()
  const mine = useMemo(
    () => sortPinnedFirst(allMine.filter((team) => matchesQuery(team, needle)), teamKey, pins),
    [allMine, needle, pins]
  )
  const suggested = useMemo(
    () =>
      sortPinnedFirst(allSuggested.filter((team) => matchesQuery(team, needle)), teamKey, pins),
    [allSuggested, needle, pins]
  )

  const filtering = needle !== ''
  const shown = sub === 'mine' ? mine.length : suggested.length
  const total = sub === 'mine' ? allMine.length : allSuggested.length

  const bodyRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  /**
   * How many teams in each sub-tab include a given agent. Counting both means
   * a pick can move the user to whichever sub-tab actually has their teams,
   * instead of silently filtering the current one down to nothing.
   */
  const teamCounts = useMemo(() => {
    const counts = new Map<string, { mine: number; suggested: number }>()
    const tally = (pool: TeamStatus[], key: 'mine' | 'suggested'): void => {
      for (const status of pool) {
        for (const name of status.team.agent_names) {
          const entry = counts.get(name) ?? { mine: 0, suggested: 0 }
          entry[key] += 1
          counts.set(name, entry)
        }
      }
    }
    tally(allMine, 'mine')
    tally(allSuggested, 'suggested')
    return counts
  }, [allMine, allSuggested])

  /**
   * Every agent on the roster is offered, not only the ones already on screen.
   * Restricting the list to the current sub-tab's teams meant a player with no
   * complete comps saw no suggestions at all — the dropdown looked broken when
   * it was merely empty.
   */
  const suggestionsList: Suggestion[] = useMemo(() => {
    const fromRoster = agents.map((agent) => {
      const count = teamCounts.get(agent.name) ?? { mine: 0, suggested: 0 }
      const total = count.mine + count.suggested
      return {
        name: agent.name,
        icon: agent.card_icon || agent.square_icon,
        owned: agent.owned,
        weight: total,
        meta: `${agent.owned ? 'Owned' : 'Not owned'} · ${total} team${total === 1 ? '' : 's'}`
      }
    })

    // A guide can name an agent the catalog does not (alternate versions,
    // mostly). Keep those rather than making them unsearchable.
    const known = new Set(fromRoster.map((s) => s.name))
    const extra: Suggestion[] = []
    for (const [name, count] of teamCounts) {
      if (known.has(name)) continue
      const total = count.mine + count.suggested
      extra.push({
        name,
        icon: '',
        owned: false,
        weight: total,
        meta: `Not owned · ${total} team${total === 1 ? '' : 's'}`
      })
    }

    return [...fromRoster, ...extra].sort((a, b) => a.name.localeCompare(b.name))
  }, [agents, teamCounts])

  /**
   * Go to an agent's teams: switch to the sub-tab that has them, then bring
   * the grid into view. Without the switch, picking an agent you only have
   * partial comps for would land on an empty "My Teams".
   */
  const goToAgent = (name: string): void => {
    const count = teamCounts.get(name)
    if (count !== undefined && count.mine === 0 && count.suggested > 0) {
      setSub('suggested')
    } else if (count !== undefined && count.suggested === 0 && count.mine > 0) {
      setSub('mine')
    }

    // Two frames: the first lets React commit the sub-tab switch and the new
    // filter, the second measures a grid that actually exists.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const grid = gridRef.current
        const body = bodyRef.current
        if (grid === null || body === null) return
        body.scrollTo({
          top: Math.max(0, grid.offsetTop - body.offsetTop - 8),
          behavior: 'smooth'
        })
      })
    })
  }

  return (
    <div className="teams">
      <div className="teams-subtabs" role="tablist" aria-label="Teams view">
        <button
          type="button"
          role="tab"
          aria-selected={sub === 'suggested'}
          className={`btn ${sub === 'suggested' ? 'btn-active' : ''}`}
          onClick={() => setSub('suggested')}
        >
          Suggested ({allSuggested.length})
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={sub === 'mine'}
          className={`btn ${sub === 'mine' ? 'btn-active' : ''}`}
          onClick={() => setSub('mine')}
        >
          My Teams ({allMine.length})
        </button>

        <AgentSearch
          className="teams-search"
          value={query}
          onChange={setQuery}
          onPick={goToAgent}
          suggestions={suggestionsList}
          placeholder="Find a team by agent"
        />

        {filtering && (
          <span className="teams-search-count">
            {shown} of {total}
          </span>
        )}
      </div>

      <div className="teams-body" ref={bodyRef}>
        {sub === 'mine' ? (
          mine.length === 0 ? (
            <EmptyState
              title={
                loading ? 'Crunching…' : filtering ? 'No match' : 'No full teams yet'
              }
            >
              {loading
                ? 'Joining your roster with the recommendations.'
                : filtering
                  ? `No team here includes an agent matching "${query.trim()}".`
                  : 'Once you own every member of a recommended comp, it shows up here.'}
            </EmptyState>
          ) : (
            <div className="teams-grid" ref={gridRef}>
              {mine.map((team) => (
                <TeamCard
                  key={teamKey(team)}
                  team={team}
                  pinned={pins.isPinned(teamKey(team))}
                  onTogglePin={() => pins.toggle(teamKey(team))}
                  onOpen={(t, origin) => setOpened({ team: t, origin })}
                />
              ))}
            </div>
          )
        ) : (
          <div className="teams-suggested">
            {suggested.length === 0 ? (
              <EmptyState
                title={
                  loading ? 'Crunching…' : filtering ? 'No match' : 'Nothing to suggest yet'
                }
              >
                {filtering
                  ? `No suggested team includes an agent matching "${query.trim()}".`
                  : 'Run a sync to pull recommendations.'}
              </EmptyState>
            ) : (
              <div className="teams-grid" ref={gridRef}>
                {suggested.map((team) => (
                  <TeamCard
                    key={teamKey(team)}
                    team={team}
                    pinned={pins.isPinned(teamKey(team))}
                    onTogglePin={() => pins.toggle(teamKey(team))}
                    onOpen={(t, origin) => setOpened({ team: t, origin })}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <AnimatePresence>
        {opened !== null && (
          <TeamModal
            team={opened.team}
            agents={agents}
            origin={opened.origin}
            onClose={() => setOpened(null)}
            onNavigateToSet={onNavigateToSet}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function TeamCard({
  team,
  pinned,
  onTogglePin,
  onOpen
}: {
  team: TeamStatus
  pinned: boolean
  onTogglePin: () => void
  onOpen: (team: TeamStatus, origin: DOMRect) => void
}): React.JSX.Element {
  const missing = team.missing_members.length
  const owned = new Set(team.owned_members)

  // Prefer the parsed members (they carry portraits); fall back to bare names
  // if a guide predates the icons being captured.
  const roster: TeamMember[] =
    team.team.members.length > 0
      ? team.team.members
      : team.team.agent_names.map((name) => ({ name, icon: '', card_icon: '', slug: '' }))

  return (
    <Panel className={`team-card ${pinned ? 'is-pinned' : ''}`}>
      <button
        type="button"
        className="team-card-hit"
        onClick={(e) =>
          onOpen(team, (e.currentTarget.parentElement ?? e.currentTarget).getBoundingClientRect())
        }
        aria-label={`Open ${team.team.agent_names.join(', ')}`}
      />
      <header className="team-card-head">
        <h3 className="display team-card-title">{team.team.agent_names.join('  ·  ')}</h3>
        <TeamSynergy team={team} />
        <PinButton pinned={pinned} onToggle={onTogglePin} />
        {team.fieldable ? (
          <Chip tone="good">Ready</Chip>
        ) : (
          <Chip tone="gold">{missing} missing</Chip>
        )}
      </header>

      {team.team.note !== '' && <p className="team-card-note">{team.team.note}</p>}

      <ul className="team-portraits">
        {roster.map((member, slot) => {
          const isOwned = owned.has(member.name)
          return (
            <li
              key={`${member.name}-${slot}`}
              className={`team-portrait ${isOwned ? 'is-owned' : 'is-missing'}`}
              title={isOwned ? member.name : `${member.name} — not owned`}
            >
              <span className="team-portrait-art">
                {member.icon !== '' ? (
                  <img src={member.icon} alt="" loading="lazy" draggable={false} />
                ) : (
                  <span className="team-portrait-initials display">{member.name.slice(0, 2)}</span>
                )}
              </span>
              <span className="team-portrait-name">{member.name}</span>
            </li>
          )
        })}
      </ul>

      {team.fieldable && (
        <div className="team-card-readiness">
          <Tech>Build readiness</Tech>
          <Meter
            value={team.readiness}
            tone={team.readiness > 0.8 ? 'good' : team.readiness > 0.5 ? 'gold' : 'warn'}
          />
        </div>
      )}

      {!team.fieldable && missing === 1 && (
        <p className="team-card-hint">One agent away — {team.missing_members[0]} unlocks this comp.</p>
      )}
    </Panel>
  )
}

/**
 * Pinned teams sort to the top of their list (see `sortPinnedFirst`). A
 * filled vs. outline pin is the whole affordance — no extra label needed
 * once you've clicked it once and seen the card jump to the top.
 */
function PinButton({ pinned, onToggle }: { pinned: boolean; onToggle: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      className={`team-pin ${pinned ? 'is-pinned' : ''}`}
      aria-pressed={pinned}
      aria-label={pinned ? 'Unpin this team' : 'Pin this team to the top'}
      title={pinned ? 'Unpin' : 'Pin to top'}
      onClick={(event) => {
        // The card behind is one big click target; this button is not it.
        event.stopPropagation()
        onToggle()
      }}
    >
      {/* A standard tilted pushpin (Feather icons' `pin`), not a hand-guessed
          shape — recognizable as "pin this" at a glance, which the previous
          ad-hoc star/badge outline wasn't. */}
      <svg
        viewBox="0 0 24 24"
        width="14"
        height="14"
        fill={pinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M12 17v5" />
        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
      </svg>
    </button>
  )
}
