"""Thin SQLite wrapper for the local cache.

Sync sqlite3 calls are fine here: every statement is a small local read/write,
and the sidecar serves one desktop user. Anything slow (HTTP) is async.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

from ..config import get_settings

_SCHEMA = (Path(__file__).parent / "schema.sql").read_text(encoding="utf-8")


class Cache:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._migrate()
            self._conn.executescript(_SCHEMA)
            self._conn.commit()

    def _migrate(self) -> None:
        """Patch up columns `CREATE TABLE IF NOT EXISTS` can't add to a
        database that already exists from before that column was introduced.

        Runs before the schema script, since that script's own indexes (e.g.
        on `sync_run (day, uid)`) assume the column is already there.
        """
        tables = {
            row["name"]
            for row in self._conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        if "sync_run" not in tables:
            return
        columns = {row["name"] for row in self._conn.execute("PRAGMA table_info(sync_run)")}
        if "uid" not in columns:
            self._conn.execute("ALTER TABLE sync_run ADD COLUMN uid TEXT NOT NULL DEFAULT ''")
            self._conn.commit()

    # -- generic helpers ---------------------------------------------------- #

    def _write(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        with self._lock:
            self._conn.execute(sql, params)
            self._conn.commit()

    def _read_one(self, sql: str, params: tuple[Any, ...] = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def _read_all(self, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    # -- Prydwen ------------------------------------------------------------ #

    def get_guide(self, slug: str, patch: str | None = None) -> tuple[dict[str, Any], float] | None:
        """Return (payload, fetched_at) for a slug.

        With ``patch`` given, only an entry captured against that patch counts as
        a hit. Without it, the most recently fetched entry wins.
        """
        if patch is not None:
            row = self._read_one(
                "SELECT payload, fetched_at FROM prydwen_guide WHERE slug = ? AND patch = ?",
                (slug, patch),
            )
        else:
            row = self._read_one(
                "SELECT payload, fetched_at FROM prydwen_guide WHERE slug = ? "
                "ORDER BY fetched_at DESC LIMIT 1",
                (slug,),
            )
        if row is None:
            return None
        return json.loads(row["payload"]), float(row["fetched_at"])

    def put_guide(self, slug: str, patch: str, payload: dict[str, Any], source_url: str) -> None:
        self._write(
            "INSERT OR REPLACE INTO prydwen_guide (slug, patch, payload, source_url, fetched_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (slug, patch, json.dumps(payload), source_url, time.time()),
        )

    def all_guides(self) -> list[dict[str, Any]]:
        rows = self._read_all(
            "SELECT payload FROM prydwen_guide GROUP BY slug HAVING MAX(fetched_at)"
        )
        return [json.loads(r["payload"]) for r in rows]

    def put_snapshot(self, slug: str, html: str) -> None:
        self._write(
            "INSERT OR REPLACE INTO prydwen_snapshot (slug, html, fetched_at) VALUES (?, ?, ?)",
            (slug, html, time.time()),
        )

    def get_snapshot(self, slug: str) -> str | None:
        row = self._read_one("SELECT html FROM prydwen_snapshot WHERE slug = ?", (slug,))
        return None if row is None else str(row["html"])

    # -- metadata ----------------------------------------------------------- #

    def get_metadata(self, kind: str) -> tuple[list[dict[str, Any]], float] | None:
        row = self._read_one(
            "SELECT payload, fetched_at FROM metadata WHERE kind = ? "
            "ORDER BY fetched_at DESC LIMIT 1",
            (kind,),
        )
        if row is None:
            return None
        return json.loads(row["payload"]), float(row["fetched_at"])

    def put_metadata(self, kind: str, version: str, payload: list[dict[str, Any]]) -> None:
        self._write(
            "INSERT OR REPLACE INTO metadata (kind, version, payload, fetched_at) "
            "VALUES (?, ?, ?, ?)",
            (kind, version, json.dumps(payload), time.time()),
        )

    # -- codex -------------------------------------------------------------- #

    def get_codex(self, kind: str, key: str = "") -> tuple[Any, str, float] | None:
        """Return (payload, version, fetched_at) for one codex entry.

        The caller decides whether the version still counts as fresh; this
        layer only stores what it was given.
        """
        row = self._read_one(
            "SELECT payload, version, fetched_at FROM codex WHERE kind = ? AND key = ?",
            (kind, key),
        )
        if row is None:
            return None
        return json.loads(row["payload"]), str(row["version"]), float(row["fetched_at"])

    def put_codex(self, kind: str, key: str, version: str, payload: Any) -> None:
        self._write(
            "INSERT OR REPLACE INTO codex (kind, key, version, payload, fetched_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (kind, key, version, json.dumps(payload), time.time()),
        )

    # -- account ------------------------------------------------------------ #

    def put_roster(self, uid: str, payload: dict[str, Any]) -> None:
        self._write(
            "INSERT OR REPLACE INTO roster_snapshot (uid, payload, fetched_at) VALUES (?, ?, ?)",
            (uid, json.dumps(payload), time.time()),
        )

    def get_roster(self, uid: str) -> dict[str, Any] | None:
        """The cached roster for a UID.

        Falls back to the most recent roster of *any* UID only when ``uid``
        itself is unknown (``""``) — the brief window at process startup
        before the saved-cookie auto-login has resolved and this session
        does not yet know which account it is about to be. That fallback
        used to apply unconditionally, which is fine on a relaunch but wrong
        the moment two different accounts are involved: signing in as a
        second account is a real, known ``uid`` with no cache of its own
        yet, and falling back would silently show the *first* account's
        roster relabelled as the second one's, which is worse than an empty
        screen for that one sync. A known ``uid`` with no cache is exactly
        the case that should show nothing until a sync actually runs.
        """
        row = self._read_one("SELECT payload FROM roster_snapshot WHERE uid = ?", (uid,))
        if row is None and uid == "":
            row = self._read_one(
                "SELECT payload FROM roster_snapshot ORDER BY fetched_at DESC LIMIT 1"
            )
        return None if row is None else json.loads(row["payload"])

    def put_build(self, uid: str, agent_id: int, payload: dict[str, Any]) -> None:
        self._write(
            "INSERT OR REPLACE INTO agent_build (uid, agent_id, payload, fetched_at) "
            "VALUES (?, ?, ?, ?)",
            (uid, agent_id, json.dumps(payload), time.time()),
        )

    def get_builds(self, uid: str) -> dict[int, dict[str, Any]]:
        """Equipped builds for a UID, with the same unknown-``uid``-only
        fallback as ``get_roster`` so the two can never disagree about what
        is cached, and can never leak one account's builds into another's
        roster either."""
        rows = self._read_all("SELECT agent_id, payload FROM agent_build WHERE uid = ?", (uid,))
        if not rows and uid == "":
            rows = self._read_all(
                "SELECT agent_id, payload FROM agent_build "
                "WHERE uid = (SELECT uid FROM agent_build ORDER BY fetched_at DESC LIMIT 1)"
            )
        return {int(r["agent_id"]): json.loads(r["payload"]) for r in rows}

    # -- signal search history ---------------------------------------------- #

    def put_pulls(self, uid: str, rows: list[dict[str, Any]]) -> int:
        """Store pull records, keeping any already stored. Returns how many
        were new."""
        if not rows:
            return 0
        with self._lock:
            before = self._conn.total_changes
            self._conn.executemany(
                "INSERT OR IGNORE INTO signal_pull "
                "(uid, id, banner_type, item_id, name, item_type, rank, time) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (
                        uid,
                        int(r["id"]),
                        int(r["banner_type"]),
                        int(r["item_id"]),
                        str(r["name"]),
                        str(r.get("item_type", "")),
                        str(r["rank"]),
                        str(r["time"]),
                    )
                    for r in rows
                ],
            )
            self._conn.commit()
            return self._conn.total_changes - before

    def latest_pull_id(self, uid: str, banner_type: int) -> int:
        """The newest stored record id for one banner, or 0 when none are."""
        row = self._read_one(
            "SELECT MAX(id) AS id FROM signal_pull WHERE uid = ? AND banner_type = ?",
            (uid, banner_type),
        )
        return 0 if row is None or row["id"] is None else int(row["id"])

    def get_pulls(self, uid: str) -> list[dict[str, Any]]:
        """Every stored pull for a UID, oldest first.

        No unknown-``uid`` fallback, unlike ``get_roster``: pull history is only
        ever shown for an account that is actually signed in.
        """
        rows = self._read_all(
            "SELECT id, banner_type, item_id, name, item_type, rank, time "
            "FROM signal_pull WHERE uid = ? ORDER BY id",
            (uid,),
        )
        return [dict(r) for r in rows]

    # -- sync log ----------------------------------------------------------- #

    def mark_sync_success(self, source: str) -> None:
        self._write(
            "INSERT OR REPLACE INTO sync_log (source, last_success_at) VALUES (?, ?)",
            (source, time.time()),
        )

    def last_sync_times(self) -> dict[str, float]:
        rows = self._read_all("SELECT source, last_success_at FROM sync_log")
        return {str(r["source"]): float(r["last_success_at"]) for r in rows}

    # -- daily sync quota --------------------------------------------------- #

    @staticmethod
    def _today() -> str:
        """Local calendar day, so the quota resets at the user's midnight."""
        return time.strftime("%Y-%m-%d", time.localtime())

    def record_sync_run(self, run_id: str, uid: str) -> None:
        self._write(
            "INSERT OR REPLACE INTO sync_run (run_id, uid, started_at, day) VALUES (?, ?, ?, ?)",
            (run_id, uid, time.time(), self._today()),
        )

    def syncs_today(self, uid: str) -> int:
        row = self._read_one(
            "SELECT COUNT(*) AS n FROM sync_run WHERE day = ? AND uid = ?",
            (self._today(), uid),
        )
        return 0 if row is None else int(row["n"])

    def close(self) -> None:
        with self._lock:
            self._conn.close()


_cache: Cache | None = None


def get_cache() -> Cache:
    global _cache
    if _cache is None:
        _cache = Cache(get_settings().cache_db_path)
    return _cache
