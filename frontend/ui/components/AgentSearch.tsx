/**
 * Search box with an agent autosuggest dropdown.
 *
 * Typing opens the list immediately: one letter is enough, and matches whose
 * name *starts* with what was typed come first, so "n" leads with Nekomata and
 * Nicole rather than burying them under every agent with an n in the middle.
 *
 * Picking a suggestion commits the name as the query and calls `onPick`, which
 * is where each screen decides what "go to this agent" means for it.
 *
 * Keyboard: ArrowUp/Down move the highlight, Enter selects, Escape closes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import './AgentSearch.css'

export interface Suggestion {
  name: string
  /** Portrait for the row. Any size: it is displayed small. */
  icon: string
  owned: boolean
  /** Ranks equal-quality matches; higher first. Relevance, not a display value. */
  weight?: number
  /** The line under the name, e.g. "Owned - 3 teams". */
  meta?: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  /** Fired when a suggestion is picked, after the query is committed. */
  onPick?: (name: string) => void
  suggestions: Suggestion[]
  placeholder?: string
  className?: string
}

const MAX_SHOWN = 8

export function AgentSearch({
  value,
  onChange,
  onPick,
  suggestions,
  placeholder = 'Search',
  className = ''
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const needle = value.trim().toLowerCase()
    if (needle === '') return []
    return suggestions
      .filter((s) => s.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        // A prefix match is almost always what was meant.
        const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1
        const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1
        if (aStarts !== bStarts) return aStarts - bStarts
        const byWeight = (b.weight ?? 0) - (a.weight ?? 0)
        if (byWeight !== 0) return byWeight
        return a.name.localeCompare(b.name)
      })
      .slice(0, MAX_SHOWN)
  }, [value, suggestions])

  // Reset the highlight whenever the candidate list changes under it.
  useEffect(() => setHighlight(0), [value])

  // Close when focus or a click leaves the component.
  useEffect(() => {
    if (!open) return
    const onDocDown = (event: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const pick = (name: string): void => {
    onChange(name)
    setOpen(false)
    onPick?.(name)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      setOpen(false)
      return
    }
    if (matches.length === 0) return

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((h) => (h + 1) % matches.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(true)
      setHighlight((h) => (h - 1 + matches.length) % matches.length)
    } else if (event.key === 'Enter') {
      const chosen = matches[highlight]
      if (chosen !== undefined) {
        event.preventDefault()
        pick(chosen.name)
      }
    }
  }

  const showList = open && matches.length > 0

  return (
    <div className={`asearch ${className}`} ref={rootRef}>
      <input
        className="field asearch-input"
        type="search"
        value={value}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-expanded={showList}
        aria-autocomplete="list"
        role="combobox"
        aria-controls="asearch-list"
        autoComplete="off"
      />

      {showList && (
        <ul className="asearch-list" id="asearch-list" role="listbox">
          {matches.map((match, index) => (
            <li key={match.name} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                className={`asearch-item ${index === highlight ? 'is-active' : ''}`}
                // mousedown fires before the input's blur, so the click is not
                // lost to the dropdown closing first.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(match.name)
                }}
                onMouseEnter={() => setHighlight(index)}
              >
                <span className={`asearch-art ${match.owned ? 'is-owned' : 'is-missing'}`}>
                  {match.icon !== '' ? (
                    <img src={match.icon} alt="" loading="lazy" draggable={false} />
                  ) : (
                    <span className="asearch-art-blank">{match.name.slice(0, 2)}</span>
                  )}
                </span>

                <span className="asearch-text">
                  <span className="asearch-name">{match.name}</span>
                  <span className="asearch-meta">
                    {match.meta ?? (match.owned ? 'Owned' : 'Not owned')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
