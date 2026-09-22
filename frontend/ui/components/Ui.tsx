/**
 * Shared interface primitives.
 *
 * Only the pieces used on more than one screen live here; anything used by a
 * single screen sits with that screen. Visual tokens come from styles/zzz.css.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import aRankArt from '@resources/A_rank.png'
import sRankArt from '@resources/S_rank.png'
import './Ui.css'

export function Panel({
  children,
  className = '',
  raised = false,
  tick = false
}: {
  children: ReactNode
  className?: string
  raised?: boolean
  /** Adds the small gold corner tick that marks a panel as "active". */
  tick?: boolean
}): React.JSX.Element {
  return (
    <section
      className={`panel ${raised ? 'panel-raised' : ''} ${tick ? 'panel-tick' : ''} ${className}`}
    >
      {children}
    </section>
  )
}

/** Section heading with the trailing hairline rule. */
export function RuleTitle({
  children,
  as = 'h2'
}: {
  children: ReactNode
  as?: 'h1' | 'h2' | 'h3'
}): React.JSX.Element {
  const Tag = as
  return <Tag className="rule-title">{children}</Tag>
}

/** A small uppercase technical label. */
export function Tech({
  children,
  className = ''
}: {
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return <span className={`tech ${className}`}>{children}</span>
}

export function Chip({
  children,
  tone = 'default'
}: {
  children: ReactNode
  tone?: 'default' | 'gold' | 'good' | 'bad'
}): React.JSX.Element {
  const toneClass = tone === 'default' ? '' : `chip-${tone}`
  return <span className={`chip ${toneClass}`}>{children}</span>
}

/** A labelled 0-1 progress bar. */
export function Meter({
  value,
  label,
  tone = 'gold'
}: {
  value: number
  label?: string
  tone?: 'gold' | 'good' | 'warn' | 'bad'
}): React.JSX.Element {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100)
  const toneClass = tone === 'gold' ? '' : `is-${tone}`
  return (
    <div className="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`meter-fill ${toneClass}`} style={{ width: `${pct}%` }} />
      <span className="meter-label">{label ?? `${pct}%`}</span>
    </div>
  )
}

export function EmptyState({
  title,
  children
}: {
  title: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      <span className="empty-mark" aria-hidden="true" />
      <h3 className="display empty-title">{title}</h3>
      {children !== undefined && <p className="empty-body">{children}</p>}
    </div>
  )
}

export function ErrorStrip({
  message,
  hint,
  onRetry
}: {
  message: string
  hint?: string
  onRetry?: () => void
}): React.JSX.Element {
  return (
    <div className="error-strip" role="alert">
      <span className="error-strip-tag display">Error</span>
      <span className="error-strip-body">
        {message}
        {hint !== undefined && hint !== '' && <em className="error-strip-hint">{hint}</em>}
      </span>
      {onRetry !== undefined && (
        <button type="button" className="btn" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}

/**
 * The game's rank badge.
 *
 * S and A use the real in-game art, which already carries the letterform, the
 * "RANK" caption, the gloss and the heavy black outline — so it needs no plate
 * behind it and reads on any background.
 *
 * B has no supplied art and falls back to a drawn plate in the game's blue.
 * That is a visible difference in treatment, but a B-rank disc is real data
 * and dropping the badge would hide it. Give this a `B_rank.png` and it picks
 * it up with no code change.
 *
 * Returns null for an unknown or absent rank rather than inventing one: a
 * badge that might be wrong is worse than no badge.
 */
const RANK_ART: Record<string, string> = {
  S: sRankArt,
  A: aRankArt
}

export function RankBadge({
  rank,
  size = 34,
  className = ''
}: {
  rank: string
  /** Badge width in px. Everything inside scales from it. */
  size?: number
  className?: string
}): React.JSX.Element | null {
  const letter = rank.trim().charAt(0).toUpperCase()
  if (letter !== 'S' && letter !== 'A' && letter !== 'B') return null

  const art = RANK_ART[letter]
  const style = { '--rank-size': `${size}px` } as React.CSSProperties

  if (art !== undefined) {
    return (
      <span className={`rank rank-art-box ${className}`} style={style}>
        <img className="rank-art" src={art} alt={`${letter} rank`} draggable={false} />
      </span>
    )
  }

  // Drawn fallback. The caption is 19% of the plate, so below ~34px it turns
  // into a smear and the letter takes the whole plate instead.
  const compact = size < 34
  return (
    <span
      className={`rank rank-plate rank-${letter.toLowerCase()} ${compact ? 'is-compact' : ''} ${className}`}
      style={style}
      aria-label={`${letter} rank`}
    >
      <span className="rank-letter display">{letter}</span>
      {!compact && (
        <span className="rank-word" aria-hidden="true">
          Rank
        </span>
      )}
    </span>
  )
}

/**
 * A small square art frame with a cut corner — used for W-Engines, disc sets
 * and any other icon that needs to read as an item rather than a picture.
 *
 * `rarity` is optional and only ever passed where it is genuinely known. Drive
 * disc *sets*, in particular, have no rank in the game — the individual discs
 * do — so a set icon carries no badge.
 */
export function ItemIcon({
  src,
  alt = '',
  size = 34,
  rarity
}: {
  src: string
  alt?: string
  size?: number
  rarity?: string
}): React.JSX.Element {
  return (
    <span
      className={`item-icon ${rarity === 'S' ? 'is-s' : rarity === 'A' ? 'is-a' : ''}`}
      style={{ width: size, height: size }}
    >
      {src !== '' ? (
        <img src={src} alt={alt} loading="lazy" draggable={false} />
      ) : (
        <span className="item-icon-blank" aria-hidden="true" />
      )}

      {rarity !== undefined && rarity !== '' && (
        <RankBadge
          className="item-icon-rank"
          rank={rarity}
          // A fixed fraction of the frame, so the badge holds the same corner
          // at every icon size, with a floor because the art stops being
          // recognisable much below this.
          size={Math.max(16, Math.round(size * 0.46))}
        />
      )}
    </span>
  )
}


/**
 * Character art with a resolution-aware fallback.
 *
 * `src` is the large card portrait (374x512) and `fallback` the 160x160
 * thumbnail. Card art is derived from the thumbnail URL rather than scraped,
 * so a given agent may not have one — `onError` swaps in the thumbnail instead
 * of leaving a broken image.
 *
 * The fallback carries an `is-fallback` class, because the two sources are not
 * interchangeable: card art is a full-body 3:4 portrait, the thumbnail a 1:1
 * face crop. Cropping the latter to fill a card frame blows it up to three
 * times its real size, which is what made a handful of tiles look like they
 * belonged to a different screen. Callers use the class to contain it instead.
 */
export function Portrait({
  src,
  fallback = '',
  alt = '',
  className = '',
  initials = ''
}: {
  src: string
  fallback?: string
  alt?: string
  className?: string
  initials?: string
}): React.JSX.Element {
  const [failed, setFailed] = useState(false)
  const usingCard = !failed && src !== ''
  const chosen = usingCard ? src : fallback

  // A new agent in the same slot must retry its own art.
  useEffect(() => setFailed(false), [src])

  if (chosen === '') {
    return <span className={`portrait-blank display ${className}`}>{initials}</span>
  }

  return (
    <img
      className={`${className} ${usingCard ? '' : 'is-fallback'}`}
      src={chosen}
      alt={alt}
      loading="lazy"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
