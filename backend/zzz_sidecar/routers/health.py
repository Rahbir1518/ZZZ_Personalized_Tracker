"""Liveness probe. The Electron main process polls this before opening the
window, so it must answer before anything else is initialised."""

from __future__ import annotations

from fastapi import APIRouter

from .. import __version__

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}
