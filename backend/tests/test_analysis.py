"""Tests for the join between account data and recommendations.

This is the layer the app exists for, so the rules are pinned here: name
matching across two sources that spell things differently, partial disc-set
credit, and which teams count as fieldable.
"""

from __future__ import annotations

from zzz_sidecar.models import (
    Agent,
    AgentBuild,
    AgentGuide,
    Disc,
    DiscSetRecommendation,
    EngineRecommendation,
    GapSeverity,
    Property,
    TeamRecommendation,
    WEngine,
)
from zzz_sidecar.services.analysis import _normalise, evaluate_build, run_analysis


def agent(agent_id: int, name: str, *, owned: bool = True) -> Agent:
    return Agent(id=agent_id, name=name, owned=owned, level=60, mindscape=0)


def disc(position: int, set_name: str, substats: list[str]) -> Disc:
    return Disc(
        id=1000 + position,
        name=f"Disc {position}",
        icon="",
        level=15,
        rarity="S",
        position=position,
        set_name=set_name,
        main_stat=Property(name="ATK%", value="30%"),
        substats=[Property(name=s, value="1") for s in substats],
    )


def build(agent_id: int, *, engine: str | None, discs: list[Disc]) -> AgentBuild:
    return AgentBuild(
        agent_id=agent_id,
        level=60,
        mindscape=0,
        w_engine=(
            None
            if engine is None
            else WEngine(id=1, name=engine, icon="", level=60, rarity="S", refinement=1)
        ),
        discs=discs,
    )


def guide(name: str, **kwargs) -> AgentGuide:
    return AgentGuide(
        slug=name.lower(),
        agent_name=name,
        disc_sets=kwargs.get(
            "disc_sets",
            [DiscSetRecommendation(set_name="Mock Metal", pieces=4, recommended=True)],
        ),
        engines=kwargs.get("engines", [EngineRecommendation(name="Testing Blade", rank=1)]),
        substat_priority=kwargs.get("substat_priority", ["CRIT DMG", "ATK%"]),
        teams=kwargs.get("teams", []),
    )


# -- name matching ---------------------------------------------------------- #


def test_normalise_bridges_hoyolab_and_prydwen_spellings():
    assert _normalise("Branch & Blade Song") == _normalise("Branch and Blade Song")
    assert _normalise("Branch & Blade Song") == _normalise("branch-and-blade-song")
    assert _normalise("Qingyi") == _normalise("  QINGYI ")


# -- build scoring ---------------------------------------------------------- #


def test_perfect_build_is_reported_complete():
    discs = [disc(i, "Mock Metal", ["CRIT DMG", "ATK%"]) for i in range(1, 5)]
    gap = evaluate_build(
        agent(1, "Testagent"),
        build(1, engine="Testing Blade", discs=discs),
        guide("Testagent"),
    )
    assert gap.severity is GapSeverity.COMPLETE
    assert gap.engine_matched is True
    assert gap.disc_set_match == 1.0
    assert "BUILD COMPLETE" in gap.callouts


def test_partial_disc_set_gets_partial_credit_and_is_listed_as_missing():
    discs = [disc(i, "Mock Metal", ["CRIT DMG"]) for i in range(1, 3)]  # 2 of 4
    gap = evaluate_build(
        agent(1, "Testagent"),
        build(1, engine="Testing Blade", discs=discs),
        guide("Testagent"),
    )
    assert gap.disc_set_match == 0.5
    assert gap.missing_sets == ["4pc Mock Metal (2/4)"]
    assert gap.severity in (GapSeverity.CLOSE, GapSeverity.NEEDS_WORK)


def test_wrong_engine_is_flagged_with_the_recommendation():
    gap = evaluate_build(
        agent(1, "Testagent"),
        build(1, engine="Wrong Engine", discs=[]),
        guide("Testagent"),
    )
    assert gap.engine_matched is False
    assert "Try Testing Blade" in gap.callouts


def test_missing_priority_substats_are_reported():
    discs = [disc(i, "Mock Metal", ["DEF%"]) for i in range(1, 5)]
    gap = evaluate_build(
        agent(1, "Testagent"),
        build(1, engine="Testing Blade", discs=discs),
        guide("Testagent"),
    )
    assert gap.substat_gaps == ["CRIT DMG", "ATK%"]


def test_substat_qualifiers_do_not_break_matching():
    # Prydwen writes "CRIT RATE (Until 80%)"; the disc just says "CRIT RATE".
    discs = [disc(i, "Mock Metal", ["CRIT RATE"]) for i in range(1, 5)]
    gap = evaluate_build(
        agent(1, "Testagent"),
        build(1, engine="Testing Blade", discs=discs),
        guide("Testagent", substat_priority=["CRIT RATE (Until 80%)"]),
    )
    assert gap.substat_gaps == []


def test_owned_agent_without_a_cached_guide_says_so():
    gap = evaluate_build(agent(1, "Testagent"), build(1, engine="X", discs=[]), None)
    assert gap.severity is GapSeverity.NOT_BUILT
    assert "NO GUIDE CACHED" in gap.callouts


# -- teams and farming ------------------------------------------------------ #


def test_teams_split_by_whether_every_member_is_owned():
    guides = [
        guide(
            "Testagent",
            teams=[
                TeamRecommendation(agent_names=["Testagent", "Supportagent"]),
                TeamRecommendation(agent_names=["Testagent", "Unownedagent"]),
            ],
        )
    ]
    agents = [agent(1, "Testagent"), agent(2, "Supportagent"), agent(3, "Unownedagent", owned=False)]
    builds = {
        1: build(1, engine="Testing Blade", discs=[disc(i, "Mock Metal", ["CRIT DMG"]) for i in range(1, 5)]),
        2: build(2, engine="Testing Blade", discs=[]),
    }

    result = run_analysis(agents, builds, guides)

    assert [t.team.agent_names for t in result.my_teams] == [["Testagent", "Supportagent"]]
    assert [t.team.agent_names for t in result.suggested_teams] == [["Testagent", "Unownedagent"]]
    assert result.suggested_teams[0].missing_members == ["Unownedagent"]


def test_the_same_team_appearing_on_two_guides_is_deduplicated():
    team = TeamRecommendation(agent_names=["Testagent", "Supportagent"])
    # Prydwen lists the same comp on every member's page, in either order.
    guides = [
        guide("Testagent", teams=[team]),
        guide("Supportagent", teams=[TeamRecommendation(agent_names=["Supportagent", "Testagent"])]),
    ]
    agents = [agent(1, "Testagent"), agent(2, "Supportagent")]
    result = run_analysis(agents, {}, guides)
    assert len(result.my_teams) == 1


def test_farming_suggests_the_agent_blocking_the_most_teams():
    guides = [
        guide(
            "Testagent",
            teams=[
                TeamRecommendation(agent_names=["Testagent", "Unownedagent"]),
                TeamRecommendation(agent_names=["Supportagent", "Unownedagent"]),
            ],
        )
    ]
    agents = [agent(1, "Testagent"), agent(2, "Supportagent"), agent(3, "Unownedagent", owned=False)]
    result = run_analysis(agents, {}, guides)

    labels = [p.label for p in result.farming]
    assert any("Unownedagent" in label for label in labels)


def test_unowned_agents_are_excluded_from_build_gaps():
    agents = [agent(1, "Testagent"), agent(2, "Ghost", owned=False)]
    result = run_analysis(agents, {}, [guide("Testagent")])
    assert [g.agent_name for g in result.build_gaps] == ["Testagent"]
