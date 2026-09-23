/**
 * The agent detail overlay.
 *
 * Opens from the clicked tile: a panel animates from that tile's real DOMRect
 * out to full screen, so it reads as the card enlarging rather than a dialog
 * appearing centre-screen. Content is gated until the expand finishes, and
 * degrades to a plain fade under prefers-reduced-motion.
 *
 * Gear drills through in place. Clicking a W-Engine or a disc set pushes its
 * page onto this overlay's stack (see `useCodexStack`) instead of opening a
 * second dialog, so there is only ever one scrim and the back arrow has one
 * meaning: return to the agent you came from.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { api } from '../api'
import { useAgentGoal, type AgentGoal } from '../hooks/useAgentGoals'
import type { Agent, AgentBuild, AgentDetail, BuildGap } from '../types'
import { computeGoalGap, type GoalGap } from '../goalGap'
import { AgentGoals } from './AgentGoals'
import { BackBar, CodexPage, useCodexStack, type CodexTarget } from './Codex'
import { Chip, ItemIcon, Meter, RuleTitle, Tech } from './Ui'
import './AgentModal.css'

const EXPAND_MS = 340

interface Props {
  agent: Agent
  origin: DOMRect
  onClose: () => void
  /** A disc-set row (equipped or recommended) hands its name here and closes
   *  the modal, instead of drilling through in place — see DisksTab.tsx for
   *  why a set's full "who's it for" answer needs real space. Engine rows
   *  still drill through locally; only sets redirect. The second argument
   *  is this agent, passed along so the set's own back button can return
   *  here instead of only ever landing on the set grid. */
  onNavigateToSet: (name: string, returnTo?: { agentId: number; agentName: string }) => void
}

export function AgentModal({ agent, origin, onClose, onNavigateToSet }: Props): React.JSX.Element {
  const reduced = useReducedMotion() ?? false
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [expanded, setExpanded] = useState(reduced)
  const [error, setError] = useState('')
  const codex = useCodexStack()

  /** Engines still drill through the local codex stack; sets close this
   *  modal and hand off to the Disks tab instead. */
  const handleOpen = (target: CodexTarget): void => {
    if (target.kind === 'set') {
      onClose()
      onNavigateToSet(target.name, { agentId: agent.id, agentName: agent.name })
    } else {
      codex.open(target)
    }
  }

  useEffect(() => {
    let cancelled = false
    api
      .agentDetail(agent.id)
      .then((result) => {
        if (!cancelled) setDetail(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [agent.id])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      // Escape unwinds the stack one level at a time before it closes the
      // overlay — the same thing the back arrow does.
      if (codex.depth > 0) codex.back()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // The stack object is rebuilt each render; its two used members are not.
  }, [onClose, codex.depth, codex.back])

  const from = {
    top: origin.top,
    left: origin.left,
    width: origin.width,
    height: origin.height,
    opacity: 0.5
  }

  return (
    <div className="ov" role="dialog" aria-modal="true" aria-label={agent.name}>
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
            : { type: 'spring', stiffness: 300, damping: 32, duration: EXPAND_MS / 1000 }
        }
        onAnimationComplete={() => setExpanded(true)}
      >
        {codex.top !== null && <BackBar label={agent.name} onBack={codex.back} />}

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
              {codex.top !== null ? (
                <CodexPage target={codex.top} />
              ) : error !== '' ? (
                <p className="ov-error">{error}</p>
              ) : detail === null ? (
                <p className="ov-loading display">Loading</p>
              ) : (
                <DetailBody detail={detail} onOpen={handleOpen} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function DetailBody({
  detail,
  onOpen
}: {
  detail: AgentDetail
  onOpen: (target: CodexTarget) => void
}): React.JSX.Element {
  const { agent, build, guide, gap } = detail
  const portrait = agent.rectangle_icon || agent.square_icon
  // One call for the whole modal — the gap panel and the goal editor both
  // need to see the same live edits, not two independent copies that only
  // agree again once both remount. See useAgentGoal's own doc comment.
  const goalApi = useAgentGoal(agent.id)

  return (
    <div className="dt">
      <header className="dt-head">
        <span className="dt-portrait">
          {portrait !== '' ? <img src={portrait} alt="" /> : null}
        </span>

        <div className="dt-id">
          <h2 className="display dt-name">{agent.name}</h2>
          <p className="dt-tags">
            {[agent.rarity, agent.element, agent.specialty].filter(Boolean).join(' · ')}
          </p>
          {agent.faction_name !== '' && <Tech>{agent.faction_name}</Tech>}
        </div>

        <div className="dt-stats">
          {build !== null && (
            <>
              <span className="dt-stat">
                <b>{build.level}</b>
                <Tech>Level</Tech>
              </span>
              <span className="dt-stat">
                <b>M{build.mindscape}</b>
                <Tech>Mindscape</Tech>
              </span>
            </>
          )}
          {gap !== null && <GapBadge gap={gap} />}
        </div>
      </header>

      <div className="dt-cols">
        {/* ---------------------------------------------------- your build */}
        <section className="dt-col panel">
          <RuleTitle as="h3">Your build</RuleTitle>

          {build === null ? (
            <p className="dt-empty">No build data. Run a sync.</p>
          ) : (
            <>
              <h4 className="dt-sub">W-Engine</h4>
              <EquippedEngine engine={build.w_engine} onOpen={onOpen} />

              <h4 className="dt-sub">Drive Discs</h4>
              {build.discs.length === 0 ? (
                <p className="dt-empty">No discs equipped.</p>
              ) : (
                <ul className="dt-discs">
                  {build.discs.map((disc) => (
                    <li key={disc.id}>
                      <button
                        type="button"
                        className="dt-row is-link"
                        onClick={() =>
                          onOpen({
                            kind: 'set',
                            name: disc.set_name || disc.name,
                            icon: disc.icon
                          })
                        }
                      >
                        <span className="dt-slot">{disc.position}</span>
                        <ItemIcon src={disc.icon} rarity={disc.rarity} size={40} />
                        <div className="dt-row-text">
                          <strong>{disc.set_name || disc.name}</strong>
                          {disc.main_stat !== null && (
                            <Tech>
                              {disc.main_stat.name} {disc.main_stat.value}
                            </Tech>
                          )}
                          <span className="dt-subs">
                            {disc.substats.map((s) => `${s.name} ${s.value}`).join(' · ')}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>

        {/* -------------------------------------------------- recommended */}
        <section className="dt-col panel">
          <RuleTitle as="h3">Recommended</RuleTitle>

          {guide === null ? (
            <p className="dt-empty">No guide cached. Run a sync to fetch one.</p>
          ) : (
            <>
              {guide.endgame_stats.length > 0 && (
                <>
                  <h4 className="dt-sub">Best endgame stats (Lv. 60)</h4>
                  <ul className="dt-endgame">
                    {guide.endgame_stats.map((stat) => (
                      <li key={stat.stat}>
                        <span className="dt-endgame-stat">{stat.stat}</span>
                        <span className="dt-endgame-value">{stat.value}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {guide.skill_priority.length > 0 && (
                <>
                  <h4 className="dt-sub">Skill priority</h4>
                  <ol className="dt-skills">
                    {guide.skill_priority.map((step, index) => (
                      <li key={`${step.skill}-${index}`} className="dt-skill">
                        <ItemIcon src={step.icon} size={30} />
                        <span className="dt-skill-name">{step.skill}</span>
                        {index < guide.skill_priority.length - 1 && (
                          <span className="dt-skill-arrow" aria-hidden="true">
                            ›
                          </span>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              )}

              <h4 className="dt-sub">Best W-Engines</h4>
              <ol className="dt-ranked">
                {guide.engines.slice(0, 5).map((engine) => (
                  <li key={engine.name}>
                    <button
                      type="button"
                      className="dt-row is-link"
                      onClick={() =>
                        onOpen({
                          kind: 'engine',
                          name: engine.name,
                          icon: engine.icon,
                          rarity: engine.rarity
                        })
                      }
                    >
                      <span className="dt-rank">{engine.rank}</span>
                      <ItemIcon src={engine.icon} size={40} rarity={engine.rarity} />
                      <div className="dt-row-text">
                        <strong>{engine.name}</strong>
                        <Tech>
                          {engine.recommended_superimpose > 0 &&
                            `S${engine.recommended_superimpose}`}
                          {engine.rating > 0 && ` · ${engine.rating.toFixed(0)}%`}
                        </Tech>
                      </div>
                    </button>
                  </li>
                ))}
              </ol>

              <h4 className="dt-sub">Disc sets</h4>
              <ul className="dt-sets">
                {guide.disc_sets.map((set) => (
                  <li key={`${set.set_name}-${set.pieces}`}>
                    <button
                      type="button"
                      className="dt-row is-link"
                      onClick={() => onOpen({ kind: 'set', name: set.set_name, icon: set.icon })}
                    >
                      <span className={`dt-pc ${set.pieces === 4 ? 'is-four' : ''}`}>
                        {set.pieces}PC
                      </span>
                      <ItemIcon src={set.icon} size={40} />
                      <div className="dt-row-text">
                        <strong>{set.set_name}</strong>
                        {(set.rating > 0 || set.rank > 0) && (
                          <Tech>
                            {set.rating > 0 ? `${set.rating.toFixed(0)}%` : `#${set.rank}`}
                          </Tech>
                        )}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>

              {guide.substat_targets.length > 0 ? (
                <>
                  <h4 className="dt-sub">Substat priority</h4>
                  <ol className="dt-substats">
                    {guide.substat_targets.map((stat, index) => (
                      <li key={stat.name} className="dt-substat-row">
                        <span className="dt-rank">{index + 1}</span>
                        <span className="dt-substat-name">{stat.name}</span>
                        {stat.target !== '' && (
                          <Tech className="dt-substat-target">{stat.target}</Tech>
                        )}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                // A guide cached before schema_version 3 has no
                // substat_targets yet; the plain order still reads fine
                // until the next sync backfills the per-stat caps.
                guide.substat_priority.length > 0 && (
                  <>
                    <h4 className="dt-sub">Substat priority</h4>
                    <p className="dt-priority display">{guide.substat_priority.join(' > ')}</p>
                  </>
                )
              )}

              {Object.keys(guide.main_stats).length > 0 && (
                <>
                  <h4 className="dt-sub">Main stats</h4>
                  <ul className="dt-mains">
                    {Object.entries(guide.main_stats).map(([slot, stats]) => (
                      <li key={slot}>
                        <span className="dt-slot">{slot}</span>
                        <span>{stats.join(' / ')}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

        {/* --------------------------------------------------------- gap */}
        <GapSection goal={goalApi.goal} build={build} guide={guide} gap={gap} />

        {/* --------------------------------------------------- your goals */}
        <section className="dt-col panel">
          <RuleTitle as="h3">Your farming goals</RuleTitle>
          <AgentGoals goalApi={goalApi} />
        </section>
      </div>
    </div>
  )
}

/** Split out so the null check narrows for the click handler too. */
function EquippedEngine({
  engine,
  onOpen
}: {
  engine: AgentBuild['w_engine']
  onOpen: (target: CodexTarget) => void
}): React.JSX.Element {
  if (engine === null) return <p className="dt-empty">Nothing equipped.</p>

  return (
    <button
      type="button"
      className="dt-row is-link"
      onClick={() =>
        onOpen({ kind: 'engine', name: engine.name, icon: engine.icon, rarity: engine.rarity })
      }
    >
      <ItemIcon src={engine.icon} rarity={engine.rarity} size={48} />
      <div className="dt-row-text">
        <strong>{engine.name}</strong>
        <Tech>
          Lv {engine.level} · S{engine.refinement}
        </Tech>
      </div>
    </button>
  )
}

/**
 * "The gap" section. Shows the sidecar's own score by default; if a farming
 * goal is pinned to a set combo that actually disagrees with the
 * recommendation, it switches to a client-side score against *that* instead
 * — see goalGap.ts for why this only overrides rather than always running
 * alongside.
 */
function GapSection({
  goal,
  build,
  guide,
  gap
}: {
  goal: AgentGoal
  build: AgentBuild | null
  guide: AgentDetail['guide']
  gap: BuildGap | null
}): React.JSX.Element {
  const recommendedSets = guide?.disc_sets.filter((s) => s.recommended).map((s) => s.set_name) ?? []
  const goalGap = computeGoalGap(build, recommendedSets, goal)

  return (
    <section className="dt-col panel">
      <RuleTitle as="h3">The gap</RuleTitle>
      {goalGap !== null ? (
        <GoalGapReadout goalGap={goalGap} />
      ) : gap === null ? (
        <p className="dt-empty">Own this agent to see a comparison.</p>
      ) : (
        <GapReadout gap={gap} />
      )}
    </section>
  )
}

function GoalGapReadout({ goalGap }: { goalGap: GoalGap }): React.JSX.Element {
  const tone = goalGap.score > 0.8 ? 'good' : goalGap.score > 0.5 ? 'gold' : 'warn'

  return (
    <>
      <p className="dt-note is-goal">
        Scored against your pinned goal, not the recommendation — see &quot;Your farming
        goals&quot; below.
      </p>

      <h4 className="dt-sub">Overall</h4>
      <Meter value={goalGap.score} tone={tone} />

      <h4 className="dt-sub">Set coverage</h4>
      <Meter value={goalGap.setCoverage} tone={tone} />
      {goalGap.matchedSets.length > 0 && (
        <p className="dt-note is-good">Matched: {goalGap.matchedSets.join(', ')}</p>
      )}
      {goalGap.missingSets.length > 0 && (
        <p className="dt-note is-warn">Missing: {goalGap.missingSets.join(', ')}</p>
      )}

      {goalGap.stats.length > 0 && (
        <>
          <h4 className="dt-sub">Your stat targets</h4>
          <ul className="dt-goal-stats">
            {goalGap.stats.map((stat) => (
              <li key={stat.stat} className={`dt-note ${stat.met === null ? '' : stat.met ? 'is-good' : 'is-warn'}`}>
                {stat.stat}: {stat.equipped} / {stat.target}
                {stat.met === null && ' (not a plain number — check by eye)'}
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function GapBadge({ gap }: { gap: BuildGap }): React.JSX.Element {
  const map = {
    COMPLETE: { tone: 'good', label: 'Build complete' },
    CLOSE: { tone: 'gold', label: 'Almost there' },
    NEEDS_WORK: { tone: 'default', label: 'Needs work' },
    NOT_BUILT: { tone: 'bad', label: 'Not built' }
  } as const
  const { tone, label } = map[gap.severity]
  return <Chip tone={tone}>{label}</Chip>
}

function GapReadout({ gap }: { gap: BuildGap }): React.JSX.Element {
  const tone = gap.severity === 'COMPLETE' ? 'good' : gap.severity === 'CLOSE' ? 'gold' : 'warn'

  return (
    <>
      <h4 className="dt-sub">Overall</h4>
      <Meter value={gap.score} tone={tone} />

      <h4 className="dt-sub">Disc set match</h4>
      <Meter value={gap.disc_set_match} tone={tone} />
      {gap.matched_sets.length > 0 && (
        <p className="dt-note is-good">Matched: {gap.matched_sets.join(', ')}</p>
      )}
      {gap.missing_sets.length > 0 && (
        <p className="dt-note is-warn">Missing: {gap.missing_sets.join(', ')}</p>
      )}

      <h4 className="dt-sub">W-Engine</h4>
      <p className={`dt-note ${gap.engine_matched ? 'is-good' : 'is-warn'}`}>
        {gap.engine_matched
          ? `${gap.equipped_engine} is a recommended pick.`
          : gap.equipped_engine !== ''
            ? `${gap.equipped_engine} is not on the recommended list.`
            : 'Nothing equipped.'}
      </p>

      {gap.substat_gaps.length > 0 && (
        <>
          <h4 className="dt-sub">Substats to chase</h4>
          <p className="dt-note is-warn">{gap.substat_gaps.join(', ')}</p>
        </>
      )}

      {gap.callouts.length > 0 && (
        <ul className="dt-callouts">
          {gap.callouts.map((callout) => (
            <li key={callout}>{callout}</li>
          ))}
        </ul>
      )}
    </>
  )
}
