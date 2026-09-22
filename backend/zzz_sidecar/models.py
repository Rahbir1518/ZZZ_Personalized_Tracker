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
    #: 1-based position in Prydwen's ordered list.
    rank: int = 0
    note: str = ""
    #: Prydwen's rating for this engine, 0-100.
    rating: float = 0.0
    #: Recommended superimpose/refinement level, e.g. 1 or 5. 0 when unstated.
    recommended_superimpose: int = 0


class TeamRecommendation(BaseModel):
    name: str = ""
    agent_names: list[str] = Field(default_factory=list)
    note: str = ""


class AgentGuide(BaseModel):
    """One agent's recommendations, as parsed from Prydwen."""

    slug: str
    agent_name: str
    disc_sets: list[DiscSetRecommendation] = Field(default_factory=list)
    engines: list[EngineRecommendation] = Field(default_factory=list)
    #: Ordered best-first, e.g. ["CRIT DMG", "ATK%", "Anomaly Proficiency"].
    substat_priority: list[str] = Field(default_factory=list)
    #: Recommended main stat per slot, keyed by slot number as a string.
    main_stats: dict[str, list[str]] = Field(default_factory=dict)
    teams: list[TeamRecommendation] = Field(default_factory=list)
    #: Game patch this guide was cached against. Supplied by the sync service
    #: from the metadata source, not scraped from the page.
    patch: str = ""
    fetched_at: float = 0.0
    source_url: str = ""


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


class FarmingPriority(BaseModel):
    label: str
    reason: str
    #: Higher is more urgent.
    weight: float = 0.0
    agent_names: list[str] = Field(default_factory=list)


class Analysis(BaseModel):
    build_gaps: list[BuildGap] = Field(default_factory=list)
    my_teams: list[TeamStatus] = Field(default_factory=list)
    suggested_teams: list[TeamStatus] = Field(default_factory=list)
    farming: list[FarmingPriority] = Field(default_factory=list)
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
