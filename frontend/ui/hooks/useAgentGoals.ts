/**
 * Per-agent farming goals: which sets you've personally decided to farm for,
 * and what stat values you're aiming to hit — independent of Prydwen's
 * recommendation, kept in localStorage.
 *
 * This is not sent to the sidecar; the sidecar's own gap score and Farm Next
 * list stay keyed to the community recommendation. What this *does* drive is
 * a client-side alternate reading of "the gap" (see goalGap.ts) — but only
 * for the sets and stats you've pinned, so jotting an idea down without
 * pinning it never silently changes your score.
 *
 * One rule that matters for callers: get exactly one `useAgentGoal(agentId)`
 * per agent per screen and thread its `goal` down as props to whatever else
 * needs it (the gap panel, the editor). Two independent calls to this hook
 * for the same agent are two independent `useState` copies that only agree
 * again once both remount — the editor's adds would never appear in the
 * other one's view of the goal until you closed and reopened it.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'zzz-tracker:agent-goals'

export interface StatTarget {
  /** Stable across reorders/edits — what pin/remove act on, since a stat
   *  name isn't unique (two rows can legitimately target the same stat at
   *  different checkpoints). */
  id: string
  stat: string
  target: string
  pinned: boolean
}

export interface AgentGoal {
  sets: string[]
  /** Which of `sets` is the actual target to score the build against — a
   *  subset, since a real comp is usually a 4-PC primary plus maybe a 2-PC
   *  pairing, not every set ever jotted down. */
  pinnedSets: string[]
  statTargets: StatTarget[]
}

const EMPTY_GOAL: AgentGoal = { sets: [], pinnedSets: [], statTargets: [] }

type GoalStore = Record<string, AgentGoal>

let statIdCounter = 0
function nextStatId(): string {
  statIdCounter += 1
  return `${Date.now()}-${statIdCounter}`
}

function readStore(): GoalStore {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return {}
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return {}
    // Goals saved before `pinnedSets` / stat `id` + `pinned` existed are
    // missing those fields — default them rather than crash reading an
    // older save.
    const out: GoalStore = {}
    for (const [id, value] of Object.entries(parsed as Record<string, Partial<AgentGoal>>)) {
      const statTargets = Array.isArray(value.statTargets) ? value.statTargets : []
      out[id] = {
        sets: Array.isArray(value.sets) ? value.sets : [],
        pinnedSets: Array.isArray(value.pinnedSets) ? value.pinnedSets : [],
        statTargets: statTargets.map((row: Partial<StatTarget>) => ({
          id: typeof row.id === 'string' ? row.id : nextStatId(),
          stat: typeof row.stat === 'string' ? row.stat : '',
          target: typeof row.target === 'string' ? row.target : '',
          pinned: row.pinned === true
        }))
      }
    }
    return out
  } catch {
    return {}
  }
}

function writeStore(store: GoalStore): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Storage full or unavailable: edits still work for this session via
    // React state, they just won't survive a relaunch.
  }
}

export interface AgentGoalApi {
  goal: AgentGoal
  addSet: (name: string) => void
  removeSet: (name: string) => void
  togglePinnedSet: (name: string) => void
  addStatTarget: (stat: string, target: string) => void
  removeStatTarget: (id: string) => void
  toggleStatTargetPinned: (id: string) => void
}

/** One agent's goal, editable, persisted on every change. */
export function useAgentGoal(agentId: number): AgentGoalApi {
  const key = String(agentId)
  const [store, setStore] = useState<GoalStore>(() => readStore())

  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) setStore(readStore())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const update = useCallback(
    (updater: (goal: AgentGoal) => AgentGoal) => {
      setStore((current) => {
        const next = { ...current, [key]: updater(current[key] ?? EMPTY_GOAL) }
        writeStore(next)
        return next
      })
    },
    [key]
  )

  const addSet = useCallback(
    (name: string) => {
      const trimmed = name.trim()
      if (trimmed === '') return
      update((goal) =>
        goal.sets.some((s) => s.toLowerCase() === trimmed.toLowerCase())
          ? goal
          : { ...goal, sets: [...goal.sets, trimmed] }
      )
    },
    [update]
  )

  const removeSet = useCallback(
    (name: string) => {
      update((goal) => ({
        ...goal,
        sets: goal.sets.filter((s) => s !== name),
        pinnedSets: goal.pinnedSets.filter((s) => s !== name)
      }))
    },
    [update]
  )

  const togglePinnedSet = useCallback(
    (name: string) => {
      update((goal) => ({
        ...goal,
        pinnedSets: goal.pinnedSets.includes(name)
          ? goal.pinnedSets.filter((s) => s !== name)
          : [...goal.pinnedSets, name]
      }))
    },
    [update]
  )

  const addStatTarget = useCallback(
    (stat: string, target: string) => {
      const trimmedStat = stat.trim()
      if (trimmedStat === '') return
      const row: StatTarget = { id: nextStatId(), stat: trimmedStat, target: target.trim(), pinned: false }
      update((goal) => ({ ...goal, statTargets: [...goal.statTargets, row] }))
    },
    [update]
  )

  const removeStatTarget = useCallback(
    (id: string) => {
      update((goal) => ({
        ...goal,
        statTargets: goal.statTargets.filter((row) => row.id !== id)
      }))
    },
    [update]
  )

  const toggleStatTargetPinned = useCallback(
    (id: string) => {
      update((goal) => ({
        ...goal,
        statTargets: goal.statTargets.map((row) =>
          row.id === id ? { ...row, pinned: !row.pinned } : row
        )
      }))
    },
    [update]
  )

  return {
    goal: store[key] ?? EMPTY_GOAL,
    addSet,
    removeSet,
    togglePinnedSet,
    addStatTarget,
    removeStatTarget,
    toggleStatTargetPinned
  }
}
