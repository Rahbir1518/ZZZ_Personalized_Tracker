"""The join: account reality vs. recommended builds.

This is the actual point of the app. Everything else is plumbing. The rules here
are deliberately explicit and readable rather than clever — they are the thing
most likely to need tuning once real rosters go through them.

Matching is by **display name**, normalised, because that is the only key shared
between HoYoLAB and Prydwen. ``_normalise`` absorbs the usual differences
(case, punctuation, "&" vs "and", accents).
"""

from __future__ import annotations

import re
import time
import unicodedata
from collections import Counter

from ..models import (
    Agent,
    AgentBuild,
    AgentGuide,
    Analysis,
    BuildGap,
    DomainCoverage,
    FarmingAgent,
    FarmingPriority,
    GapSeverity,
    TeamStatus,
)
from .domains import load_domain_pairs

#: Weights for the overall build score. Disc sets dominate because they are the
#: slowest thing to farm; substats matter but are partly luck.
_WEIGHT_DISCS = 0.45
_WEIGHT_ENGINE = 0.25
_WEIGHT_SUBSTATS = 0.30

#: A disc is only considered "contributing" to a set above this level.
_MIN_DISC_LEVEL = 0

_COMPLETE_AT = 0.90
_CLOSE_AT = 0.60
_NOT_BUILT_BELOW = 0.20


def normalise_name(name: str) -> str:
    """Fold a display name to a comparison key.

    "Branch & Blade Song" / "Branch and Blade Song" / "branch-and-blade-song"
    all collapse to the same token.

    Public because the codex pages match W-Engine and disc set names across the
    same three sources, and matching them a second way would let the two
    screens disagree about whether a name is the same name.
    """
    folded = unicodedata.normalize("NFKD", name)
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    folded = folded.lower().replace("&", " and ")
    folded = re.sub(r"[^a-z0-9]+", " ", folded)
    return " ".join(folded.split())


#: Internal alias; the module uses the short name throughout.
_normalise = normalise_name


def build_guide_index(guides: list[AgentGuide]) -> dict[str, AgentGuide]:
    """Index guides under every key an agent might be found by.

    HoYoLAB and Prydwen mostly agree on short display names, but not always:
    Prydwen's heading for Jane reads "Jane Doe" while HoYoLAB calls her "Jane".
    Indexing the slug as well covers that, since the slug is ``jane-doe``.

    Alternate versions of an agent are named in a different word order by each
    source: HoYoLAB's "Soldier 0 - Anby" is Prydwen's "Anby: Soldier 0", and
    "Starlight - Billy" is "Billy - Starlight". Indexing the *set* of words as
    well catches those without any per-agent special-casing.

    The Jane/full_name trick only works for *owned* agents, because that's the
    only place `full_name` gets populated (HoYoLAB supplies it for a roster
    entry; the un-owned catalog source only ever has the short display name —
    see `metadata.py`). So a catalog-only "Jane" has no full name to try and
    would otherwise never resolve to Prydwen's "Jane Doe" guide at all, which
    is what silently left her (and every other un-owned two-word-named agent)
    without a backfilled portrait. Indexing each guide under the first word of
    its own name closes that gap without touching `find_guide`: "Jane" now
    resolves on the very first, plain-name lookup, the same path "Anby" or
    "Billy" already take.

    Exact names win: a later, less specific key never overwrites one already
    claimed, so "Anby" cannot be stolen by "Anby: Soldier 0", and this first-
    word pass — run last — cannot steal a key any earlier, more specific pass
    already claimed either.
    """
    index: dict[str, AgentGuide] = {}
    for guide in guides:
        index.setdefault(_normalise(guide.agent_name), guide)
    for guide in guides:
        index.setdefault(_normalise(guide.slug), guide)
    for guide in guides:
        index.setdefault(_word_set_key(guide.agent_name), guide)
    for guide in guides:
        first_word = _normalise(guide.agent_name).split(" ", 1)[0]
        if first_word:
            index.setdefault(first_word, guide)
    return index


def _word_set_key(name: str) -> str:
    """An order-independent comparison key: the normalised words, sorted."""
    return " ".join(sorted(_normalise(name).split()))


def find_guide(agent: Agent, index: dict[str, AgentGuide]) -> AgentGuide | None:
    """Find an agent's guide, trying the display name then the full name.

    ``full_name`` is the fallback that resolves Jane -> "Jane Doe",
    Billy -> "Billy Kid" and friends.
    """
    for candidate in (agent.name, agent.full_name):
        if not candidate:
            continue
        guide = index.get(_normalise(candidate))
        if guide is not None:
            return guide
    for candidate in (agent.name, agent.full_name):
        if not candidate:
            continue
        guide = index.get(_word_set_key(candidate))
        if guide is not None:
            return guide
    return None


def _equipped_set_counts(build: AgentBuild) -> Counter[str]:
    """How many discs of each set the agent currently wears."""
    return Counter(
        _normalise(disc.set_name)
        for disc in build.discs
        if disc.set_name and disc.level >= _MIN_DISC_LEVEL
    )


def _substat_names(build: AgentBuild) -> set[str]:
    names: set[str] = set()
    for disc in build.discs:
        for sub in disc.substats:
            if sub.name:
                names.add(_normalise(sub.name))
    return names


def evaluate_build(agent: Agent, build: AgentBuild | None, guide: AgentGuide | None) -> BuildGap:
    """Score one owned agent's build against its recommendation."""
    gap = BuildGap(agent_id=agent.id, agent_name=agent.name, severity=GapSeverity.NOT_BUILT)

    if build is None:
        gap.callouts.append("NO BUILD DATA")
        return gap

    gap.equipped_engine = build.w_engine.name if build.w_engine is not None else ""

    if guide is None:
        # Owned but we have no recommendation yet (Prydwen not synced, or no
        # guide page). Report honestly instead of scoring against nothing.
        gap.severity = GapSeverity.NOT_BUILT
        gap.callouts.append("NO GUIDE CACHED")
        return gap

    # -- disc sets ---------------------------------------------------------- #
    equipped = _equipped_set_counts(build)
    wanted = [s for s in guide.disc_sets if s.recommended] or guide.disc_sets

    disc_score = 0.0
    if wanted:
        # Best single recommendation the agent satisfies, by fraction of the
        # required pieces actually worn.
        best = 0.0
        for rec in wanted:
            have = equipped.get(_normalise(rec.set_name), 0)
            fraction = min(have / rec.pieces, 1.0) if rec.pieces else 0.0
            if fraction >= 1.0:
                gap.matched_sets.append(f"{rec.pieces}pc {rec.set_name}")
            elif fraction > 0:
                gap.missing_sets.append(
                    f"{rec.pieces}pc {rec.set_name} ({have}/{rec.pieces})"
                )
            else:
                gap.missing_sets.append(f"{rec.pieces}pc {rec.set_name}")
            best = max(best, fraction)
        disc_score = best
    gap.disc_set_match = round(disc_score, 3)

    # -- W-Engine ----------------------------------------------------------- #
    recommended_engines = [e.name for e in guide.engines]
    gap.recommended_engines = recommended_engines[:5]
    equipped_engine = _normalise(gap.equipped_engine)
    engine_score = 0.0
    if equipped_engine and recommended_engines:
        for index, name in enumerate(recommended_engines):
            if _normalise(name) == equipped_engine:
                gap.engine_matched = True
                # Top pick scores 1.0, later picks taper but still count.
                engine_score = max(0.5, 1.0 - index * 0.1)
                break

    # -- substats ----------------------------------------------------------- #
    have_subs = _substat_names(build)
    priority = [p for p in guide.substat_priority if p]
    substat_score = 0.0
    if priority:
        hits = 0
        for wanted_sub in priority[:4]:
            # Priority entries carry qualifiers like "CRIT RATE (Until 80%)".
            token = _normalise(re.sub(r"\(.*?\)", "", wanted_sub))
            if not token:
                continue
            if any(token in sub or sub in token for sub in have_subs):
                hits += 1
            else:
                gap.substat_gaps.append(wanted_sub)
        substat_score = hits / min(len(priority), 4)

    # -- overall ------------------------------------------------------------ #
    gap.score = round(
        disc_score * _WEIGHT_DISCS
        + engine_score * _WEIGHT_ENGINE
        + substat_score * _WEIGHT_SUBSTATS,
        3,
    )

    if gap.score >= _COMPLETE_AT:
        gap.severity = GapSeverity.COMPLETE
        gap.callouts.append("BUILD COMPLETE")
    elif gap.score >= _CLOSE_AT:
        gap.severity = GapSeverity.CLOSE
        gap.callouts.append("ALMOST THERE")
    elif gap.score >= _NOT_BUILT_BELOW:
        gap.severity = GapSeverity.NEEDS_WORK
    else:
        gap.severity = GapSeverity.NOT_BUILT

    if not gap.engine_matched and recommended_engines:
        gap.callouts.append(f"Try {recommended_engines[0]}")
    if gap.missing_sets and gap.severity is not GapSeverity.COMPLETE:
        gap.callouts.append(f"Missing {gap.missing_sets[0]}")

    return gap


def evaluate_teams(
    guides: list[AgentGuide],
    owned_names: set[str],
    gaps_by_name: dict[str, BuildGap],
) -> tuple[list[TeamStatus], list[TeamStatus]]:
    """Split recommended teams into fieldable ("My Teams") and suggested.

    Teams are deduplicated across guides — the same comp appears on every
    member's page.

    **Suggested teams must include at least one agent the user owns.** Prydwen
    lists every meta comp in the game; a team where the user owns nobody is not
    a suggestion, it is noise. Requiring one owned member is what makes the tab
    read as "teams you could build toward" rather than a dump of the meta.
    """
    seen: set[tuple[str, ...]] = set()
    fieldable: list[TeamStatus] = []
    suggested: list[TeamStatus] = []

    for guide in guides:
        for team in guide.teams:
            key = tuple(sorted(_normalise(n) for n in team.agent_names))
            if not key or key in seen:
                continue
            seen.add(key)

            owned = [n for n in team.agent_names if _normalise(n) in owned_names]
            missing = [n for n in team.agent_names if _normalise(n) not in owned_names]

            scores = [
                gaps_by_name[_normalise(n)].score
                for n in owned
                if _normalise(n) in gaps_by_name
            ]
            status = TeamStatus(
                team=team,
                fieldable=not missing,
                owned_members=owned,
                missing_members=missing,
                readiness=round(sum(scores) / len(scores), 3) if scores else 0.0,
            )

            if status.fieldable:
                fieldable.append(status)
            elif owned:
                suggested.append(status)

    fieldable.sort(key=lambda t: t.readiness, reverse=True)
    # Nearly-complete first: most owned members, then fewest missing.
    suggested.sort(key=lambda t: (-len(t.owned_members), len(t.missing_members), -t.readiness))
    return fieldable, suggested


def _set_demand_from_guides(
    guides: list[AgentGuide],
) -> tuple[dict[str, list[str]], dict[str, str]]:
    """Which agents recommend each set, and the set's art, across every guide.

    Keyed by normalised set name so `suggest_farming` and
    `suggest_domain_coverage` (which needs the same lookup for both sets of a
    pair) don't each re-walk every guide's disc-set list.

    Art is collected from *every* row, recommended or not: a guide lists a set
    as an alternate 2-PC option (`recommended=False`) far more often than as
    its actual pick, and that row still carries a perfectly good icon URL —
    skipping it just means a set with no #1 fan anywhere (e.g. Soul Rock)
    never gets an icon at all. Demand (`set_wanted_by`) stays recommended-only,
    since that field answers "who actually wants this", not "who mentions it".
    """
    set_wanted_by: dict[str, list[str]] = {}
    set_icons: dict[str, str] = {}
    for guide in guides:
        for rec in guide.disc_sets:
            key = _normalise(rec.set_name)
            if rec.icon:
                set_icons.setdefault(key, rec.icon)
            if not rec.recommended:
                continue
            names = set_wanted_by.setdefault(key, [])
            if guide.agent_name not in names:
                names.append(guide.agent_name)
    return set_wanted_by, set_icons


def _farming_agents(
    names: list[str], portraits: dict[str, str], owned_names: set[str]
) -> list[FarmingAgent]:
    return [
        FarmingAgent(
            name=name,
            icon=portraits.get(_normalise(name), ""),
            owned=_normalise(name) in owned_names,
        )
        for name in names
    ]


def suggest_farming(
    gaps: list[BuildGap],
    teams: list[TeamStatus],
    guides: list[AgentGuide] | None = None,
    portraits: dict[str, str] | None = None,
    owned_names: set[str] | None = None,
) -> list[FarmingPriority]:
    """Rank what to farm next.

    Weighted by how many nearly-fieldable teams a target unblocks, so effort
    goes where it opens up the most play.

    Each disc-set target also lists **every agent that recommends the set**, not
    just the ones already owned: seeing that a set serves three agents you are
    building toward is the information that makes it worth farming. The UI dims
    the un-owned ones.
    """
    guides = guides or []
    portraits = portraits or {}
    owned_names = owned_names or set()
    out: list[FarmingPriority] = []

    # Which agents want each set, and the set's art, across every guide.
    set_wanted_by, set_icons = _set_demand_from_guides(guides)

    def as_agents(names: list[str]) -> list[FarmingAgent]:
        return _farming_agents(names, portraits, owned_names)

    # Disc sets blocking otherwise-ready agents.
    set_demand: Counter[str] = Counter()
    set_label_for: dict[str, str] = {}
    for gap in gaps:
        if gap.severity is GapSeverity.COMPLETE:
            continue
        for missing in gap.missing_sets[:1]:
            # "4pc Fanged Metal (2/4)" -> the set name, for matching art.
            bare = re.sub(r"^\d+pc\s+", "", missing)
            bare = re.sub(r"\s*\(\d+/\d+\)$", "", bare).strip()
            set_demand[bare] += 1
            set_label_for[bare] = missing

    for set_name, count in set_demand.most_common(6):
        key = _normalise(set_name)
        wanted_by = set_wanted_by.get(key, [])
        out.append(
            FarmingPriority(
                label=f"Farm {set_label_for.get(set_name, set_name)}",
                reason=f"Needed by {count} agent(s) you already own.",
                weight=float(count),
                agent_names=wanted_by[:12],
                kind="disc_set",
                icon=set_icons.get(key, ""),
                agents=as_agents(wanted_by[:12]),
            )
        )

    # Agents who are the single blocker on an otherwise-owned team.
    blocker: Counter[str] = Counter()
    for team in teams:
        if len(team.missing_members) == 1:
            blocker[team.missing_members[0]] += 1

    for agent_name, count in blocker.most_common(5):
        out.append(
            FarmingPriority(
                label=f"Pull or build {agent_name}",
                reason=f"Completes {count} recommended team(s) you almost have.",
                weight=float(count) * 1.5,
                agent_names=[agent_name],
                kind="agent",
                icon=portraits.get(_normalise(agent_name), ""),
                agents=as_agents([agent_name]),
            )
        )

    out.sort(key=lambda p: p.weight, reverse=True)
    return out[:10]


def suggest_domain_coverage(
    guides: list[AgentGuide] | None = None,
    portraits: dict[str, str] | None = None,
    owned_names: set[str] | None = None,
) -> list[DomainCoverage]:
    """Every Routine Cleanup stage, paired, with who each one covers.

    A stage drops both its sets regardless of which one you're farming for —
    running for Polar Metal also stacks up Freedom Blues pieces for free.
    The pairing itself is a fixed fact of the game (`domain_pairs.json`), so
    every stage is listed unconditionally; what varies is *who currently
    benefits*, the union of every agent either of its two sets is recommended
    for. A pair with no cached guide yet still shows, just with no agents —
    same "not filtered out, just empty" rule `DisksTab`'s set tiles use.
    """
    guides = guides or []
    portraits = portraits or {}
    owned_names = owned_names or set()
    set_wanted_by, set_icons = _set_demand_from_guides(guides)

    out: list[DomainCoverage] = []
    for set_a, set_b in load_domain_pairs():
        key_a, key_b = _normalise(set_a), _normalise(set_b)
        wanted_a = set_wanted_by.get(key_a, [])
        wanted_b = set_wanted_by.get(key_b, [])

        seen: set[str] = set()
        names: list[str] = []
        for name in wanted_a + wanted_b:
            if name not in seen:
                seen.add(name)
                names.append(name)

        owned_count = sum(1 for n in names if _normalise(n) in owned_names)
        if names:
            reason = f"One stage, both sets — covers {len(names)} agent(s)"
            reason += f", {owned_count} of them yours" if owned_count > 0 else ""
            reason += "."
        else:
            reason = "One stage, both sets — no cached recommendation yet."

        out.append(
            DomainCoverage(
                sets=[set_a, set_b],
                icons=[set_icons.get(key_a, ""), set_icons.get(key_b, "")],
                agents=_farming_agents(names, portraits, owned_names),
                reason=reason,
            )
        )

    # Most agents covered first; owned-agent coverage breaks ties, since that's
    # the roster this run actually helps today. Stable sort keeps the db's own
    # order among stages that tie (including the all-empty ones at the bottom).
    out.sort(
        key=lambda d: (len(d.agents), sum(1 for a in d.agents if a.owned)),
        reverse=True,
    )
    return out


def run_analysis(
    agents: list[Agent],
    builds: dict[int, AgentBuild],
    guides: list[AgentGuide],
) -> Analysis:
    """Full pass: per-agent gaps, team status, farming priorities."""
    index = build_guide_index(guides)
    owned = [a for a in agents if a.owned]

    # Prydwen names a team's members inconsistently with HoYoLAB (its team rows
    # may say "Jane Doe" where the roster says "Jane"), so register both spellings.
    owned_names: set[str] = set()
    for agent in owned:
        owned_names.add(_normalise(agent.name))
        if agent.full_name:
            owned_names.add(_normalise(agent.full_name))

    gaps = [
        evaluate_build(agent, builds.get(agent.id), find_guide(agent, index)) for agent in owned
    ]
    gaps.sort(key=lambda g: g.score, reverse=True)
    gaps_by_name = {_normalise(g.agent_name): g for g in gaps}

    my_teams, suggested = evaluate_teams(guides, owned_names, gaps_by_name)

    # Portraits come from the roster first (HoYoLAB art for owned agents, and
    # whatever the icon backfill found for the rest), then from team rows,
    # which cover agents the catalog has no art for at all.
    portraits: dict[str, str] = {}
    for agent in agents:
        icon = agent.square_icon or agent.rectangle_icon
        if not icon:
            continue
        portraits.setdefault(_normalise(agent.name), icon)
        if agent.full_name:
            portraits.setdefault(_normalise(agent.full_name), icon)

    for guide in guides:
        for team in guide.teams:
            for member in team.members:
                if member.icon:
                    portraits.setdefault(_normalise(member.name), member.icon)

    return Analysis(
        build_gaps=gaps,
        my_teams=my_teams,
        suggested_teams=suggested,
        farming=suggest_farming(
            gaps, my_teams + suggested, guides, portraits, owned_names
        ),
        domain_coverage=suggest_domain_coverage(guides, portraits, owned_names),
        computed_at=time.time(),
    )
