/**
 * Team detail overlay.
 *
 * Laid out like the in-game team-select screen: the members side by side as
 * large portrait cards, each with its own gear stacked underneath — W-Engine,
 * disc sets, then the stat priorities. Columns share a row rhythm so the three
 * builds can be read across, which is the whole point of showing them together.
 *
 * Each member's detail is fetched from /agents/{id}, the same endpoint the
 * character overlay uses, so the two can never disagree.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { api } from '../api'
import type { Agent, AgentDetail, TeamMember, TeamStatus } from '../types'
import { Chip, ItemIcon, Meter, Portrait, Tech } from './Ui'
import './TeamModal.css'

interface Props {
  team: TeamStatus
  /** The full roster, used to resolve member names to agent ids. */
  agents: Agent[]
  origin: DOMRect
  onClose: () => void
}

/** Same folding rule the backend matches on. */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function resolveAgent(name: string, agents: Agent[]): Agent | undefined {
  const key = normalise(name)
  return agents.find((a) => normalise(a.name) === key || normalise(a.full_name) === key)
}

export function TeamModal({ team, agents, origin, onClose }: Props): React.JSX.Element {
  const reduced = useReducedMotion() ?? false
  const [expanded, setExpanded] = useState(reduced)
  const [details, setDetails] = useState<Record<string, AgentDetail | null>>({})

  const members: TeamMember[] =
    team.team.members.length > 0
      ? team.team.members
      : team.team.agent_names.map((name) => ({ name, icon: '', card_icon: '', slug: '' }))

  useEffect(() => {
    let cancelled = false

    void Promise.all(
      members.map(async (member) => {
        const agent = resolveAgent(member.name, agents)
        if (agent === undefined) return [member.name, null] as const
        try {
          return [member.name, await api.agentDetail(agent.id)] as const
        } catch {
          // One member failing must not blank the whole team.
          return [member.name, null] as const
        }
      })
    ).then((entries) => {
      if (!cancelled) setDetails(Object.fromEntries(entries))
    })

    return () => {
      cancelled = true
    }
    // Members are derived from the team, which does not change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, agents])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const from = {
    top: origin.top,
    left: origin.left,
    width: origin.width,
    height: origin.height,
    opacity: 0.5
  }

  return (
    <div className="ov" role="dialog" aria-modal="true" aria-label={team.team.agent_names.join(', ')}>
      <motion.div
        className="ov-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      <motion.div
        className="ov-panel"
        initial={reduced ? { opacity: 0 } : from}
        animate={
          reduced
            ? { opacity: 1 }
            : {
                top: 22,
                left: 22,
                width: 'calc(100vw - 44px)',
                height: 'calc(100vh - 44px)',
                opacity: 1
              }
        }
        exit={reduced ? { opacity: 0 } : { ...from, opacity: 0 }}
        transition={
          reduced
            ? { duration: 0.12 }
            : { type: 'spring', stiffness: 300, damping: 32 }
        }
        onAnimationComplete={() => setExpanded(true)}
      >
        <button type="button" className="ov-close" onClick={onClose} aria-label="Close">
          ✕
        </button>

        <AnimatePresence>
          {expanded && (
            <motion.div
              className="ov-body"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <header className="tm-head">
                <div>
                  <h2 className="display tm-title">{team.team.agent_names.join('  ·  ')}</h2>
                  {team.team.note !== '' && <Tech>{team.team.note}</Tech>}
                </div>

                <div className="tm-status">
                  {team.fieldable ? (
                    <Chip tone="good">Ready</Chip>
                  ) : (
                    <Chip tone="gold">{team.missing_members.length} missing</Chip>
                  )}
                  {team.fieldable && (
                    <div className="tm-readiness">
                      <Tech>Build readiness</Tech>
                      <Meter
                        value={team.readiness}
                        tone={
                          team.readiness > 0.8 ? 'good' : team.readiness > 0.5 ? 'gold' : 'warn'
                        }
                      />
                    </div>
                  )}
                </div>
              </header>

              <div className="tm-members" style={{ '--slots': members.length } as React.CSSProperties}>
                {members.map((member, slot) => (
                  <MemberColumn
                    key={`${member.name}-${slot}`}
                    member={member}
                    owned={team.owned_members.includes(member.name)}
                    detail={details[member.name] ?? null}
                    loaded={member.name in details}
                  />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function MemberColumn({
  member,
  owned,
  detail,
  loaded
}: {
  member: TeamMember
  owned: boolean
  detail: AgentDetail | null
  loaded: boolean
}): React.JSX.Element {
  const build = detail?.build ?? null
  const guide = detail?.guide ?? null
  const agent = detail?.agent ?? null
  // Card art first, deliberately. HoYoLAB's icons are 152x186 and 180x64;
  // shown at column width they are both blurry and absurdly cropped, which is
  // why owned agents looked wrong next to un-owned ones.
  const portrait = member.card_icon || agent?.card_icon || ''
  const portraitFallback = member.icon || agent?.square_icon || ''

  return (
    <section className={`tm-col ${owned ? 'is-owned' : 'is-missing'}`}>
      <div className="tm-portrait">
        <Portrait
          src={portrait}
          fallback={portraitFallback}
          initials={member.name.slice(0, 2)}
        />

        <span className="tm-portrait-strip">
          <span className="tm-name display">{member.name}</span>
          <span className="tm-sub">
            {owned && build !== null ? (
              <>
                <b>LV.{build.level}</b>
                <span>M{build.mindscape}</span>
              </>
            ) : (
              <span className="tm-notowned">Not owned</span>
            )}
          </span>
        </span>
      </div>

      <div className="tm-gear">
        {!loaded ? (
          <p className="tm-empty">Loading…</p>
        ) : (
          <>
            {/* ---- equipped, only meaningful for agents you own ---- */}
            {owned && (
              <>
                <h4 className="tm-sub-head">Equipped</h4>
                {build?.w_engine != null ? (
                  <div className="tm-row">
                    <ItemIcon src={build.w_engine.icon} rarity={build.w_engine.rarity} size={40} />
                    <div className="tm-row-text">
                      <strong>{build.w_engine.name}</strong>
                      <Tech>
                        Lv {build.w_engine.level} · S{build.w_engine.refinement}
                      </Tech>
                    </div>
                  </div>
                ) : (
                  <p className="tm-empty">No W-Engine equipped.</p>
                )}

                {build !== null && build.discs.length > 0 ? (
                  <ul className="tm-list">
                    {build.discs.map((disc) => (
                      <li key={disc.id} className="tm-row">
                        <span className="tm-slot">{disc.position}</span>
                        <ItemIcon src={disc.icon} rarity={disc.rarity} size={34} />
                        <div className="tm-row-text">
                          <strong>{disc.set_name || disc.name}</strong>
                          {disc.main_stat !== null && (
                            <Tech>
                              {disc.main_stat.name} {disc.main_stat.value}
                            </Tech>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="tm-empty">No discs equipped.</p>
                )}
              </>
            )}

            {/* ---- recommended, shown for everyone including un-owned ---- */}
            <h4 className="tm-sub-head">Best W-Engines</h4>
            {guide === null || guide.engines.length === 0 ? (
              <p className="tm-empty">No guide cached.</p>
            ) : (
              <ol className="tm-list">
                {guide.engines.slice(0, 3).map((engine) => (
                  <li key={engine.name} className="tm-row">
                    <span className="tm-rank">{engine.rank}</span>
                    <ItemIcon src={engine.icon} size={34} rarity={engine.rarity} />
                    <div className="tm-row-text">
                      <strong>{engine.name}</strong>
                      {engine.recommended_superimpose > 0 && (
                        <Tech>S{engine.recommended_superimpose}</Tech>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {guide !== null && guide.disc_sets.length > 0 && (
              <>
                <h4 className="tm-sub-head">Disc sets</h4>
                <ul className="tm-list">
                  {guide.disc_sets.slice(0, 4).map((set) => (
                    <li key={`${set.set_name}-${set.pieces}`} className="tm-row">
                      <span className={`tm-pc ${set.pieces === 4 ? 'is-four' : ''}`}>
                        {set.pieces}PC
                      </span>
                      <ItemIcon src={set.icon} size={34} />
                      <div className="tm-row-text">
                        <strong>{set.set_name}</strong>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {guide !== null && guide.substat_priority.length > 0 && (
              <>
                <h4 className="tm-sub-head">Substats</h4>
                <p className="tm-priority">{guide.substat_priority.join(' > ')}</p>
              </>
            )}

            {guide !== null && Object.keys(guide.main_stats).length > 0 && (
              <>
                <h4 className="tm-sub-head">Main stats</h4>
                <ul className="tm-mains">
                  {Object.entries(guide.main_stats).map(([slot, stats]) => (
                    <li key={slot}>
                      <span className="tm-slot">{slot}</span>
                      <span>{stats.join(' / ')}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}
