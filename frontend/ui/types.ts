/**
 * Mirror of backend/zzz_sidecar/models.py.
 *
 * Keep the two in sync by hand — the surface is small, and a generated client
 * would add a build step for very little gain. If a field is added on one side
 * and not the other, the renderer just ignores it.
 */

export interface Property {
  name: string
  value: string
}

export interface Disc {
  id: number
  name: string
  icon: string
  level: number
  rarity: string
  /** Drive Disc slot, 1-6. */
  position: number
  set_name: string
  main_stat: Property | null
  substats: Property[]
}

export interface WEngine {
  id: number
  name: string
  icon: string
  level: number
  rarity: string
  refinement: number
  effect_title: string
}

export interface Skill {
  type: string
  level: number
}

export interface Agent {
  id: number
  name: string
  full_name: string
  element: string
  specialty: string
  rarity: string
  faction_name: string
  square_icon: string
  rectangle_icon: string
  /** 374x512 portrait. HoYoLAB's own art is 152x186 / 180x64 and cannot be
   *  shown large without blurring or extreme cropping. */
  card_icon: string
  owned: boolean
  level: number | null
  /** Mindscape / cinema level, 0-6. */
  mindscape: number | null
}

export interface AgentBuild {
  agent_id: number
  level: number
  mindscape: number
  w_engine: WEngine | null
  discs: Disc[]
  skills: Skill[]
  properties: Property[]
}

export interface DiscSetRecommendation {
  set_name: string
  pieces: number
  icon: string
  note: string
  recommended: boolean
  /** 0-100. Zero when the page ranks sets instead of scoring them. */
  rating: number
  /** 1-based ordinal, used when `rating` is 0. */
  rank: number
}

export interface EngineRecommendation {
  name: string
  icon: string
  /** "S" / "A" / "B" from the game data; empty means no rank is known. */
  rarity: string
  rank: number
  note: string
  rating: number
  recommended_superimpose: number
}

export interface TeamMember {
  name: string
  /** 160x160 thumbnail; blurry above ~160px. */
  icon: string
  /** 374x512 portrait, for anywhere the art is shown large. */
  card_icon: string
  slug: string
}

export interface TeamRecommendation {
  name: string
  /** Display names in team order; the key everything matches on. */
  agent_names: string[]
  /** The same agents with their art attached, for display. */
  members: TeamMember[]
  note: string
}

export interface AgentGuide {
  slug: string
  agent_name: string
  disc_sets: DiscSetRecommendation[]
  engines: EngineRecommendation[]
  substat_priority: string[]
  /** Keyed by disc slot, e.g. { "4": ["CRIT Rate%"] }. */
  main_stats: Record<string, string[]>
  teams: TeamRecommendation[]
  patch: string
  fetched_at: number
  source_url: string
}

export type GapSeverity = 'COMPLETE' | 'CLOSE' | 'NEEDS_WORK' | 'NOT_BUILT'

export interface BuildGap {
  agent_id: number
  agent_name: string
  severity: GapSeverity
  score: number
  disc_set_match: number
  matched_sets: string[]
  missing_sets: string[]
  engine_matched: boolean
  equipped_engine: string
  recommended_engines: string[]
  substat_gaps: string[]
  callouts: string[]
}

export interface TeamStatus {
  team: TeamRecommendation
  fieldable: boolean
  owned_members: string[]
  missing_members: string[]
  readiness: number
}

export interface FarmingAgent {
  name: string
  icon: string
  owned: boolean
}

export interface FarmingPriority {
  label: string
  reason: string
  weight: number
  agent_names: string[]
  /** "disc_set" carries the set icon; "agent" carries the agent's portrait. */
  kind: string
  icon: string
  /** Everyone this target serves, owned or not. Un-owned ones render dimmed. */
  agents: FarmingAgent[]
}

export interface Analysis {
  build_gaps: BuildGap[]
  my_teams: TeamStatus[]
  suggested_teams: TeamStatus[]
  farming: FarmingPriority[]
  computed_at: number
}

export type SourceState = 'IDLE' | 'RUNNING' | 'OK' | 'FAILED' | 'SKIPPED' | 'CANCELLED'

export interface SourceProgress {
  source: string
  state: SourceState
  done: number
  total: number
  message: string
  error_code: string
  last_success_at: number | null
}

export interface SyncStatus {
  run_id: string
  running: boolean
  cancelled: boolean
  started_at: number | null
  finished_at: number | null
  sources: SourceProgress[]
  partial_failure: boolean
  /** Full syncs already used today, and the daily cap. */
  syncs_used_today: number
  syncs_per_day: number
  /** Set when a start was refused because the cap is spent. */
  quota_exhausted: boolean
}

export interface AuthResult {
  ok: boolean
  uid: string
  nickname: string
  level: number
  region: string
}

export interface AgentDetail {
  agent: Agent
  build: AgentBuild | null
  guide: AgentGuide | null
  gap: BuildGap | null
}

/** Error codes the sidecar returns; the UI branches on these, never on text. */
export type ApiErrorCode =
  | 'INVALID_COOKIES'
  | 'GAME_RECORD_DISABLED'
  | 'NO_ZZZ_ACCOUNT'
  | 'RATE_LIMITED'
  | 'CAPTCHA_REQUIRED'
  | 'NOT_AUTHENTICATED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'PARSE_FAILED'
  | 'UNKNOWN'
  | 'BAD_TOKEN'
