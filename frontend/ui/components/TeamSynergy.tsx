/**
 * The "why does this comp work" panel behind a team card's ⓘ.
 *
 * The content is the game's own answer rather than ours. Every agent has an
 * **Additional Ability** that states a squad condition — "when another squad
 * member is a Support or Anomaly character, or shares the same Faction" — and
 * the buff it grants once that condition holds. Read across a team's three or
 * four of those and the synergy is explicit, sourced and current, which is
 * worth more than a sentence we inferred from elements and roles. The Core
 * Passive follows it, because for supports that is where the team buff lives.
 *
 * **Why this is a centred panel and not a tooltip.** It was anchored to the
 * icon first, and that was wrong: anchoring caps the height at whatever gap is
 * left beside a 22px target, so on a card in the middle of the list there was
 * room for about one and a half agents and every ability was cut off. This is
 * a team's worth of ability text — it needs the screen, and it needs a column
 * per agent so all of them are visible at once.
 *
 * That size is also why the pointer never has to travel into it: hover opens
 * it, and it then stays until dismissed rather than closing when the pointer
 * leaves the icon. A panel you cannot reach without closing is not readable.
 *
 * **It has to be a portal.** Every team card is a `.panel`, and `.panel` draws
 * its cut corner with `clip-path` — which clips *all* descendants, including
 * `position: fixed` ones. Rendered in place, this panel was sliced to the
 * card's rectangle no matter how it was sized or positioned, which is what cut
 * the ability text off and hid the agents that fell outside the card. Nothing
 * about the geometry can fix that; the panel simply has to live outside the
 * clipped subtree.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api'
import type { AgentSynergy, TeamStatus } from '../types'
import { GameText } from './Codex'
import { Tech } from './Ui'
import './TeamSynergy.css'

/**
 * Long enough that it takes a deliberate pause to trigger.
 *
 * What opens is a full panel, not a tooltip, so a hair-trigger would throw one
 * up every time the pointer crossed a card on its way somewhere else.
 */
const HOVER_DELAY_MS = 400

/**
 * Answers survive the panel closing.
 *
 * Moving along a row of cards would otherwise refetch the same teams over and
 * over. The sidecar caches these too, but a local hit costs nothing and keeps
 * the panel from flashing "Loading" on a second look.
 */
const memo = new Map<string, AgentSynergy[]>()

/**
 * Every open ⓘ, so opening one closes the rest.
 *
 * Without this, moving along a row would leave a trail of panels stacked on
 * each other — they no longer close on mouse-out, so nothing else would.
 */
const openPanels = new Set<() => void>()

export function TeamSynergy({ team }: { team: TeamStatus }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const hoverTimer = useRef<number | null>(null)

  const cancelHover = useCallback(() => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
  }, [])

  const close = useCallback(() => {
    cancelHover()
    setOpen(false)
  }, [cancelHover])

  const openNow = useCallback(() => {
    cancelHover()
    for (const closeOther of openPanels) closeOther()
    setOpen(true)
  }, [cancelHover])

  // Registered for the "close everyone else" sweep only while actually open.
  useEffect(() => {
    if (!open) return
    openPanels.add(close)
    return () => {
      openPanels.delete(close)
    }
  }, [open, close])

  useEffect(() => cancelHover, [cancelHover])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        // Stop anything behind this from also reacting to the same press.
        event.stopPropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, close])

  return (
    <>
      <button
        type="button"
        className={`syn-pin ${open ? 'is-open' : ''}`}
        aria-label={`Why ${team.team.agent_names.join(', ')} work together`}
        aria-expanded={open}
        onMouseEnter={() => {
          cancelHover()
          hoverTimer.current = window.setTimeout(openNow, HOVER_DELAY_MS)
        }}
        onMouseLeave={cancelHover}
        onFocus={openNow}
        onClick={(event) => {
          // The card behind is one big click target; this button is not it.
          event.stopPropagation()
          if (open) close()
          else openNow()
        }}
      >
        i
      </button>

      <AnimatePresence>{open && <SynergyPanel team={team} onClose={close} />}</AnimatePresence>
    </>
  )
}

function SynergyPanel({
  team,
  onClose
}: {
  team: TeamStatus
  onClose: () => void
}): React.JSX.Element {
  const names = team.team.agent_names
  const key = names.join('|')
  const [rows, setRows] = useState<AgentSynergy[] | null>(memo.get(key) ?? null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (memo.has(key)) return
    let cancelled = false
    api
      .synergy(names)
      .then((result) => {
        memo.set(key, result)
        if (!cancelled) setRows(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
    // `names` is derived from `key`; depending on the array would refetch on
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const slots = rows?.length ?? names.length

  return createPortal(
    <div className="syn-layer">
      {/* Also what swallows the click that would otherwise reach the card
          underneath and open the team overlay. */}
      <motion.div
        className="syn-scrim"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14 }}
        onClick={onClose}
      />

      <motion.div
        className="syn-panel"
        style={{ '--slots': slots } as React.CSSProperties}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.16 }}
        role="dialog"
        aria-modal="true"
        aria-label="Team synergy"
      >
        <header className="syn-head">
          <div className="syn-head-text">
            <Tech>Why this works</Tech>
            <h3 className="display syn-title">{names.join('  ·  ')}</h3>
            {team.team.note !== '' && <p className="syn-note">{team.team.note}</p>}
          </div>

          <button type="button" className="syn-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="syn-body">
          {error !== '' ? (
            <p className="syn-empty">{error}</p>
          ) : rows === null ? (
            <p className="syn-loading display">Loading</p>
          ) : (
            <div className="syn-members">
              {rows.map((row, index) => (
                <SynergyColumn key={`${row.agent_name}-${index}`} row={row} />
              ))}
            </div>
          )}
        </div>
      </motion.div>
    </div>,
    document.body
  )
}

function SynergyColumn({ row }: { row: AgentSynergy }): React.JSX.Element {
  const tags = [row.element, row.specialty, row.faction].filter((tag) => tag !== '')

  return (
    <section className={`syn-agent ${row.owned ? '' : 'is-missing'}`}>
      <header className="syn-agent-head">
        <span className="syn-agent-art">
          {row.icon !== '' ? (
            <img src={row.icon} alt="" loading="lazy" draggable={false} />
          ) : (
            <span className="syn-agent-initials display">{row.agent_name.slice(0, 2)}</span>
          )}
        </span>

        <div className="syn-agent-id">
          <strong className="display">{row.agent_name}</strong>
          {tags.length > 0 && <Tech>{tags.join(' · ')}</Tech>}
          {!row.owned && <span className="syn-missing-tag">Not owned</span>}
        </div>
      </header>

      {!row.known ? (
        <p className="syn-empty">No ability text cached for this agent yet.</p>
      ) : (
        <>
          {row.additional_ability !== '' && (
            <div className="syn-block">
              <Tech className="syn-label">
                Additional Ability{row.additional_name !== '' && ` · ${row.additional_name}`}
              </Tech>
              <GameText text={row.additional_ability} />
            </div>
          )}

          {row.core_passive !== '' && (
            <div className="syn-block is-core">
              <Tech className="syn-label">
                Core Passive{row.core_name !== '' && ` · ${row.core_name}`}
              </Tech>
              <GameText text={row.core_passive} />
            </div>
          )}
        </>
      )}
    </section>
  )
}
