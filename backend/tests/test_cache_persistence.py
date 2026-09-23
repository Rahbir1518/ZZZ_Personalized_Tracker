"""Cached data must survive a restart — and must never survive a *different*
account signing in.

The app opens before anything is signed in, so startup reads the cache with an
empty UID; that read is allowed to fall back to whatever roster was cached
most recently, since there is no account to disagree with yet. Once a real
UID is known — a login actually happened this session — a miss has to stay a
miss. That distinction is the whole fix: the old version fell back for *any*
missing UID, which meant signing in as a second account with no cache of its
own yet quietly showed the *first* account's roster relabelled as the
second one's, rather than the honestly-empty screen a real cache miss should
show until that account's own sync runs.
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


def roster_payload(uid: str, name: str = "Testagent") -> dict:
    return Roster(
        uid=uid,
        nickname="Tester",
        agents=[Agent(id=1, name=name, owned=True, level=60, mindscape=0)],
        fetched_at=0.0,
    ).model_dump()


def build_payload(agent_id: int) -> dict:
    return AgentBuild(agent_id=agent_id, level=60, mindscape=0).model_dump()


# -- roster ------------------------------------------------------------------ #


def test_a_roster_is_readable_by_its_own_uid(cache: Cache):
    cache.put_roster("800123", roster_payload("800123"))
    assert cache.get_roster("800123") is not None


def test_an_unresolved_uid_falls_back_to_the_most_recent_roster(cache: Cache):
    # Process startup, before the saved-cookie auto-login has resolved: the
    # caller does not yet know which account this is about to be, so showing
    # the most recently synced roster is the honest "loading, here's what we
    # had" state, not a mismatch.
    cache.put_roster("800123", roster_payload("800123"))
    assert cache.get_roster("") is not None


def test_a_known_uid_with_no_cache_shows_nothing_not_another_accounts_data(
    cache: Cache,
):
    """The actual bug: signing in as a second account (a real, known UID)
    that has never synced must not surface the first account's roster."""
    cache.put_roster("800123", roster_payload("800123", name="AccountOneAgent"))

    recovered = cache.get_roster("different-uid")

    assert recovered is None


def test_an_empty_cache_still_reports_nothing(cache: Cache):
    assert cache.get_roster("800123") is None
    assert cache.get_builds("800123") == {}


# -- builds ------------------------------------------------------------------ #


def test_builds_are_readable_by_their_own_uid(cache: Cache):
    cache.put_build("800123", 1, build_payload(1))
    cache.put_build("800123", 2, build_payload(2))

    assert set(cache.get_builds("800123")) == {1, 2}


def test_builds_for_an_unresolved_uid_fall_back_like_the_roster_does(cache: Cache):
    cache.put_build("800123", 1, build_payload(1))
    assert set(cache.get_builds("")) == {1}


def test_builds_for_a_second_known_account_do_not_leak_the_first_accounts(
    cache: Cache,
):
    cache.put_build("800123", 1, build_payload(1))

    assert cache.get_builds("different-uid") == {}


# -- the whole restart path -------------------------------------------------- #


def test_a_restart_before_sign_in_still_shows_the_roster(monkeypatch, cache: Cache):
    from zzz_sidecar.deps import get_sync

    service = get_sync()
    monkeypatch.setattr(service, "_cache", cache)
    # Startup order: the cache is read before any login, so the UID is empty.
    monkeypatch.setattr(type(service._hoyolab), "uid", property(lambda _self: ""))

    cache.put_roster("800123", roster_payload("800123"))
    cache.put_build("800123", 1, build_payload(1))
    cache.put_metadata("agents", "1.0", [Agent(id=1, name="Testagent").model_dump()])

    service.load_from_cache()

    assert [a.name for a in service.agents if a.owned] == ["Testagent"]
    assert set(service.builds) == {1}


def test_signing_in_as_a_different_account_does_not_load_from_cache_the_first_ones_roster(
    monkeypatch, cache: Cache
):
    """The end-to-end shape of the bug report: account A has synced and is
    cached; account B signs in (a real, different UID) and has never synced.
    `load_from_cache` — what `/auth/login` calls right after a successful
    login — must show account B's own (empty) state, not account A's."""
    from zzz_sidecar.deps import get_sync

    service = get_sync()
    monkeypatch.setattr(service, "_cache", cache)

    cache.put_roster("account-a", roster_payload("account-a", name="AccountOneAgent"))
    cache.put_build("account-a", 1, build_payload(1))
    cache.put_metadata("agents", "1.0", [Agent(id=1, name="AccountOneAgent").model_dump()])

    # Account B, a different real UID, has never synced.
    monkeypatch.setattr(type(service._hoyolab), "uid", property(lambda _self: "account-b"))

    # Mirrors what the /auth/login route now does: clear the in-memory view
    # before reloading from cache, so a still-populated `service` left over
    # from account A (this file reuses the same SyncService singleton across
    # tests) can't leak through `_agents_from_cache`'s own in-memory fallback.
    service.clear()
    service.load_from_cache()

    assert [a.name for a in service.agents if a.owned] == []
    assert service.builds == {}
