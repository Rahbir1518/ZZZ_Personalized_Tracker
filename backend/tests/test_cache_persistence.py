"""Cached data must survive a restart.

The app opens before anything is signed in, so startup reads the cache with an
empty UID. Two bugs conspired here: ``ZZZUserStats`` has no ``uid`` field, so
everything was cached under "", and the loader then skipped the lookup whenever
the UID was falsy. Net effect: the grid was empty after every restart until the
user spent one of their five daily syncs.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from zzz_sidecar.cache.db import Cache
from zzz_sidecar.models import Agent, AgentBuild, Roster


@pytest.fixture
def cache() -> Cache:
    return Cache(Path(tempfile.mkdtemp()) / "cache.sqlite3")


def roster_payload(uid: str) -> dict:
    return Roster(
        uid=uid,
        nickname="Tester",
        agents=[Agent(id=1, name="Testagent", owned=True, level=60, mindscape=0)],
        fetched_at=0.0,
    ).model_dump()


def build_payload(agent_id: int) -> dict:
    return AgentBuild(agent_id=agent_id, level=60, mindscape=0).model_dump()


# -- roster ------------------------------------------------------------------ #


def test_a_roster_is_readable_by_its_own_uid(cache: Cache):
    cache.put_roster("800123", roster_payload("800123"))
    assert cache.get_roster("800123") is not None


def test_a_roster_cached_under_an_empty_uid_is_still_reachable(cache: Cache):
    # This is the exact shape of the bug: the UID was never resolved, so every
    # row landed under "" and the empty-string lookup returned nothing.
    cache.put_roster("", roster_payload(""))

    assert cache.get_roster("") is not None
    # And it is still found once the UID starts resolving properly.
    assert cache.get_roster("800123") is not None


def test_a_changed_uid_falls_back_rather_than_showing_nothing(cache: Cache):
    cache.put_roster("800123", roster_payload("800123"))
    recovered = cache.get_roster("different-uid")
    assert recovered is not None
    assert recovered["agents"][0]["name"] == "Testagent"


def test_an_empty_cache_still_reports_nothing(cache: Cache):
    assert cache.get_roster("800123") is None
    assert cache.get_builds("800123") == {}


# -- builds ------------------------------------------------------------------ #


def test_builds_use_the_same_fallback_as_the_roster(cache: Cache):
    cache.put_build("", 1, build_payload(1))
    cache.put_build("", 2, build_payload(2))

    assert set(cache.get_builds("")) == {1, 2}
    assert set(cache.get_builds("800123")) == {1, 2}


# -- the whole restart path -------------------------------------------------- #


def test_a_restart_before_sign_in_still_shows_the_roster(monkeypatch, cache: Cache):
    from zzz_sidecar.deps import get_sync

    service = get_sync()
    monkeypatch.setattr(service, "_cache", cache)
    # Startup order: the cache is read before any login, so the UID is empty.
    monkeypatch.setattr(type(service._hoyolab), "uid", property(lambda _self: ""))

    cache.put_roster("", roster_payload(""))
    cache.put_build("", 1, build_payload(1))
    cache.put_metadata("agents", "1.0", [Agent(id=1, name="Testagent").model_dump()])

    service.load_from_cache()

    assert [a.name for a in service.agents if a.owned] == ["Testagent"]
    assert set(service.builds) == {1}
