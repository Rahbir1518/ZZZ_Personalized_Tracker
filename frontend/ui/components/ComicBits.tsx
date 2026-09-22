/**
 * Shared comic primitives.
 *
 * These are the pieces used on more than one screen. Anything used by exactly
 * one screen lives with that screen instead.
 */

import type { ReactNode } from 'react'
import './ComicBits.css'

export function Panel({
  children,
  tilt,
  className = ''
}: {
  children: ReactNode
  tilt?: 'left' | 'right'
  className?: string
}): React.JSX.Element {
  const tiltClass = tilt === 'left' ? 'panel-tilt-l' : tilt === 'right' ? 'panel-tilt-r' : ''
  return <section className={`panel ${tiltClass} ${className}`}>{children}</section>
}

export function Burst({
  children,
  tone = 'pow'
}: {
  children: ReactNode
  tone?: 'pow' | 'good' | 'warn' | 'bad'
}): React.JSX.Element {
  const toneClass = tone === 'pow' ? '' : `burst-${tone}`
  return <span className={`burst ${toneClass}`}>{children}</span>
}

export function SpeechBubble({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="bubble">{children}</div>
}

/** Section heading with the stacked-ink treatment. */
export function Heading({
  children,
  level = 2
}: {
  children: ReactNode
  level?: 1 | 2 | 3
}): React.JSX.Element {
  const Tag = `h${level}` as 'h1' | 'h2' | 'h3'
  return <Tag className="display-outline comic-heading">{children}</Tag>
}

/**
 * A labelled 0-1 progress meter drawn as an inked bar.
 * Used for build scores and team readiness.
 */
export function InkMeter({
  value,
  label,
  tone = 'pow'
}: {
  value: number
  label?: string
  tone?: 'pow' | 'good' | 'warn' | 'bad'
}): React.JSX.Element {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100)
  return (
    <div className="ink-meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`ink-meter-fill ink-meter-${tone}`} style={{ width: `${pct}%` }} />
      <span className="ink-meter-label">{label ?? `${pct}%`}</span>
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
    <div className="empty-state">
      <div className="empty-state-mark display">?!</div>
      <h3 className="display">{title}</h3>
      {children !== undefined && <p>{children}</p>}
    </div>
  )
}

/** A dismissible inked error strip. Renders the sidecar's hint when present. */
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
      <strong className="display">Hold up!</strong>
      <span>{message}</span>
      {hint !== undefined && hint !== '' && <em className="error-strip-hint">{hint}</em>}
      {onRetry !== undefined && (
        <button type="button" className="ink-button ink-button-quiet" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  )
}
