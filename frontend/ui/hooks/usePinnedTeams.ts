/**
 * Which teams are pinned, kept in localStorage.
 *
 * This is a per-viewer display preference, not account data — nothing the
 * sidecar computes depends on it, so it has no reason to round-trip through
 * the backend or survive a reinstall. Teams are keyed the same way React
 * keys them elsewhere in this tab (`agent_names.join('|')`), so a pin survives
 * a sync that reorders or re-scores the list, as long as the same agents are
 * still the same team.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'zzz-tracker:pinned-teams'

function readStored(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw === null) return new Set()
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed.filter((v) => typeof v === 'string')) : new Set()
  } catch {
    // Private window, cleared site data, or corrupt JSON — start empty rather
    // than breaking the tab over a display preference.
    return new Set()
  }
}

function writeStored(pinned: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...pinned]))
  } catch {
    // Storage full or unavailable: the pin still works for this session via
    // React state, it just won't survive a relaunch.
  }
}

export interface PinnedTeams {
  isPinned: (key: string) => boolean
  toggle: (key: string) => void
}

export function usePinnedTeams(): PinnedTeams {
  const [pinned, setPinned] = useState<Set<string>>(() => readStored())

  // Another window/tab of the same app changing pins should be reflected
  // here too, rather than one overwriting the other's on next write.
  useEffect(() => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key === STORAGE_KEY) setPinned(readStored())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = useCallback((key: string) => {
    setPinned((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      writeStored(next)
      return next
    })
  }, [])

  const isPinned = useCallback((key: string) => pinned.has(key), [pinned])

  // Stable identity unless a pin actually changed, so callers can put this
  // whole object in a dependency array without it recomputing every render.
  return useMemo(() => ({ isPinned, toggle }), [isPinned, toggle])
}

/** Pinned first, stable otherwise — a sort, not a filter, so nothing moves
 *  out of the list, it just moves up within it. */
export function sortPinnedFirst<T>(items: T[], key: (item: T) => string, pinned: PinnedTeams): T[] {
  return items
    .map((item, index) => ({ item, index, pinned: pinned.isPinned(key(item)) }))
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
      return a.index - b.index
    })
    .map((entry) => entry.item)
}
