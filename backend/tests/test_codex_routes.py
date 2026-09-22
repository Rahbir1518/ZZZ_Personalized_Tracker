"""The codex endpoints' join with your account.

The game-data half of these pages is covered in ``test_codex``. What is checked
here is the half that makes them worth opening: a W-Engine page has to know
which of *your* agents wear it and whose guide is asking for it, matched across
three sources that spell names differently.

The CDN is stubbed out entirely — these tests are about the join, and a test
that only passes when the machine is online is not a test of the join.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from zzz_sidecar.config import configure
from zzz_sidecar.models import (
    Agent,
    AgentBuild,
    AgentGuide,
    AgentSynergy,
    Disc,
    DiscSetDetail,
    DiscSetRecommendation,
    EngineDetail,
    EngineRecommendation,
    WEngine,
)

TOKEN = "test-token"
HEADERS = {"X-Sidecar-Token": TOKEN}


def _agent(agent_id: int, name: str, owned: bool = True, **kwargs: Any) -> Agent:
    return Agent(id=agent_id, name=name, owned=owned, square_icon=f"{name}.png", **kwargs)


def _build(agent_id: int, engine: str, sets: list[str]) -> AgentBuild:
    return AgentBuild(
        agent_id=agent_id,
        level=60,
        mindscape=0,
        w_engine=WEngine(
            id=1, name=engine, icon="", level=60, rarity="S", refinement=1
        ),
        discs=[
            Disc(id=index, name="", icon="", level=15, rarity="S", position=index + 1, set_name=set_name)
            for index, set_name in enumerate(sets)
        ],
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    configure(port=8999, token=TOKEN, data_dir=Path(tempfile.mkdtemp()))

    from zzz_sidecar.app import create_app
    from zzz_sidecar.deps import get_sync

    # The CDN is not this test's subject. Stubbing the service keeps the join
    # under test and the suite offline.
    async def _no_engine(name: str) -> EngineDetail:
        return EngineDetail(name=name)

    async def _no_set(name: str) -> DiscSetDetail:
        return DiscSetDetail(set_name=name)

    async def _no_synergy(agent_id: int) -> AgentSynergy:
        return AgentSynergy(agent_name="")

    class _StubCodex:
        engine = staticmethod(_no_engine)
        disc_set = staticmethod(_no_set)
        synergy = staticmethod(_no_synergy)

    monkeypatch.setattr("zzz_sidecar.routers.codex.get_codex", lambda: _StubCodex())

    sync = get_sync()
    agents = [
        _agent(1, "Miyabi"),
        _agent(2, "Yanagi"),
        # Prydwen calls her "Jane Doe"; HoYoLAB calls her "Jane".
        _agent(3, "Jane", full_name="Jane Doe"),
        _agent(4, "Astra Yao", owned=False),
    ]
    builds = {
        1: _build(1, "Hailstorm Shrine", ["Woodpecker Electro"] * 4),
        2: _build(2, "Timeweaver", ["Freedom Blues", "Freedom Blues", "Woodpecker Electro", "Woodpecker Electro"]),
        3: _build(3, "Hailstorm Shrine", []),
    }
    guides = [
        AgentGuide(
            slug="miyabi",
            agent_name="Miyabi",
            engines=[EngineRecommendation(name="Hailstorm Shrine", rank=1, rating=98.0, recommended_superimpose=1)],
            disc_sets=[
                DiscSetRecommendation(set_name="Woodpecker Electro", pieces=2),
                DiscSetRecommendation(set_name="Woodpecker Electro", pieces=4, rank=1),
            ],
        ),
        AgentGuide(
            slug="jane-doe",
            agent_name="Jane Doe",
            engines=[EngineRecommendation(name="hailstorm  shrine", rank=2, rating=91.0)],
        ),
        AgentGuide(
            slug="astra-yao",
            agent_name="Astra Yao",
            engines=[EngineRecommendation(name="Hailstorm Shrine", rank=1, rating=99.0)],
        ),
    ]

    monkeypatch.setattr("zzz_sidecar.routers.codex._guides", lambda: guides)

    with TestClient(create_app()) as test_client:
        # Seeded after startup, not before: the lifespan hydrates the sync
        # service from the (empty) cache and would overwrite anything set up
        # ahead of it.
        monkeypatch.setattr(sync, "_agents", agents, raising=False)
        monkeypatch.setattr(sync, "_builds", builds, raising=False)
        yield test_client


# -- W-Engines --------------------------------------------------------------- #


def test_engine_page_lists_who_of_yours_is_wearing_it(client: TestClient) -> None:
    body = client.get("/engines", params={"name": "Hailstorm Shrine"}, headers=HEADERS).json()

    assert [m["agent_name"] for m in body["equipped_by"]] == ["Miyabi", "Jane"]
    assert body["equipped_by"][0]["detail"] == "Lv 60 · S1"


def test_engine_page_matches_names_across_sources(client: TestClient) -> None:
    """Prydwen's "hailstorm  shrine" and HoYoLAB's "Hailstorm Shrine" are the
    same engine, and Jane's guide is filed under "Jane Doe"."""
    body = client.get("/engines", params={"name": "Hailstorm Shrine"}, headers=HEADERS).json()

    assert "Jane" in [m["agent_name"] for m in body["recommended_for"]]


def test_engine_page_puts_agents_you_own_first(client: TestClient) -> None:
    """Astra Yao rates it highest, but she is not on the roster — the reader
    can only act on the ones they have."""
    body = client.get("/engines", params={"name": "Hailstorm Shrine"}, headers=HEADERS).json()
    names = [m["agent_name"] for m in body["recommended_for"]]

    assert names == ["Miyabi", "Jane", "Astra Yao"]
    assert body["recommended_for"][-1]["owned"] is False


def test_an_unknown_engine_still_returns_its_usage(client: TestClient) -> None:
    """The game-data lookup missing must not empty the page."""
    body = client.get("/engines", params={"name": "Timeweaver"}, headers=HEADERS).json()

    assert body["known"] is False
    assert [m["agent_name"] for m in body["equipped_by"]] == ["Yanagi"]


# -- disc sets --------------------------------------------------------------- #


def test_disc_set_page_counts_the_pieces_each_agent_wears(client: TestClient) -> None:
    body = client.get("/disc-sets", params={"name": "Woodpecker Electro"}, headers=HEADERS).json()
    worn = {m["agent_name"]: m["pieces"] for m in body["equipped_by"]}

    assert worn == {"Miyabi": 4, "Yanagi": 2}
    # Most pieces first, so the agent actually running the set leads.
    assert body["equipped_by"][0]["agent_name"] == "Miyabi"


def test_disc_set_page_keeps_the_bigger_of_two_recommendations(client: TestClient) -> None:
    """A guide can list the same set at 2-PC and 4-PC. The 4-PC is the one
    that says what the set is for."""
    body = client.get("/disc-sets", params={"name": "Woodpecker Electro"}, headers=HEADERS).json()
    mentions = [m for m in body["recommended_for"] if m["agent_name"] == "Miyabi"]

    assert len(mentions) == 1
    assert mentions[0]["pieces"] == 4


def test_a_set_nobody_wears_is_not_an_error(client: TestClient) -> None:
    response = client.get("/disc-sets", params={"name": "Puffer Electro"}, headers=HEADERS)

    assert response.status_code == 200
    assert response.json()["equipped_by"] == []


# -- synergy ----------------------------------------------------------------- #


def test_synergy_answers_in_the_order_asked(client: TestClient) -> None:
    """The panel reads left to right across the team, so the order is part of
    the contract."""
    body = client.get(
        "/synergy", params=[("names", "Yanagi"), ("names", "Miyabi")], headers=HEADERS
    ).json()

    assert [row["agent_name"] for row in body] == ["Yanagi", "Miyabi"]


def test_synergy_carries_the_roster_facts_for_display(client: TestClient) -> None:
    body = client.get("/synergy", params=[("names", "Astra Yao")], headers=HEADERS).json()

    assert body[0]["owned"] is False


def test_synergy_keeps_a_slot_for_an_agent_not_in_the_catalog(client: TestClient) -> None:
    """A guide can name an agent the catalog has not shipped. Dropping the row
    would silently shorten the team."""
    body = client.get("/synergy", params=[("names", "Someone New")], headers=HEADERS).json()

    assert len(body) == 1
    assert body[0]["agent_name"] == "Someone New"
    assert body[0]["known"] is False


def test_synergy_with_no_names_is_an_empty_list(client: TestClient) -> None:
    assert client.get("/synergy", headers=HEADERS).json() == []
