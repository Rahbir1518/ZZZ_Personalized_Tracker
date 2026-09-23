/**
 * "The gap," recomputed against a personal farming goal instead of Prydwen's
 * recommendation — client-side, since the goal itself lives only in this
 * browser (see hooks/useAgentGoals.ts).
 *
 * `computeGoalGap` deliberately returns `null` whenever the pinned sets are
 * the same sets the guide already recommends: at that point the sidecar's
 * own gap score (weighted disc set / engine / substat, evaluate_build in
 * services/analysis.py) is the more complete answer, and showing a second,
 * simpler number next to it would just be confusing. This only takes over
 * once a pin genuinely disagrees with the guide.
 *
 * It is a simpler formula than the backend's on purpose — no engine
 * weighting (there is no "goal engine" feature), and set coverage is a flat
 * "how many of your 6 discs belong to a pinned set" rather than tracking
 * 2-PC/4-PC activation thresholds, since a goal here is a loose set of sets
 * to build toward, not a strict piece-count target.
 */

import type { AgentBuild, Disc } from './types'
import type { AgentGoal } from './hooks/useAgentGoals'

export interface GoalGapStat {
  stat: string
  target: string
  /** The equipped total this was checked against, formatted for display. */
  equipped: string
  /** `null` when either side couldn't be parsed as a number — shown as
   *  informational rather than counted toward the score. */
  met: boolean | null
}

export interface GoalGap {
  pinnedSets: string[]
  matchedSets: string[]
  missingSets: string[]
  /** 0-1: fraction of 4 equipped-disc "slots" covered by a pinned set. */
  setCoverage: number
  stats: GoalGapStat[]
  /** 0-1: setCoverage and the fraction of *numerically checkable* stat
   *  targets met, weighted evenly. Never punished for a target that
   *  couldn't be parsed — see GoalGapStat.met. */
  score: number
}

/** Best-effort "12.5%" / "800" / "+12" -> 12.5. Returns null, not 0, when the
 *  text has no number in it — 0 would silently score an unparseable target
 *  as "failed" rather than "unknown". */
function parseNumber(text: string): number | null {
  const match = /-?\d+(\.\d+)?/.exec(text)
  return match === null ? null : Number(match[0])
}

function setsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const normalise = (s: string): string => s.trim().toLowerCase()
  const sortedA = [...a].map(normalise).sort()
  const sortedB = [...b].map(normalise).sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

export function computeGoalGap(
  build: AgentBuild | null,
  recommendedSets: string[],
  goal: AgentGoal
): GoalGap | null {
  if (goal.pinnedSets.length === 0) return null
  if (setsEqual(goal.pinnedSets, recommendedSets)) return null

  const discs: Disc[] = build?.discs ?? []
  const pinnedLower = new Set(goal.pinnedSets.map((s) => s.trim().toLowerCase()))

  const matched = new Set<string>()
  let coveredDiscs = 0
  for (const disc of discs) {
    if (disc.set_name !== '' && pinnedLower.has(disc.set_name.trim().toLowerCase())) {
      matched.add(disc.set_name)
      coveredDiscs += 1
    }
  }
  const matchedSets = goal.pinnedSets.filter((s) => matched.has(s))
  const missingSets = goal.pinnedSets.filter((s) => !matched.has(s))
  // 4 pieces is a full Drive Disc set (the game's own rule, not this app's),
  // so it is the natural "full credit" denominator for coverage.
  const setCoverage = Math.min(1, coveredDiscs / 4)

  const equippedByStat = new Map<string, number>()
  for (const disc of discs) {
    const properties = disc.main_stat !== null ? [disc.main_stat, ...disc.substats] : disc.substats
    for (const prop of properties) {
      const key = prop.name.trim().toLowerCase()
      const value = parseNumber(prop.value)
      if (value === null) continue
      equippedByStat.set(key, (equippedByStat.get(key) ?? 0) + value)
    }
  }

  // Only pinned stat targets score, same rule as sets: an unpinned row is a
  // scratch idea in the editor, not something the gap is measured against.
  const stats: GoalGapStat[] = goal.statTargets
    .filter((row) => row.pinned)
    .map((row) => {
      const targetValue = parseNumber(row.target)
      const equippedValue = equippedByStat.get(row.stat.trim().toLowerCase()) ?? null
      const met =
        targetValue === null || equippedValue === null ? null : equippedValue >= targetValue
      return {
        stat: row.stat,
        target: row.target,
        equipped: equippedValue === null ? '—' : String(Math.round(equippedValue * 10) / 10),
        met
      }
    })

  const checkable = stats.filter((s) => s.met !== null)
  const statScore =
    checkable.length === 0 ? null : checkable.filter((s) => s.met === true).length / checkable.length

  const score = statScore === null ? setCoverage : (setCoverage + statScore) / 2

  return { pinnedSets: goal.pinnedSets, matchedSets, missingSets, setCoverage, stats, score }
}
