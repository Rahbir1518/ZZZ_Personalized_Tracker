/**
 * One trading-card tile in the roster grid.
 *
 * Un-owned agents render as dimmed halftone "ghosts" so the grid doubles as a
 * "what am I missing" view, which is what the Suggested-teams tab builds on.
 */

import { forwardRef } from 'react'
import type { Agent, BuildGap } from '../types'
import './AgentTile.css'

interface Props {
  agent: Agent
  gap?: BuildGap
  onOpen: (agent: Agent, origin: DOMRect) => void
}

/** Element name -> tint. Falls back to plain ink for anything unrecognised. */
const ELEMENT_TINT: Record<string, string> = {
  Ice: '#7fd4ff',
  Fire: '#ff8a5c',
  Electric: '#c08cff',
  Ether: '#ff6fae',
  Physical: '#ffd23f',
  Frost: '#a8e6ff',
  'Auric Ink': '#ffb3d9'
}

export const AgentTile = forwardRef<HTMLButtonElement, Props>(function AgentTile(
  { agent, gap, onOpen },
  ref
) {
  const tint = ELEMENT_TINT[agent.element] ?? 'var(--paper-deep)'
  // A fully-built agent earns the gold border, as specified in the brief.
  const built = gap?.severity === 'COMPLETE'
  const portrait = agent.square_icon || agent.rectangle_icon

  const classes = [
    'tile',
    agent.owned ? 'tile-owned' : 'tile-ghost',
    built ? 'tile-built' : ''
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
      <div className="tile-art">
        {portrait !== '' ? (
          <img src={portrait} alt="" loading="lazy" draggable={false} />
        ) : (
          <span className="tile-art-fallback display">{agent.name.slice(0, 2)}</span>
        )}
        <span className="tile-halftone halftone" aria-hidden="true" />
      </div>

      {agent.rarity !== '' && <span className="tile-rarity display">{agent.rarity}</span>}

      {agent.owned && (agent.mindscape ?? 0) > 0 && (
        <span className="tile-mindscape display" title={`Mindscape ${agent.mindscape}`}>
          M{agent.mindscape}
        </span>
      )}

      {agent.element !== '' && (
        <span className="tile-element" title={agent.element} aria-hidden="true" />
      )}

      <span className="tile-name display">{agent.name}</span>

      <span className="tile-level">
        {agent.owned ? `Lv ${agent.level ?? 0}` : 'Not owned'}
      </span>
    </button>
  )
})
