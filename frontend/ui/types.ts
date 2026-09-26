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

/**
 * One entry of the substat priority order, with the goal value split out
 * when Prydwen states one — e.g. `{ name: "CRIT RATE", target: "Until 80%" }`.
 * `target` is empty for a stat Prydwen doesn't cap (chase as much as the
 * build allows, not a specific number).
 */
export interface SubstatTarget {
  name: string
  target: string
}

/** One line of Prydwen's "Best Endgame Stats (Level 60)" box, e.g.
 *  `{ stat: "CRIT RATE", value: "75-95%" }`. Empty when the page carries
 *  this section as a screenshot instead of text. */
export interface EndgameStat {
  stat: string
  value: string
}

/** One step of the "Skill Priority" levelling chain, e.g.
 *  `{ skill: "Chain Attack", icon: "..." }`. Order is levelling order. */
export interface SkillStep {
  skill: string
  icon: string
}

export interface AgentGuide {
  slug: string
  agent_name: string
  disc_sets: DiscSetRecommendation[]
  engines: EngineRecommendation[]
  substat_priority: string[]
  /** The same order as `substat_priority`, with any stated cap split out. */
  substat_targets: SubstatTarget[]
  /** Keyed by disc slot, e.g. { "4": ["CRIT Rate%"] }. */
  main_stats: Record<string, string[]>
  endgame_stats: EndgameStat[]
  skill_priority: SkillStep[]
  teams: TeamRecommendation[]
  patch: string
  fetched_at: number
  source_url: string
}

/**
 * One agent's relationship to a codex entry — either "recommended to use it"
 * or "currently wearing it".
 */
export interface CodexMention {
  agent_name: string
  icon: string
  owned: boolean
  rank: number
  rating: number
  /** 2 or 4 on a disc set mention, 0 otherwise. */
  pieces: number
  detail: string
}

export interface EngineEffect {
  /** Superimpose / refinement rank, 1-5. */
  refinement: number
  description: string
}

/**
 * A W-Engine's own page. `known` is false when the game-data lookup missed or
 * the machine is offline — the usage lists are computed locally and still
 * render, so the page degrades rather than emptying.
 */
export interface EngineDetail {
  name: string
  known: boolean
  rarity: string
  specialty: string
  /** Base ATK at max level and full modification. */
  base_atk: number
  adv_stat: Property | null
  flavour: string
  effect_name: string
  effects: EngineEffect[]
  equipped_by: CodexMention[]
  recommended_for: CodexMention[]
}

export interface DiscSetDetail {
  set_name: string
  known: boolean
  two_piece: string
  four_piece: string
  equipped_by: CodexMention[]
  recommended_for: CodexMention[]
}

/** One tile of the Disks tab's grid: a set plus a short, ranked preview of
 *  who it's recommended for. The full page is `DiscSetDetail`, fetched by
 *  name once a tile is opened. */
export interface DiscSetOverview {
  set_name: string
  icon: string
  top_users: CodexMention[]
}

/**
 * Why one agent pulls its weight in a team. The Additional Ability is the
 * game's own team-synergy mechanic: it states the squad condition that turns
 * it on and the buff it then grants.
 */
export interface AgentSynergy {
  agent_name: string
  icon: string
  owned: boolean
  element: string
  specialty: string
  faction: string
  known: boolean
  core_name: string
  core_passive: string
  additional_name: string
  additional_ability: string
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

/** One Routine Cleanup stage: the two sets it drops together, and every
 *  agent either one is recommended for — see `FarmingPriority`, whose
 *  `agents` field this mirrors. */
export interface DomainCoverage {
  /** Always 2: the stage's two possible drops. */
  sets: string[]
  icons: string[]
  agents: FarmingAgent[]
  reason: string
}

export interface Analysis {
  build_gaps: BuildGap[]
  my_teams: TeamStatus[]
  suggested_teams: TeamStatus[]
  farming: FarmingPriority[]
  domain_coverage: DomainCoverage[]
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
/** One S-rank obtained from Signal Search, and what it cost. */
export interface SRankPull {
  id: number
  item_id: number
  name: string
  kind: 'agent' | 'engine' | 'bangboo'
  /** Art for non-agents; agents' portraits come from the roster. */
  icon: string
  /** 'exclusive' | 'wengine' | 'standard' | 'bangboo'. */
  pool: string
  /** Pulls since the previous S-rank in the same pool, counting this one. */
  pulls: number
  /** No earlier S-rank on record in this pool, so `pulls` may undercount. */
  partial: boolean
  /** Limited channels only: 'won' | 'lost' | 'guaranteed'; '' elsewhere. */
  result: '' | 'won' | 'lost' | 'guaranteed'
  time: string
}

export interface PoolStats {
  pool: string
  hard_pity: number
  total_pulls: number
  since_last_s: number
  since_last_a: number
  s_count: number
  a_count: number
  /** Mean pulls per S-rank with a complete count; null when there are none. */
  average_s: number | null
  fifty_won: number
  fifty_lost: number
  /** The next S-rank is the featured one. */
  guaranteed: boolean
  polychrome: number
}

export interface PullHistory {
  /** Newest first. */
  s_ranks: SRankPull[]
  pools: PoolStats[]
  total_pulls: number
  /** Channel-tile art for item channels ('wengine', 'bangboo'), when cached. */
  art: Record<string, string>
}

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
