/**
 * One agent in the roster.
 *
 * Modelled on the in-game agent-selection card: the portrait is the card, with
 * a thin metadata strip welded to the bottom. Everything else is a corner mark.
 * Cards sit flush against each other so the roster reads as one printed sheet
 * rather than a set of floating components.
 */

import { forwardRef } from 'react'
import type { Agent, BuildGap } from '../types'
import { Portrait, RankBadge } from './Ui'
import './AgentTile.css'

interface Props {
  agent: Agent
  gap?: BuildGap
  selected?: boolean
  onOpen: (agent: Agent, origin: DOMRect) => void
}

/** Element -> the small marker tint. Unknown elements fall back to neutral. */
const ELEMENT_TINT: Record<string, string> = {
  Ice: 'var(--el-ice)',
  Frost: 'var(--el-ice)',
  Fire: 'var(--el-fire)',
  Electric: 'var(--el-electric)',
  Ether: 'var(--el-ether)',
  'Auric Ink': 'var(--el-ether)',
  Physical: 'var(--el-physical)'
}

/** Short tracker codes, in the register the game uses for metadata.
 *  Mindscape is excluded: it has its own corner badge. */
function trackerLine(agent: Agent, gap?: BuildGap): string {
  if (!agent.owned) return 'NOT OWNED'
  if (gap === undefined) return ''
  return `${gap.engine_matched ? 'ENG ✓' : 'ENG ✕'}  SET ${Math.round(gap.disc_set_match * 100)}%`
}

export const AgentTile = forwardRef<HTMLButtonElement, Props>(function AgentTile(
  { agent, gap, selected = false, onOpen },
  ref
) {
  const tint = ELEMENT_TINT[agent.element] ?? 'var(--muted)'
  const built = gap?.severity === 'COMPLETE'
  // Card art (374x512) where available; the square thumbnail is the fallback.
  // `rectangle_icon` is deliberately not in this chain: HoYoLAB's is a 180x64
  // banner, and there is no honest way to show that in a portrait frame.
  const portrait = agent.card_icon
  const portraitFallback = agent.square_icon

  const classes = [
    'tile',
    agent.owned ? 'is-owned' : 'is-ghost',
    built ? 'is-built' : '',
    selected ? 'is-selected' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      ref={ref}
      type="button"
      className={classes}
      style={{ '--tint': tint } as React.CSSProperties}
      onClick={(event) => onOpen(agent, event.currentTarget.getBoundingClientRect())}
      aria-label={
        agent.owned
          ? `${agent.name}, level ${agent.level ?? 0}, mindscape ${agent.mindscape ?? 0}`
          : `${agent.name}, not owned`
      }
    >
      {/* Counter-skewed so the card face stays upright inside the tilted grid. */}
      <span className="tile-face">
        <span className="tile-art">
          <Portrait src={portrait} fallback={portraitFallback} initials={agent.name.slice(0, 2)} />
          <span className="tile-scrim" aria-hidden="true" />
        </span>

        <RankBadge className="tile-rarity" rank={agent.rarity} size={46} />
        <span className="tile-element" title={agent.element} aria-hidden="true" />

        {built && <span className="marker-star tile-star" aria-hidden="true" />}

        {/* Mindscape sits bottom-right over the art, as in the game. M0 is
            shown too, but stays neutral — only an actual rank earns gold. */}
        {agent.owned && (
          <span
            className={`tile-mindscape display ${(agent.mindscape ?? 0) === 0 ? 'is-zero' : ''}`}
            title={`Mindscape ${agent.mindscape ?? 0}`}
          >
            M{agent.mindscape ?? 0}
          </span>
        )}

        <span className="tile-strip">
          <span className="tile-name">{agent.name}</span>
          <span className="tile-meta">
            <span className="tile-level">{agent.owned ? `LV.${agent.level ?? 0}` : '—'}</span>
            <span className="tile-tracker">{trackerLine(agent, gap)}</span>
          </span>
        </span>
      </span>
    </button>
  )
})
