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
    TeamMember,
    TeamRecommendation,
    WEngine,
)
from zzz_sidecar.services.analysis import (
    _normalise,
    build_guide_index,
    evaluate_build,
    find_guide,
    run_analysis,
)


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


# -- name matching across the two sources ----------------------------------- #


def test_a_guide_is_found_by_full_name_when_the_short_name_differs():
    # HoYoLAB calls her "Jane"; Prydwen's heading reads "Jane Doe". Matching on
    # the display name alone silently dropped her guide.
    jane = Agent(id=99, name="Jane", full_name="Jane Doe", owned=True, level=40, mindscape=0)
    index = build_guide_index([guide("Jane Doe")])

    found = find_guide(jane, index)
    assert found is not None and found.agent_name == "Jane Doe"


def test_a_guide_is_found_by_slug_when_neither_name_matches():
    agent = Agent(id=98, name="Yuzuha", full_name="Ukinami Yuzuha", owned=True)
    hit = guide("Someone Else")
    hit.slug = "ukinami-yuzuha"
    index = build_guide_index([hit])

    assert find_guide(agent, index) is hit


def test_an_exact_name_is_never_stolen_by_a_longer_variant():
    # "Anby" and "Anby: Soldier 0" are different agents.
    anby = Agent(id=1, name="Anby", full_name="Anby Demara", owned=True)
    exact, variant = guide("Anby"), guide("Anby: Soldier 0")

    found = find_guide(anby, build_guide_index([variant, exact]))
    assert found is not None and found.agent_name == "Anby"


def test_an_unknown_agent_matches_nothing():
    stranger = Agent(id=97, name="Nobody", full_name="Nobody At All", owned=True)
    assert find_guide(stranger, build_guide_index([guide("Testagent")])) is None


# -- suggested-team filtering ------------------------------------------------ #


def test_a_comp_with_no_owned_members_is_not_suggested():
    # Prydwen lists every meta comp; one where the user owns nobody is noise.
    guides = [
        guide(
            "Testagent",
            teams=[
                TeamRecommendation(agent_names=["Stranger A", "Stranger B", "Stranger C"]),
                TeamRecommendation(agent_names=["Testagent", "Stranger A"]),
            ],
        )
    ]
    result = run_analysis([agent(1, "Testagent")], {}, guides)

    suggested = [t.team.agent_names for t in result.suggested_teams]
    assert suggested == [["Testagent", "Stranger A"]]


def test_suggested_teams_lead_with_the_ones_you_have_most_of():
    guides = [
        guide(
            "Testagent",
            teams=[
                TeamRecommendation(agent_names=["Testagent", "Stranger A", "Stranger B"]),
                TeamRecommendation(agent_names=["Testagent", "Supportagent", "Stranger A"]),
            ],
        )
    ]
    agents = [agent(1, "Testagent"), agent(2, "Supportagent")]
    result = run_analysis(agents, {}, guides)

    assert result.suggested_teams[0].owned_members == ["Testagent", "Supportagent"]


def test_team_membership_matches_on_full_name_too():
    # Prydwen's team rows may spell a member differently from the roster.
    guides = [guide("Testagent", teams=[TeamRecommendation(agent_names=["Jane Doe", "Testagent"])])]
    agents = [
        agent(1, "Testagent"),
        Agent(id=2, name="Jane", full_name="Jane Doe", owned=True, level=40, mindscape=0),
    ]
    result = run_analysis(agents, {}, guides)

    assert [t.team.agent_names for t in result.my_teams] == [["Jane Doe", "Testagent"]]


# -- portrait backfill ------------------------------------------------------- #


def test_unowned_agents_borrow_portraits_from_team_rows(monkeypatch, tmp_path):
    """Un-owned tiles would otherwise render as bare initials.

    HoYoLAB only supplies art for owned agents and hakush.in's image URLs 404,
    so the portraits come from Prydwen's team rows, which name and picture
    every agent they mention.
    """
    from zzz_sidecar.cache.db import Cache
    from zzz_sidecar.deps import get_sync

    service = get_sync()
    monkeypatch.setattr(service, "_cache", Cache(tmp_path / "cache.sqlite3"))

    owned = Agent(id=1, name="Testagent", owned=True)
    ghost = Agent(id=2, name="Yuzuha", full_name="Ukinami Yuzuha", owned=False)
    service._agents = [owned, ghost]
    service._builds = {}

    guides = [
        guide(
            "Testagent",
            teams=[
                TeamRecommendation(
                    agent_names=["Testagent", "Yuzuha"],
                    members=[
                        TeamMember(name="Testagent", icon="https://cdn/test.webp"),
                        TeamMember(name="Yuzuha", icon="https://cdn/yuzuha.webp"),
                    ],
                )
            ],
        )
    ]

    service._backfill_icons(guides)
    assert ghost.square_icon == "https://cdn/yuzuha.webp"


def test_backfill_never_overwrites_the_users_own_hoyolab_art(monkeypatch, tmp_path):
    from zzz_sidecar.cache.db import Cache
    from zzz_sidecar.deps import get_sync

    service = get_sync()
    monkeypatch.setattr(service, "_cache", Cache(tmp_path / "cache.sqlite3"))

    owned = Agent(id=1, name="Testagent", owned=True, square_icon="https://hoyolab/mine.png")
    service._agents = [owned]

    service._backfill_icons(
        [
            guide(
                "Testagent",
                teams=[
                    TeamRecommendation(
                        agent_names=["Testagent"],
                        members=[TeamMember(name="Testagent", icon="https://cdn/other.webp")],
                    )
                ],
            )
        ]
    )
    assert owned.square_icon == "https://hoyolab/mine.png"
