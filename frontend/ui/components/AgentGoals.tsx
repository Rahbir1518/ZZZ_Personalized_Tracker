/**
 * A personal planning panel inside the character modal: which sets you've
 * decided to farm for this agent, and what stat values you're aiming to hit
 * — either free to disagree with Prydwen's recommendation, since the whole
 * point is a spot for a build that isn't the guide's.
 *
 * Takes its goal and mutators as props rather than calling `useAgentGoal`
 * itself — see that hook's own doc comment for why: the gap panel next to
 * this one needs the exact same live state, and two independent hook calls
 * for the same agent would silently drift apart until both remounted.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgentGoalApi } from '../hooks/useAgentGoals'
import { useDiscSetCatalog, type DiscSetCatalogEntry } from '../hooks/useDiscSetCatalog'
import { ItemIcon, Tech } from './Ui'
import './AgentGoals.css'

export function AgentGoals({ goalApi }: { goalApi: AgentGoalApi }): React.JSX.Element {
  const { goal, addSet, removeSet, togglePinnedSet, addStatTarget, removeStatTarget, toggleStatTargetPinned } =
    goalApi

  return (
    <>
      <h4 className="dt-sub">Sets to farm for</h4>
      <p className="dt-empty goals-hint">
        Pin the one(s) you&apos;re actually building toward — pinning a set the
        recommendation doesn&apos;t already have scores the gap below against your
        pin instead of Prydwen&apos;s pick.
      </p>
      <SetPicker
        sets={goal.sets}
        pinned={goal.pinnedSets}
        onAdd={addSet}
        onRemove={removeSet}
        onTogglePin={togglePinnedSet}
      />

      <h4 className="dt-sub">Stats to reach</h4>
      <p className="dt-empty goals-hint">
        Same idea: pin the ones you&apos;re actually chasing to have them count
        toward the gap below.
      </p>
      <StatTargetPicker
        targets={goal.statTargets}
        onAdd={addStatTarget}
        onRemove={removeStatTarget}
        onTogglePin={toggleStatTargetPinned}
      />
    </>
  )
}

const MAX_SUGGESTIONS = 8

function SetPicker({
  sets,
  pinned,
  onAdd,
  onRemove,
  onTogglePin
}: {
  sets: string[]
  pinned: string[]
  onAdd: (name: string) => void
  onRemove: (name: string) => void
  onTogglePin: (name: string) => void
}): React.JSX.Element {
  const catalog = useDiscSetCatalog()
  const iconByName = useMemo(() => {
    const map = new Map<string, string>()
    for (const entry of catalog) map.set(entry.name.toLowerCase(), entry.icon)
    return map
  }, [catalog])

  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const needle = draft.trim().toLowerCase()
    if (needle === '') return []
    return catalog
      .filter((entry) => entry.name.toLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = a.name.toLowerCase().startsWith(needle) ? 0 : 1
        const bStarts = b.name.toLowerCase().startsWith(needle) ? 0 : 1
        return aStarts !== bStarts ? aStarts - bStarts : a.name.localeCompare(b.name)
      })
      .slice(0, MAX_SUGGESTIONS)
  }, [draft, catalog])

  useEffect(() => setHighlight(0), [draft])

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
    onAdd(name)
    setDraft('')
    setOpen(false)
    // Back to the input so adding several sets in a row doesn't need a
    // re-click each time.
    inputRef.current?.focus()
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      setHighlight((h) => Math.min(h + 1, Math.max(0, matches.length - 1)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (event.key === 'Escape') {
      setOpen(false)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      // A highlighted suggestion wins over the raw typed text — that is
      // what makes it "autocomplete" rather than just a filtered list.
      const chosen = open && matches.length > 0 ? matches[highlight]?.name : draft
      if (chosen !== undefined) pick(chosen)
    }
  }

  return (
    <div className="goals-block">
      {sets.length === 0 ? (
        <p className="dt-empty">
          Nothing set — add any set below, whether or not it matches the recommendation.
        </p>
      ) : (
        <ul className="goals-chips">
          {sets.map((name) => {
            const isPinned = pinned.includes(name)
            return (
              <li key={name} className={`goals-chip ${isPinned ? 'is-pinned' : ''}`}>
                <button
                  type="button"
                  className="goals-chip-pin"
                  onClick={() => onTogglePin(name)}
                  aria-pressed={isPinned}
                  title={isPinned ? 'Unpin' : 'Pin as your farming target'}
                >
                  <PinGlyph filled={isPinned} />
                </button>
                <ItemIcon src={iconByName.get(name.toLowerCase()) ?? ''} size={18} />
                <span>{name}</span>
                <button
                  type="button"
                  className="goals-chip-remove"
                  onClick={() => onRemove(name)}
                  aria-label={`Remove ${name} from your farming goals`}
                >
                  ✕
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="goals-combo" ref={rootRef}>
        <form
          className="goals-add"
          onSubmit={(e) => {
            e.preventDefault()
            pick(draft)
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
              setOpen(true)
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Set name, e.g. Branch & Blade Song"
            aria-label="Set name to add"
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-autocomplete="list"
            autoComplete="off"
          />
          <button type="submit" className="btn" disabled={draft.trim() === ''}>
            Add
          </button>
        </form>

        {open && matches.length > 0 && (
          <ul className="goals-suggestions" role="listbox">
            {matches.map((entry, index) => (
              <SuggestionRow
                key={entry.name}
                entry={entry}
                highlighted={index === highlight}
                onHover={() => setHighlight(index)}
                onPick={() => pick(entry.name)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function SuggestionRow({
  entry,
  highlighted,
  onHover,
  onPick
}: {
  entry: DiscSetCatalogEntry
  highlighted: boolean
  onHover: () => void
  onPick: () => void
}): React.JSX.Element {
  return (
    <li role="option" aria-selected={highlighted}>
      <button
        type="button"
        className={highlighted ? 'is-highlighted' : ''}
        onMouseEnter={onHover}
        onClick={onPick}
      >
        <ItemIcon src={entry.icon} size={22} />
        {entry.name}
      </button>
    </li>
  )
}

function PinGlyph({ filled }: { filled: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  )
}

function StatTargetPicker({
  targets,
  onAdd,
  onRemove,
  onTogglePin
}: {
  targets: { id: string; stat: string; target: string; pinned: boolean }[]
  onAdd: (stat: string, target: string) => void
  onRemove: (id: string) => void
  onTogglePin: (id: string) => void
}): React.JSX.Element {
  const [stat, setStat] = useState('')
  const [target, setTarget] = useState('')
  const statInputRef = useRef<HTMLInputElement>(null)

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (stat.trim() === '') return
    onAdd(stat, target)
    setStat('')
    setTarget('')
    // Back to the stat field so adding several targets in a row (a common
    // case — CRIT Rate, CRIT DMG, ATK all at once) doesn't need a re-click.
    statInputRef.current?.focus()
  }

  return (
    <div className="goals-block">
      {targets.length === 0 ? (
        <p className="dt-empty">
          Nothing set — add a stat and the value you&apos;re building toward, e.g.
          CRIT Rate / 65%.
        </p>
      ) : (
        <ul className="goals-stats">
          {targets.map((row) => (
            <li key={row.id} className={`goals-stat-row ${row.pinned ? 'is-pinned' : ''}`}>
              <button
                type="button"
                className="goals-chip-pin"
                onClick={() => onTogglePin(row.id)}
                aria-pressed={row.pinned}
                title={row.pinned ? 'Unpin' : 'Pin as one of your targets'}
              >
                <PinGlyph filled={row.pinned} />
              </button>
              <span className="goals-stat-name">{row.stat}</span>
              <Tech className="goals-stat-target">{row.target}</Tech>
              <button
                type="button"
                className="goals-stat-remove"
                onClick={() => onRemove(row.id)}
                aria-label={`Remove your ${row.stat} target`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Stacked, not a single row of two inputs plus a button — that fit
          the character modal's ~300px-wide column exactly zero times: the
          target input's placeholder alone was wider than the space left
          after the stat input, so the Add button was pushed off the edge
          of the panel. Full-width rows can't do that regardless of how
          narrow the column gets. */}
      <form className="goals-add-stat" onSubmit={submit}>
        <input
          ref={statInputRef}
          className="goals-add-stat-name"
          value={stat}
          onChange={(e) => setStat(e.target.value)}
          placeholder="Stat, e.g. CRIT Rate"
          aria-label="Stat name"
        />
        <div className="goals-add">
          <input
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Target, e.g. 65%"
            aria-label="Target value"
          />
          <button type="submit" className="btn" disabled={stat.trim() === ''}>
            Add
          </button>
        </div>
      </form>
    </div>
  )
}
