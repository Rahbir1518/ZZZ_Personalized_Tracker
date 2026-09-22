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
            self._conn.executescript(_SCHEMA)
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

    # -- account ------------------------------------------------------------ #

    def put_roster(self, uid: str, payload: dict[str, Any]) -> None:
        self._write(
            "INSERT OR REPLACE INTO roster_snapshot (uid, payload, fetched_at) VALUES (?, ?, ?)",
            (uid, json.dumps(payload), time.time()),
        )

    def get_roster(self, uid: str) -> dict[str, Any] | None:
        row = self._read_one("SELECT payload FROM roster_snapshot WHERE uid = ?", (uid,))
        return None if row is None else json.loads(row["payload"])

    def put_build(self, uid: str, agent_id: int, payload: dict[str, Any]) -> None:
        self._write(
            "INSERT OR REPLACE INTO agent_build (uid, agent_id, payload, fetched_at) "
            "VALUES (?, ?, ?, ?)",
            (uid, agent_id, json.dumps(payload), time.time()),
        )

    def get_builds(self, uid: str) -> dict[int, dict[str, Any]]:
        rows = self._read_all("SELECT agent_id, payload FROM agent_build WHERE uid = ?", (uid,))
        return {int(r["agent_id"]): json.loads(r["payload"]) for r in rows}

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

    def record_sync_run(self, run_id: str) -> None:
        self._write(
            "INSERT OR REPLACE INTO sync_run (run_id, started_at, day) VALUES (?, ?, ?)",
            (run_id, time.time(), self._today()),
        )

    def syncs_today(self) -> int:
        row = self._read_one(
            "SELECT COUNT(*) AS n FROM sync_run WHERE day = ?", (self._today(),)
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
