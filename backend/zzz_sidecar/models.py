"""The sidecar's public API contract.

These are deliberately *not* the upstream genshin.py / hakushin models: keeping
our own shapes means an upstream field rename breaks one mapper function rather
than the whole renderer. Mirrored in src/renderer/src/types/api.ts.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------- #
# Account / roster
# --------------------------------------------------------------------------- #


class Property(BaseModel):
    name: str
    value: str


class Disc(BaseModel):
    id: int
    name: str
    icon: str
    level: int
    rarity: str
    #: Drive Disc slot, 1-6.
    position: int
    set_name: str
    main_stat: Property | None = None
    substats: list[Property] = Field(default_factory=list)


class WEngine(BaseModel):
    id: int
    name: str
    icon: str
    level: int
    rarity: str
    #: Upgrade/refinement rank, 1-5.
    refinement: int
    effect_title: str = ""


class Skill(BaseModel):
    type: str
    level: int


class Agent(BaseModel):
    """One agent tile. Un-owned catalog entries have ``owned=False`` and no build."""

    id: int
    name: str
    full_name: str = ""
    element: str = ""
    specialty: str = ""
    rarity: str = ""
    faction_name: str = ""
    square_icon: str = ""
    rectangle_icon: str = ""
    #: 374x512 portrait from the recommendation source, when one is known.
    #: HoYoLAB's own art is 152x186 (square) and 180x64 (banner), so it cannot
    #: be shown large without either blurring or absurd cropping.
    card_icon: str = ""

    owned: bool = False
    level: int | None = None
    #: Mindscape / cinema level, 0-6. ``rank`` in the HoYoLAB payload.
    mindscape: int | None = None


class AgentBuild(BaseModel):
    """The equipped state of an owned agent, from HoYoLAB."""

    agent_id: int
    level: int
    mindscape: int
    w_engine: WEngine | None = None
    discs: list[Disc] = Field(default_factory=list)
    skills: list[Skill] = Field(default_factory=list)
    properties: list[Property] = Field(default_factory=list)


class Roster(BaseModel):
    uid: str
    nickname: str = ""
    agents: list[Agent] = Field(default_factory=list)
    fetched_at: float


# --------------------------------------------------------------------------- #
# Prydwen recommendations
# --------------------------------------------------------------------------- #


class DiscSetRecommendation(BaseModel):
    set_name: str
    #: 2 or 4.
    pieces: int
    icon: str = ""
    note: str = ""
    recommended: bool = False
    #: Prydwen's rating for this set, 0-100. 0 when the page shows none:
    #: for many agents the sets carry an ordinal rank instead (see `rank`),
    #: and 2-PC options are listed with neither.
    rating: float = 0.0
    #: 1-based ordinal when the page ranks sets rather than scoring them.
    rank: int = 0


class EngineRecommendation(BaseModel):
    name: str
    icon: str = ""
    #: "S" / "A" / "B", from the game data - Prydwen's markup does not say.
    #: Empty when the engine is not in the catalog, which means "no badge".
    rarity: str = ""
    #: 1-based position in Prydwen's ordered list.
    rank: int = 0
    note: str = ""
    #: Prydwen's rating for this engine, 0-100.
    rating: float = 0.0
    #: Recommended superimpose/refinement level, e.g. 1 or 5. 0 when unstated.
    recommended_superimpose: int = 0


class TeamMember(BaseModel):
    """One slot in a recommended team, with art for display."""

    name: str
    #: 160x160 thumbnail. Fine at small sizes, blurry above ~160px.
    icon: str = ""
    #: 374x512 portrait, for anywhere the art is shown large.
    card_icon: str = ""
    slug: str = ""


class TeamRecommendation(BaseModel):
    name: str = ""
    #: Display names, in team order. This is the key everything matches on;
    #: `members` carries the same agents with their art attached.
    agent_names: list[str] = Field(default_factory=list)
    members: list[TeamMember] = Field(default_factory=list)
    note: str = ""


class SubstatTarget(BaseModel):
    """One entry of the substat priority order, with the goal value split out
    from the stat name when Prydwen states one.

    Prydwen writes most of the priority order as bare names — "aim for as much
    of this as the build allows" is implicit — but a handful of stats carry an
    explicit cap in the source text, e.g. "CRIT RATE (Until 80%)": past that
    point the stat stops being worth chasing over the next one in the order.
    ``target`` is empty for every stat Prydwen doesn't cap.
    """

    name: str
    target: str = ""


class EndgameStat(BaseModel):
    """One line of Prydwen's "Best Endgame Stats (Level 60)" box, e.g.
    ``{"stat": "CRIT RATE", "value": "75-95%"}``.

    A handful of agent pages carry this section as an embedded screenshot
    instead of text (Prydwen's own inconsistency, not this parser's) — those
    pages simply produce an empty list here, same as any other section the
    page doesn't have in a machine-readable form.
    """

    stat: str
    value: str


class SkillStep(BaseModel):
    """One entry of Prydwen's "Skill Priority" chain, e.g.
    ``{"skill": "Chain Attack", "icon": "..."}``. Order is levelling order,
    not in-combat order."""

    skill: str
    icon: str = ""


class AgentGuide(BaseModel):
    """One agent's recommendations, as parsed from Prydwen."""

    slug: str
    agent_name: str
    disc_sets: list[DiscSetRecommendation] = Field(default_factory=list)
    engines: list[EngineRecommendation] = Field(default_factory=list)
    #: Ordered best-first, e.g. ["CRIT DMG", "ATK%", "Anomaly Proficiency"].
    substat_priority: list[str] = Field(default_factory=list)
    #: The same order, with any stated cap (e.g. "Until 80%") split into its
    #: own field instead of left inline in the name.
    substat_targets: list[SubstatTarget] = Field(default_factory=list)
    #: Recommended main stat per slot, keyed by slot number as a string.
    main_stats: dict[str, list[str]] = Field(default_factory=dict)
    #: Prydwen's "Best Endgame Stats (Level 60)" box: full-build stat ranges
    #: worth aiming for, not per-substat priority — the two are complementary,
    #: not duplicates.
    endgame_stats: list[EndgameStat] = Field(default_factory=list)
    #: Which skill to level first, second, etc. — the chain of icons under
    #: "Skill Priority" on the guide page.
    skill_priority: list[SkillStep] = Field(default_factory=list)
    teams: list[TeamRecommendation] = Field(default_factory=list)
    #: Game patch this guide was cached against. Supplied by the sync service
    #: from the metadata source, not scraped from the page.
    patch: str = ""
    #: Parser version that produced this guide. Older entries are refetched.
    schema_version: int = 0
    fetched_at: float = 0.0
    source_url: str = ""


# --------------------------------------------------------------------------- #
# Codex — game data for the drill-down pages (W-Engines, disc sets, synergy)
# --------------------------------------------------------------------------- #


class CodexMention(BaseModel):
    """One agent's relationship to a codex entry.

    Used both ways round: "these agents are recommended to use it" and "these
    agents of yours currently wear it".
    """

    agent_name: str
    #: Whichever art the calling screen already had for this agent.
    icon: str = ""
    owned: bool = False
    #: Rank / rating carry Prydwen's ordering when the mention comes from a
    #: guide; both are 0 for an equipped-by mention.
    rank: int = 0
    rating: float = 0.0
    #: 2 or 4 for a disc set mention, 0 otherwise.
    pieces: int = 0
    #: Free text: the guide's note, or the equipped level/refinement.
    detail: str = ""


class EngineEffect(BaseModel):
    """One refinement step of a W-Engine's passive."""

    #: Superimpose / refinement rank, 1-5.
    refinement: int
    description: str = ""


class EngineDetail(BaseModel):
    """A W-Engine's own page.

    ``known`` is False when the game-data lookup missed or the machine is
    offline: the usage lists below are computed locally and are still worth
    showing, so a miss degrades the page rather than emptying it.
    """

    name: str
    known: bool = False
    rarity: str = ""
    #: The specialty the engine is built for, e.g. "Attack".
    specialty: str = ""
    #: Base ATK at max level and full modification.
    base_atk: int = 0
    #: The secondary stat, already formatted, at max level.
    adv_stat: Property | None = None
    flavour: str = ""
    effect_name: str = ""
    effects: list[EngineEffect] = Field(default_factory=list)
    #: Your agents currently wearing it.
    equipped_by: list[CodexMention] = Field(default_factory=list)
    #: Agents whose guide recommends it, best rank first.
    recommended_for: list[CodexMention] = Field(default_factory=list)


class DiscSetDetail(BaseModel):
    """A Drive Disc set's own page."""

    set_name: str
    known: bool = False
    two_piece: str = ""
    four_piece: str = ""
    #: Your agents wearing pieces of it; ``pieces`` is how many.
    equipped_by: list[CodexMention] = Field(default_factory=list)
    recommended_for: list[CodexMention] = Field(default_factory=list)


class DiscSetOverview(BaseModel):
    """One row of the Disks tab's grid: a set plus a short, ranked list of
    who it's recommended for — the tile itself, not the full page (that's
    still `DiscSetDetail`, fetched by name when the tile is opened)."""

    set_name: str
    icon: str = ""
    #: Best-in-slot first. Capped short (see the router) — a tile is a
    #: preview, the detail page is where the full ranked list lives.
    top_users: list[CodexMention] = Field(default_factory=list)


class AgentSynergy(BaseModel):
    """Why one agent pulls its weight in a team.

    The Additional Ability is the game's own team-synergy mechanic — it states
    the squad condition that switches it on and the buff it then grants — so it
    is the honest answer to "why do these three go together", rather than
    something we infer from elements and roles.
    """

    agent_name: str
    icon: str = ""
    owned: bool = False
    element: str = ""
    specialty: str = ""
    faction: str = ""
    known: bool = False
    core_name: str = ""
    core_passive: str = ""
    additional_name: str = ""
    additional_ability: str = ""


# --------------------------------------------------------------------------- #
# Analysis — the actual point of the app
# --------------------------------------------------------------------------- #


class GapSeverity(StrEnum):
    COMPLETE = "COMPLETE"
    CLOSE = "CLOSE"
    NEEDS_WORK = "NEEDS_WORK"
    NOT_BUILT = "NOT_BUILT"


class BuildGap(BaseModel):
    """How far an owned agent's actual build is from the recommendation."""

    agent_id: int
    agent_name: str
    severity: GapSeverity
    #: 0.0-1.0 across disc set, engine and substats.
    score: float = 0.0

    disc_set_match: float = 0.0
    matched_sets: list[str] = Field(default_factory=list)
    missing_sets: list[str] = Field(default_factory=list)

    engine_matched: bool = False
    equipped_engine: str = ""
    recommended_engines: list[str] = Field(default_factory=list)

    #: Priority substats that are absent or underlevelled on the current discs.
    substat_gaps: list[str] = Field(default_factory=list)

    #: Short comic-callout lines, e.g. "BUILD COMPLETE" or "Missing 4pc Polar Metal".
    callouts: list[str] = Field(default_factory=list)


class TeamStatus(BaseModel):
    team: TeamRecommendation
    #: True when every member is owned.
    fieldable: bool
    owned_members: list[str] = Field(default_factory=list)
    missing_members: list[str] = Field(default_factory=list)
    #: Mean build score across owned members, 0.0-1.0.
    readiness: float = 0.0


class FarmingAgent(BaseModel):
    """An agent shown alongside a farming target, with art for display."""

    name: str
    icon: str = ""
    owned: bool = False


class FarmingPriority(BaseModel):
    label: str
    reason: str
    #: Higher is more urgent.
    weight: float = 0.0
    agent_names: list[str] = Field(default_factory=list)
    #: "disc_set" targets carry the set icon; "agent" targets carry the agent's.
    kind: str = "disc_set"
    icon: str = ""
    #: Who this target serves. Un-owned agents are included on purpose — the UI
    #: dims them, which is what makes "worth farming toward" legible.
    agents: list[FarmingAgent] = Field(default_factory=list)


class DomainCoverage(BaseModel):
    """One Routine Cleanup stage: the two sets it drops together, and every
    agent either one is recommended for — the "farm this stage, not just this
    set" answer, since a run drops both regardless of which one you wanted.
    """

    #: Exactly 2: the stage's two possible drops.
    sets: list[str] = Field(default_factory=list)
    icons: list[str] = Field(default_factory=list)
    #: Union of agents recommending either set, deduplicated, most useful
    #: first. Un-owned agents are included on purpose, same as `FarmingPriority`.
    agents: list[FarmingAgent] = Field(default_factory=list)
    reason: str = ""


class Analysis(BaseModel):
    build_gaps: list[BuildGap] = Field(default_factory=list)
    my_teams: list[TeamStatus] = Field(default_factory=list)
    suggested_teams: list[TeamStatus] = Field(default_factory=list)
    farming: list[FarmingPriority] = Field(default_factory=list)
    domain_coverage: list[DomainCoverage] = Field(default_factory=list)
    computed_at: float = 0.0


# --------------------------------------------------------------------------- #
# Sync
# --------------------------------------------------------------------------- #


class SourceState(StrEnum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    OK = "OK"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"
    CANCELLED = "CANCELLED"


# --------------------------------------------------------------------------- #
# Signal Search (pull) history
# --------------------------------------------------------------------------- #


class SRankPull(BaseModel):
    """One S-rank obtained, and what it cost."""

    #: HoYoLAB record id, unique per pull. Also the React key.
    id: int
    item_id: int
    name: str
    #: "agent" | "engine" | "bangboo".
    kind: str = "agent"
    #: Art for non-agents (agents' portraits come from the roster).
    icon: str = ""
    #: "exclusive" | "wengine" | "standard" | "bangboo".
    pool: str
    #: Pulls it took, counting this one, since the previous S-rank in the same
    #: pool.
    pulls: int
    #: True when no earlier S-rank in this pool is on record, so pulls made
    #: before the oldest stored record may be missing from ``pulls``.
    partial: bool = False
    #: On limited channels: "won" | "lost" | "guaranteed". Empty elsewhere.
    result: str = ""
    time: str


class PoolStats(BaseModel):
    pool: str
    hard_pity: int = 90
    total_pulls: int = 0
    #: Pulls made since that pool's last S-rank / A-rank.
    since_last_s: int = 0
    since_last_a: int = 0
    s_count: int = 0
    a_count: int = 0
    #: Mean pulls per S-rank, over S-ranks whose count is complete.
    average_s: float | None = None
    fifty_won: int = 0
    fifty_lost: int = 0
    #: The last S-rank lost its 50/50, so the next one is the featured one.
    guaranteed: bool = False
    polychrome: int = 0


class PullHistory(BaseModel):
    #: Newest first.
    s_ranks: list[SRankPull] = Field(default_factory=list)
    pools: list[PoolStats] = Field(default_factory=list)
    total_pulls: int = 0


class SourceProgress(BaseModel):
    """Per-source progress for the Sync button."""

    source: str
    state: SourceState = SourceState.IDLE
    #: e.g. 3 of 41 Prydwen guides.
    done: int = 0
    total: int = 0
    message: str = ""
    error_code: str = ""
    last_success_at: float | None = None


class SyncStatus(BaseModel):
    run_id: str = ""
    running: bool = False
    cancelled: bool = False
    started_at: float | None = None
    finished_at: float | None = None
    sources: list[SourceProgress] = Field(default_factory=list)
    #: True when at least one source failed but others succeeded.
    partial_failure: bool = False
    #: Full syncs already used today, and the daily cap.
    syncs_used_today: int = 0
    syncs_per_day: int = 0
    #: Set when a start was refused because the cap is spent.
    quota_exhausted: bool = False


# --------------------------------------------------------------------------- #
# Auth
# --------------------------------------------------------------------------- #


class CookiePayload(BaseModel):
    ltoken_v2: str
    ltuid_v2: str
    account_mid_v2: str | None = None
    account_id_v2: str | None = None


class AuthResult(BaseModel):
    ok: bool
    uid: str = ""
    nickname: str = ""
    level: int = 0
    region: str = ""
