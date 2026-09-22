/**
 * The comic "panel burst" modal.
 *
 * A speech bubble appears at the clicked tile's exact position and size, then
 * expands to fill the screen; only once that finishes does the content fade in.
 * On close it collapses back toward the same tile.
 *
 * The trick is animating from the tile's real DOMRect (captured at click time)
 * to a fullscreen rect, so it genuinely reads as "emerging from there" rather
 * than from the centre of the screen. Under prefers-reduced-motion this
 * degrades to a plain fade, which Framer Motion handles via the `reduced` flag.
 */

import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { api } from '../api'
import type { Agent, AgentDetail, BuildGap } from '../types'
import { Burst, InkMeter, SpeechBubble } from './ComicBits'
import './AgentModal.css'

/** Matches the expand duration below; content waits for it. */
const EXPAND_MS = 380

interface Props {
  agent: Agent
  origin: DOMRect
  onClose: () => void
}

export function AgentModal({ agent, origin, onClose }: Props): React.JSX.Element {
  const reduced = useReducedMotion() ?? false
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [expanded, setExpanded] = useState(reduced)
  const [error, setError] = useState('')

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

  // Escape closes, matching the backdrop click.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={agent.name}>
      <motion.div
        className="modal-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      <motion.div
        className="modal-bubble"
        // Start as the tile: same position, same size.
        initial={
          reduced
            ? { opacity: 0 }
            : {
                top: origin.top,
                left: origin.left,
                width: origin.width,
                height: origin.height,
                borderRadius: 10,
                opacity: 0.6
              }
        }
        animate={
          reduced
            ? { opacity: 1 }
            : {
                top: 24,
                left: 24,
                width: 'calc(100vw - 48px)',
                height: 'calc(100vh - 48px)',
                borderRadius: 24,
                opacity: 1
              }
        }
        exit={
          reduced
            ? { opacity: 0 }
            : {
                top: origin.top,
                left: origin.left,
                width: origin.width,
                height: origin.height,
                borderRadius: 10,
                opacity: 0
              }
        }
        transition={
          reduced
            ? { duration: 0.12 }
            : { type: 'spring', stiffness: 280, damping: 30, duration: EXPAND_MS / 1000 }
        }
        onAnimationComplete={() => setExpanded(true)}
      >
        <button type="button" className="modal-close ink-button" onClick={onClose} aria-label="Close">
          ✕
        </button>

        {/* Content is gated until the bubble finishes expanding. */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              className="modal-content"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
            >
              {error !== '' ? (
                <p className="modal-error">{error}</p>
              ) : detail === null ? (
                <p className="modal-loading display">Loading…</p>
              ) : (
                <AgentDetailBody detail={detail} />
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

function AgentDetailBody({ detail }: { detail: AgentDetail }): React.JSX.Element {
  const { agent, build, guide, gap } = detail

  return (
    <div className="detail">
      <header className="detail-header">
        {agent.rectangle_icon !== '' && (
          <img className="detail-portrait" src={agent.rectangle_icon} alt="" />
        )}
        <div>
          <h2 className="display-outline detail-name">{agent.name}</h2>
          <p className="detail-meta">
            {[agent.element, agent.specialty, agent.faction_name].filter(Boolean).join(' · ')}
          </p>
          {build !== null && (
            <p className="detail-meta">
              Level {build.level} · Mindscape {build.mindscape}
            </p>
          )}
        </div>
        {gap !== null && <GapBadge gap={gap} />}
      </header>

      {!agent.owned && (
        <SpeechBubble>
          You do not own {agent.name} yet — this is what the build would look like.
        </SpeechBubble>
      )}

      <div className="detail-columns">
        <section className="detail-col">
          <h3 className="display detail-subhead">Your build</h3>
          {build === null ? (
            <p className="detail-empty">No build data. Run a sync.</p>
          ) : (
            <>
              <div className="detail-block">
                <h4>W-Engine</h4>
                {build.w_engine === null ? (
                  <p className="detail-empty">Nothing equipped.</p>
                ) : (
                  <div className="detail-engine">
                    {build.w_engine.icon !== '' && <img src={build.w_engine.icon} alt="" />}
                    <div>
                      <strong>{build.w_engine.name}</strong>
                      <span className="detail-meta">
                        Lv {build.w_engine.level} · S{build.w_engine.refinement}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <div className="detail-block">
                <h4>Drive Discs</h4>
                {build.discs.length === 0 ? (
                  <p className="detail-empty">No discs equipped.</p>
                ) : (
                  <ul className="detail-discs">
                    {build.discs.map((disc) => (
                      <li key={disc.id} className="detail-disc">
                        <span className="detail-disc-slot display">{disc.position}</span>
                        <div>
                          <strong>{disc.set_name || disc.name}</strong>
                          {disc.main_stat !== null && (
                            <span className="detail-meta">
                              {disc.main_stat.name} {disc.main_stat.value}
                            </span>
                          )}
                          <span className="detail-substats">
                            {disc.substats.map((s) => `${s.name} ${s.value}`).join(' · ')}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>

        <section className="detail-col">
          <h3 className="display detail-subhead">Recommended</h3>
          {guide === null ? (
            <p className="detail-empty">No guide cached yet. Run a sync to fetch one.</p>
          ) : (
            <>
              <div className="detail-block">
                <h4>Best W-Engines</h4>
                <ol className="detail-list">
                  {guide.engines.slice(0, 5).map((engine) => (
                    <li key={engine.name}>
                      <strong>{engine.name}</strong>
                      {engine.recommended_superimpose > 0 && (
                        <span className="detail-meta"> S{engine.recommended_superimpose}</span>
                      )}
                      {engine.rating > 0 && (
                        <span className="detail-meta"> · {engine.rating.toFixed(0)}%</span>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              <div className="detail-block">
                <h4>Disc sets</h4>
                <ul className="detail-list">
                  {guide.disc_sets.map((set) => (
                    <li key={`${set.set_name}-${set.pieces}`}>
                      <strong>
                        {set.pieces}pc {set.set_name}
                      </strong>
                      {/* Prydwen scores some agents' sets and ranks others. */}
                      {set.rating > 0 ? (
                        <span className="detail-meta"> · {set.rating.toFixed(0)}%</span>
                      ) : set.rank > 0 ? (
                        <span className="detail-meta"> · #{set.rank}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              {guide.substat_priority.length > 0 && (
                <div className="detail-block">
                  <h4>Substat priority</h4>
                  <p className="detail-priority">{guide.substat_priority.join('  >  ')}</p>
                </div>
              )}

              {Object.keys(guide.main_stats).length > 0 && (
                <div className="detail-block">
                  <h4>Main stats</h4>
                  <ul className="detail-list">
                    {Object.entries(guide.main_stats).map(([slot, stats]) => (
                      <li key={slot}>
                        <strong>Disc {slot}</strong>
                        <span className="detail-meta"> {stats.join(' / ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>

        <section className="detail-col">
          <h3 className="display detail-subhead">The gap</h3>
          {gap === null ? (
            <p className="detail-empty">Own this agent to see a comparison.</p>
          ) : (
            <GapReadout gap={gap} />
          )}
        </section>
      </div>
    </div>
  )
}

function GapBadge({ gap }: { gap: BuildGap }): React.JSX.Element {
  const tone =
    gap.severity === 'COMPLETE' ? 'good' : gap.severity === 'CLOSE' ? 'pow' : 'warn'
  const label =
    gap.severity === 'COMPLETE'
      ? 'Build complete'
      : gap.severity === 'CLOSE'
        ? 'Almost'
        : gap.severity === 'NEEDS_WORK'
          ? 'Needs work'
          : 'Not built'
  return (
    <span className="detail-badge">
      <Burst tone={tone}>{label}</Burst>
    </span>
  )
}

function GapReadout({ gap }: { gap: BuildGap }): React.JSX.Element {
  return (
    <>
      <div className="detail-block">
        <h4>Overall</h4>
        <InkMeter
          value={gap.score}
          tone={gap.severity === 'COMPLETE' ? 'good' : gap.severity === 'CLOSE' ? 'pow' : 'warn'}
        />
      </div>

      <div className="detail-block">
        <h4>Disc set match</h4>
        <InkMeter value={gap.disc_set_match} />
        {gap.matched_sets.length > 0 && (
          <p className="detail-meta">Matched: {gap.matched_sets.join(', ')}</p>
        )}
        {gap.missing_sets.length > 0 && (
          <p className="detail-meta">Missing: {gap.missing_sets.join(', ')}</p>
        )}
      </div>

      <div className="detail-block">
        <h4>W-Engine</h4>
        <p className={gap.engine_matched ? 'detail-ok' : 'detail-warn'}>
          {gap.engine_matched
            ? `${gap.equipped_engine} is a recommended pick.`
            : gap.equipped_engine !== ''
              ? `${gap.equipped_engine} is not on the recommended list.`
              : 'Nothing equipped.'}
        </p>
      </div>

      {gap.substat_gaps.length > 0 && (
        <div className="detail-block">
          <h4>Substats to chase</h4>
          <p className="detail-warn">{gap.substat_gaps.join(', ')}</p>
        </div>
      )}

      {gap.callouts.length > 0 && (
        <SpeechBubble>
          <ul className="detail-callouts">
            {gap.callouts.map((callout) => (
              <li key={callout}>{callout}</li>
            ))}
          </ul>
        </SpeechBubble>
      )}
    </>
  )
}
