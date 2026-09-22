"""FastAPI app factory.

Hardening for a locally-spawned service:

* Bound to 127.0.0.1 only (see ``__main__``), on an ephemeral port the Electron
  main process picks and passes to the renderer.
* Every request must carry the per-run ``X-Sidecar-Token``, so another process
  on the same machine cannot drive the user's HoYoLAB session by guessing the
  port.
* CORS is not opened up; the renderer talks to us from a file:// or Vite dev
  origin and sends the token explicitly.
"""

from __future__ import annotations

import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import get_settings
from .deps import get_sync
from .routers import auth, health, roster, sync, teams

#: Reachable without a token, so the supervisor can poll before handing the
#: token to the renderer.
_OPEN_PATHS = frozenset({"/health", "/docs", "/openapi.json", "/redoc"})


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    # Render last session's data immediately instead of an empty grid.
    get_sync().load_from_cache()
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="ZZZ Team Tracker sidecar",
        version="0.1.0",
        docs_url="/docs",
        lifespan=_lifespan,
    )

    @app.middleware("http")
    async def require_token(
        request: Request,
        call_next: Callable[[Request], Awaitable[JSONResponse]],
    ) -> JSONResponse:
        expected = get_settings().token
        if expected and request.url.path not in _OPEN_PATHS:
            provided = request.headers.get("X-Sidecar-Token", "")
            # Constant-time compare: the token is a session secret.
            if not secrets.compare_digest(provided, expected):
                return JSONResponse(
                    status_code=401,
                    content={"code": "BAD_TOKEN", "message": "Missing or invalid sidecar token."},
                )
        return await call_next(request)

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(sync.router)
    app.include_router(roster.router)
    app.include_router(teams.router)

    return app
