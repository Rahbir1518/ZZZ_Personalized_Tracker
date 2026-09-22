"""The daily sync cap.

Keeps the app a light, predictable consumer of upstream services — HoYoLAB
enforces its own per-cookie daily limit, and a cold Prydwen pass is expensive at
a 10s crawl delay.
"""

from __future__ import annotations

import tempfile
import time
from pathlib import Path

import pytest

from zzz_sidecar.cache.db import Cache
from zzz_sidecar.config import MAX_SYNCS_PER_DAY


@pytest.fixture
def cache() -> Cache:
    return Cache(Path(tempfile.mkdtemp()) / "cache.sqlite3")


def test_a_fresh_install_has_used_no_syncs(cache: Cache):
    assert cache.syncs_today() == 0


def test_each_recorded_run_counts_once(cache: Cache):
    for index in range(3):
        cache.record_sync_run(f"run-{index}")
    assert cache.syncs_today() == 3


def test_recording_the_same_run_id_twice_does_not_double_count(cache: Cache):
    # start() records once per run; guard against a retry inflating the count.
    cache.record_sync_run("run-a")
    cache.record_sync_run("run-a")
    assert cache.syncs_today() == 1


def test_the_cap_is_reached_after_the_configured_number_of_runs(cache: Cache):
    for index in range(MAX_SYNCS_PER_DAY):
        assert cache.syncs_today() < MAX_SYNCS_PER_DAY, "should still be under the cap"
        cache.record_sync_run(f"run-{index}")
    assert cache.syncs_today() == MAX_SYNCS_PER_DAY


def test_runs_from_other_days_do_not_count_against_today(cache: Cache):
    yesterday = time.strftime("%Y-%m-%d", time.localtime(time.time() - 86_400))
    cache._write(  # noqa: SLF001 - reaching in to fake a previous day
        "INSERT INTO sync_run (run_id, started_at, day) VALUES (?, ?, ?)",
        ("old-run", time.time() - 86_400, yesterday),
    )
    assert cache.syncs_today() == 0

    cache.record_sync_run("today-run")
    assert cache.syncs_today() == 1


def test_the_count_survives_a_restart(cache: Cache):
    cache.record_sync_run("run-a")
    cache.record_sync_run("run-b")
    path = cache._path  # noqa: SLF001
    cache.close()

    # A new process opening the same database sees the same quota.
    assert Cache(path).syncs_today() == 2


# -- guide cache invalidation ------------------------------------------------ #


def test_a_guide_from_an_older_parser_is_not_considered_fresh(monkeypatch, tmp_path):
    """An improved parser must invalidate its own stale output.

    Patch-keyed caching cannot catch this: the game patch has not changed, only
    the parser has, so without a schema version the app would serve guides
    missing newly-extracted fields forever.
    """
    import time as _time

    from zzz_sidecar.config import GUIDE_SCHEMA_VERSION
    from zzz_sidecar.deps import get_sync

    cache = Cache(tmp_path / "cache.sqlite3")
    service = get_sync()
    monkeypatch.setattr(service, "_cache", cache)

    stale = {"slug": "miyabi", "agent_name": "Miyabi", "schema_version": GUIDE_SCHEMA_VERSION - 1}
    cache.put_guide("miyabi", "1.0", stale, "")
    assert service._is_guide_fresh("miyabi", "1.0") is False

    current = {**stale, "schema_version": GUIDE_SCHEMA_VERSION}
    cache.put_guide("miyabi", "1.0", current, "")
    assert service._is_guide_fresh("miyabi", "1.0") is True
    assert _time.time() > 0  # sanity: the freshness check also uses wall clock
