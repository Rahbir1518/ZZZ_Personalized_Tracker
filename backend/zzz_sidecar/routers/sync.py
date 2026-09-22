"""The Sync button's endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from ..deps import get_sync
from ..models import SyncStatus
from ..services.sync import SyncService

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("", response_model=SyncStatus)
async def start_sync(
    force: bool = False,
    sync: SyncService = Depends(get_sync),
) -> SyncStatus:
    """Start a run. Single-flight: if one is already going, its status is
    returned unchanged rather than starting a second.

    ``force=true`` re-fetches every Prydwen guide even when cached and fresh.
    """
    return await sync.start(force_guides=force)


@router.get("/status", response_model=SyncStatus)
async def sync_status(sync: SyncService = Depends(get_sync)) -> SyncStatus:
    """Per-source progress. The UI polls this while a run is in flight."""
    return sync.status


@router.post("/cancel", response_model=SyncStatus)
async def cancel_sync(sync: SyncService = Depends(get_sync)) -> SyncStatus:
    """Abort the current run; a cold Prydwen pass takes minutes."""
    return sync.cancel()
