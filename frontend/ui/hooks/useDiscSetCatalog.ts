/**
 * Every Drive Disc set the game catalog knows, name and icon both — the
 * farming-goal picker's autocomplete source, and the same call the Disks tab
 * makes for its grid. Fetched once per session and cached at module scope:
 * the catalog doesn't change while the app is open, so there is no reason
 * for every place that wants it to refetch.
 */

import { useEffect, useState } from 'react'
import { api } from '../api'
import type { DiscSetOverview } from '../types'

export interface DiscSetCatalogEntry {
  name: string
  icon: string
}

let cached: DiscSetCatalogEntry[] | null = null
let inFlight: Promise<DiscSetCatalogEntry[]> | null = null

async function load(): Promise<DiscSetCatalogEntry[]> {
  if (cached !== null) return cached
  inFlight ??= api.discSetsOverview().then((rows: DiscSetOverview[]) => {
    const entries = rows.map((row) => ({ name: row.set_name, icon: row.icon }))
    cached = entries
    return entries
  })
  return inFlight
}

export function useDiscSetCatalog(): DiscSetCatalogEntry[] {
  const [entries, setEntries] = useState<DiscSetCatalogEntry[]>(cached ?? [])

  useEffect(() => {
    if (cached !== null) return
    let cancelled = false
    void load().then((result) => {
      if (!cancelled) setEntries(result)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return entries
}
