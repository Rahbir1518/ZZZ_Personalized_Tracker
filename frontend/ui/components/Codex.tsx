/**
 * The drill-down pages, and the machinery for getting to them.
 *
 * Clicking a W-Engine or a disc set anywhere in an overlay pushes a page onto
 * that overlay's own stack rather than opening a second dialog on top of the
 * first. Two reasons: a stack of scrims over an already-full-screen panel is
 * unreadable, and the back arrow then has one obvious meaning — return to where
 * you clicked from.
 *
 * Both the agent overlay and the team overlay use this, which is why the stack
 * lives in a hook here instead of being written twice.
 */

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { api } from '../api'
import type { CodexMention, DiscSetDetail, EngineDetail } from '../types'
import { Chip, ItemIcon, RuleTitle, Tech } from './Ui'
import './Codex.css'

/** What a click hands over: enough to render the header before the fetch lands. */
export interface CodexTarget {
  kind: 'engine' | 'set'
  name: string
  /** Whatever art the calling screen was already showing for it. */
  icon?: string
  rarity?: string
}

export interface CodexStack {
  /** The page on top, or null when the host's own content should show. */
  top: CodexTarget | null
  depth: number
  open: (target: CodexTarget) => void
  back: () => void
  reset: () => void
}

/**
 * The overlay's navigation stack.
 *
 * An array rather than a single value so a page opened from a page still knows
 * where "back" goes, and so Escape can unwind one level at a time.
 */
export function useCodexStack(): CodexStack {
  const [stack, setStack] = useState<CodexTarget[]>([])

  const open = useCallback((target: CodexTarget) => {
    setStack((current) => [...current, target])
  }, [])

  const back = useCallback(() => {
    setStack((current) => current.slice(0, -1))
  }, [])

  const reset = useCallback(() => setStack([]), [])

  return { top: stack.length > 0 ? stack[stack.length - 1]! : null, depth: stack.length, open, back, reset }
}

/**
 * The game's own strings, with its colour markup honoured.
 *
 * ZZZ writes buff values inside `<color=#RRGGBB>` spans — it is how the text
 * distinguishes "20%" the number from the prose around it — so dropping them
 * would make a long passive much harder to skim. Parsed here rather than fed
 * through `dangerouslySetInnerHTML`: the only thing that ever reaches the DOM
 * is text and a hex colour that matched the pattern.
 */
const TOKEN = /<color=#([0-9a-fA-F]{6,8})>([\s\S]*?)<\/color>/g

export function GameText({ text, className = '' }: { text: string; className?: string }): React.JSX.Element | null {
  if (text === '') return null

  return (
    <p className={`gx ${className}`}>
      {text.split('\n').map((line, lineIndex) => (
        <span key={lineIndex} className="gx-line">
          {parseLine(line)}
        </span>
      ))}
    </p>
  )
}

function parseLine(line: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let cursor = 0

  // `matchAll` needs the regex to be stateless per call; a fresh one avoids
  // lastIndex leaking between lines.
  for (const match of line.matchAll(new RegExp(TOKEN))) {
    const at = match.index ?? 0
    if (at > cursor) parts.push(line.slice(cursor, at))
    parts.push(
      <em key={`${at}`} className="gx-hl" style={{ color: `#${match[1]}` }}>
        {match[2]}
      </em>
    )
    cursor = at + match[0].length
  }

  if (cursor < line.length) parts.push(line.slice(cursor))
  return parts
}

/** The back arrow. Sits opposite the close button, which keeps its own corner. */
export function BackBar({ label, onBack }: { label: string; onBack: () => void }): React.JSX.Element {
  return (
    <button type="button" className="cx-back" onClick={onBack}>
      <span className="cx-back-arrow" aria-hidden="true">
        ‹
      </span>
      <span className="cx-back-text">
        <Tech>Back to</Tech>
        <strong className="display">{label}</strong>
      </span>
    </button>
  )
}

/** One codex page. Fetches on mount and refetches when the target changes. */
export function CodexPage({ target }: { target: CodexTarget }): React.JSX.Element {
  const [engine, setEngine] = useState<EngineDetail | null>(null)
  const [set, setSet] = useState<DiscSetDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setEngine(null)
    setSet(null)
    setError('')

    const request =
      target.kind === 'engine'
        ? api.engine(target.name).then((result) => {
            if (!cancelled) setEngine(result)
          })
        : api.discSet(target.name).then((result) => {
            if (!cancelled) setSet(result)
          })

    void request.catch((err: unknown) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err))
    })

    return () => {
      cancelled = true
    }
  }, [target.kind, target.name])

  if (error !== '') return <p className="ov-error">{error}</p>
  if (engine === null && set === null) return <p className="ov-loading display">Loading</p>

  return (
    <motion.div
      className="cx"
      initial={{ opacity: 0, x: 18 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
    >
      {engine !== null ? (
        <EngineBody detail={engine} icon={target.icon ?? ''} />
      ) : set !== null ? (
        <SetBody detail={set} icon={target.icon ?? ''} />
      ) : null}
    </motion.div>
  )
}

function EngineBody({ detail, icon }: { detail: EngineDetail; icon: string }): React.JSX.Element {
  return (
    <>
      <header className="cx-head">
        <ItemIcon src={icon} size={96} rarity={detail.rarity} />

        <div className="cx-id">
          <Tech>W-Engine</Tech>
          <h2 className="display cx-name">{detail.name}</h2>
          {detail.specialty !== '' && <p className="cx-tags">For {detail.specialty} agents</p>}
        </div>

        {detail.known && (
          <div className="cx-stats">
            {detail.base_atk > 0 && (
              <span className="cx-stat">
                <b>{detail.base_atk}</b>
                <Tech>Base ATK</Tech>
              </span>
            )}
            {detail.adv_stat !== null && (
              <span className="cx-stat">
                <b>{detail.adv_stat.value}</b>
                <Tech>{detail.adv_stat.name}</Tech>
              </span>
            )}
            <span className="cx-stat-note">
              <Tech>At Lv. 60 · fully modded</Tech>
            </span>
          </div>
        )}
      </header>

      <div className="cx-cols">
        <section className="cx-col panel">
          <RuleTitle as="h3">{detail.effect_name !== '' ? detail.effect_name : 'Effect'}</RuleTitle>

          {!detail.known ? (
            <Unknown what="this W-Engine" />
          ) : detail.effects.length === 0 ? (
            <p className="cx-empty">This W-Engine has no passive.</p>
          ) : (
            <RefinementReader effects={detail.effects} />
          )}

          {detail.flavour !== '' && <p className="cx-flavour">{detail.flavour}</p>}
        </section>

        <section className="cx-col panel">
          <RuleTitle as="h3">Who uses it</RuleTitle>

          <h4 className="cx-sub">Equipped by</h4>
          <MentionList mentions={detail.equipped_by} empty="None of your agents have it equipped." />

          <h4 className="cx-sub">Recommended for</h4>
          <MentionList
            mentions={detail.recommended_for}
            empty="No cached guide lists this engine."
          />
        </section>
      </div>
    </>
  )
}

/**
 * The passive at each refinement, one at a time.
 *
 * Five near-identical paragraphs stacked up is unreadable, and the differences
 * between them are exactly the numbers you want to compare — so the text stays
 * in place and the S-rank switches under it. Opens on the highest rank, which
 * is the one a pull decision is made against.
 */
function RefinementReader({ effects }: { effects: EngineDetail['effects'] }): React.JSX.Element {
  const [picked, setPicked] = useState(effects.length - 1)
  const effect = effects[Math.min(picked, effects.length - 1)]

  return (
    <>
      {effects.length > 1 && (
        <div className="cx-ranks" role="group" aria-label="Superimpose level">
          {effects.map((step, index) => (
            <button
              key={step.refinement}
              type="button"
              className={`cx-rank ${index === picked ? 'is-active' : ''}`}
              onClick={() => setPicked(index)}
              aria-pressed={index === picked}
            >
              S{step.refinement}
            </button>
          ))}
        </div>
      )}

      {effect !== undefined && <GameText text={effect.description} />}
    </>
  )
}

function SetBody({ detail, icon }: { detail: DiscSetDetail; icon: string }): React.JSX.Element {
  return (
    <>
      <header className="cx-head">
        <ItemIcon src={icon} size={96} />

        <div className="cx-id">
          <Tech>Drive Disc set</Tech>
          <h2 className="display cx-name">{detail.set_name}</h2>
        </div>
      </header>

      <div className="cx-cols">
        <section className="cx-col panel">
          <RuleTitle as="h3">Set bonuses</RuleTitle>

          {!detail.known ? (
            <Unknown what="this set" />
          ) : (
            <>
              <div className="cx-bonus">
                <span className="cx-pc">2PC</span>
                <GameText text={detail.two_piece} />
              </div>
              <div className="cx-bonus">
                <span className="cx-pc is-four">4PC</span>
                <GameText text={detail.four_piece} />
              </div>
            </>
          )}
        </section>

        <section className="cx-col panel">
          <RuleTitle as="h3">Who uses it</RuleTitle>

          <h4 className="cx-sub">Wearing pieces</h4>
          <MentionList mentions={detail.equipped_by} empty="None of your agents wear this set." />

          <h4 className="cx-sub">Recommended for</h4>
          <MentionList mentions={detail.recommended_for} empty="No cached guide lists this set." />
        </section>
      </div>
    </>
  )
}

/** Shown when the game-data lookup missed; the usage lists still render. */
function Unknown({ what }: { what: string }): React.JSX.Element {
  return (
    <p className="cx-empty">
      No game data cached for {what}. It will fill in once the machine is online — meanwhile the
      roster half of this page is still accurate.
    </p>
  )
}

function MentionList({
  mentions,
  empty
}: {
  mentions: CodexMention[]
  empty: string
}): React.JSX.Element {
  if (mentions.length === 0) return <p className="cx-empty">{empty}</p>

  return (
    <ul className="cx-mentions">
      {mentions.map((mention) => (
        <li
          key={`${mention.agent_name}-${mention.pieces}`}
          className={`cx-mention ${mention.owned ? '' : 'is-missing'}`}
        >
          <span className="cx-mention-art">
            {mention.icon !== '' ? (
              <img src={mention.icon} alt="" loading="lazy" draggable={false} />
            ) : (
              <span className="cx-mention-initials display">{mention.agent_name.slice(0, 2)}</span>
            )}
          </span>

          <span className="cx-mention-text">
            <strong>{mention.agent_name}</strong>
            {mention.detail !== '' && <Tech>{mention.detail}</Tech>}
          </span>

          {mention.pieces > 0 && (
            <span className={`cx-pc ${mention.pieces === 4 ? 'is-four' : ''}`}>
              {mention.pieces}PC
            </span>
          )}
          {!mention.owned && <Chip>Not owned</Chip>}
        </li>
      ))}
    </ul>
  )
}
