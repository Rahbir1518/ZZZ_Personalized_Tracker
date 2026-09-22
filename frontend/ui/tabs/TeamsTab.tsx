/**
 * Teams tab, with two sub-tabs:
 *
 *  - Suggested  — comps you are missing pieces of, nearest-first, plus the
 *                 farming priorities derived from the same join.
 *  - My Teams   — recommended comps every member of which you own.
 *
 * Suggested leads and opens by default: it is the one that tells you what to
 * do next. My Teams is a record of what you have already finished, and for a
 * roster with no complete comps yet it is empty.
 */

import { useMemo, useRef, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { Chip, EmptyState, ItemIcon, Meter, Panel, Tech } from '../components/Ui'
import { TeamModal } from '../components/TeamModal'
import { TeamSynergy } from '../components/TeamSynergy'
import { AgentSearch, type Suggestion } from '../components/AgentSearch'
import type { Agent, Analysis, FarmingPriority, TeamMember, TeamStatus } from '../types'
import './TeamsTab.css'

type SubTab = 'mine' | 'suggested'

interface Props {
  analysis: Analysis | null
  /** Roster, so a team member's name can be resolved to an agent id. */
  agents: Agent[]
  loading: boolean
}

/** Match a team on any member's name. */
function matchesQuery(team: TeamStatus, needle: string): boolean {
  if (needle === '') return true
  return team.team.agent_names.some((name) => name.toLowerCase().includes(needle))
}

export function TeamsTab({ analysis, agents, loading }: Props): React.JSX.Element {
  const [sub, setSub] = useState<SubTab>('suggested')
  // The farming list is long and sits above the suggested teams, so it is
  // worth being able to fold it away and get straight to the comps.
  const [farmOpen, setFarmOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<{ team: TeamStatus; origin: DOMRect } | null>(null)

  const allMine = analysis?.my_teams ?? []
  const allSuggested = analysis?.suggested_teams ?? []
  const farming = analysis?.farming ?? []

  const needle = query.trim().toLowerCase()
  const mine = useMemo(
    () => allMine.filter((team) => matchesQuery(team, needle)),
    [allMine, needle]
  )
  const suggested = useMemo(
    () => allSuggested.filter((team) => matchesQuery(team, needle)),
    [allSuggested, needle]
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
                  key={team.team.agent_names.join('|')}
                  team={team}
                  onOpen={(t, origin) => setOpened({ team: t, origin })}
                />
              ))}
            </div>
          )
        ) : (
          <div className="teams-suggested">
            {farming.length > 0 && (
              <Panel className={`teams-farming ${farmOpen ? '' : 'is-collapsed'}`} tick>
                {/* Heading wrapping a button: the accordion pattern, so the
                    section keeps its place in the document outline while the
                    whole header stays clickable. */}
                <h3 className="teams-farming-head">
                  <button
                    type="button"
                    className="teams-farming-toggle"
                    onClick={() => setFarmOpen((open) => !open)}
                    aria-expanded={farmOpen}
                    aria-controls="farm-list"
                  >
                    <span className="display teams-farming-title">Farm next</span>
                    {!farmOpen && (
                      <Tech className="teams-farming-count">
                        {farming.length} target{farming.length === 1 ? '' : 's'}
                      </Tech>
                    )}
                    <span className="teams-farming-chevron" aria-hidden="true">
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
                    key={team.team.agent_names.join('|')}
                    team={team}
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
          />
        )}
      </AnimatePresence>
    </div>
  )
}

/** One farming target: the set (or agent) art, then who it serves. */
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

function TeamCard({
  team,
  onOpen
}: {
  team: TeamStatus
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
    <Panel className="team-card">
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
