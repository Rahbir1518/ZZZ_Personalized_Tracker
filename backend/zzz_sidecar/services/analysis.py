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
    FarmingPriority,
    GapSeverity,
    TeamStatus,
)

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


def _normalise(name: str) -> str:
    """Fold a display name to a comparison key.

    "Branch & Blade Song" / "Branch and Blade Song" / "branch-and-blade-song"
    all collapse to the same token.
    """
    folded = unicodedata.normalize("NFKD", name)
    folded = "".join(c for c in folded if not unicodedata.combining(c))
    folded = folded.lower().replace("&", " and ")
    folded = re.sub(r"[^a-z0-9]+", " ", folded)
    return " ".join(folded.split())


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
    """Split recommended teams into fieldable ("My Teams") and aspirational.

    Teams are deduplicated across guides — the same comp appears on every
    member's page.
    """
    seen: set[tuple[str, ...]] = set()
    fieldable: list[TeamStatus] = []
    aspirational: list[TeamStatus] = []

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
            (fieldable if status.fieldable else aspirational).append(status)

    fieldable.sort(key=lambda t: t.readiness, reverse=True)
    # Nearly-complete teams first: the ones worth pulling or building toward.
    aspirational.sort(key=lambda t: (len(t.missing_members), -t.readiness))
    return fieldable, aspirational


def suggest_farming(gaps: list[BuildGap], teams: list[TeamStatus]) -> list[FarmingPriority]:
    """Rank what to farm next.

    Weighted by how many nearly-fieldable teams an agent unblocks, so effort
    goes where it opens up the most play.
    """
    out: list[FarmingPriority] = []

    # Disc sets blocking otherwise-ready agents.
    set_demand: Counter[str] = Counter()
    set_agents: dict[str, list[str]] = {}
    for gap in gaps:
        if gap.severity in (GapSeverity.COMPLETE,):
            continue
        for missing in gap.missing_sets[:1]:
            set_demand[missing] += 1
            set_agents.setdefault(missing, []).append(gap.agent_name)

    for set_label, count in set_demand.most_common(5):
        out.append(
            FarmingPriority(
                label=f"Farm {set_label}",
                reason=f"Needed by {count} agent(s) you already own.",
                weight=float(count),
                agent_names=set_agents.get(set_label, [])[:6],
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
            )
        )

    out.sort(key=lambda p: p.weight, reverse=True)
    return out[:10]


def run_analysis(
    agents: list[Agent],
    builds: dict[int, AgentBuild],
    guides: list[AgentGuide],
) -> Analysis:
    """Full pass: per-agent gaps, team status, farming priorities."""
    guides_by_name = {_normalise(g.agent_name): g for g in guides}
    owned = [a for a in agents if a.owned]
    owned_names = {_normalise(a.name) for a in owned}

    gaps = [
        evaluate_build(agent, builds.get(agent.id), guides_by_name.get(_normalise(agent.name)))
        for agent in owned
    ]
    gaps.sort(key=lambda g: g.score, reverse=True)
    gaps_by_name = {_normalise(g.agent_name): g for g in gaps}

    my_teams, suggested = evaluate_teams(guides, owned_names, gaps_by_name)

    return Analysis(
        build_gaps=gaps,
        my_teams=my_teams,
        suggested_teams=suggested,
        farming=suggest_farming(gaps, my_teams + suggested),
        computed_at=time.time(),
    )
