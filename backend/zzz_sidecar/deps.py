"""Shared singletons.

The sidecar serves exactly one desktop user in one process, so plain
module-level instances are the honest choice here — no DI container, no
per-request session.
"""

from __future__ import annotations

from .services.hoyolab import HoyolabService
from .services.sync import SyncService

_hoyolab = HoyolabService()
_sync = SyncService(_hoyolab)


def get_hoyolab() -> HoyolabService:
    return _hoyolab


def get_sync() -> SyncService:
    return _sync
