"""FastAPI app factory.

Hardening for a locally-spawned service:

* Bound to 127.0.0.1 only (see ``__main__``), on an ephemeral port the Electron
  main process picks and passes to the renderer.
* Every request must carry the per-run ``X-Sidecar-Token``, so another process
  on the same machine cannot drive the user's HoYoLAB session by guessing the
  port.
* CORS is opened to loopback origins only. The renderer is genuinely a different
  origin from the sidecar — ``http://localhost:5173`` in dev, ``file://`` (which
  sends ``Origin: null``) once packaged — so sending ``X-Sidecar-Token``
  triggers a preflight that has to be answered or every request fails. The token
  remains the actual access control; CORS just stops the browser refusing to
  make the call in the first place.
"""

from __future__ import annotations

import secrets
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .deps import get_sync
from .routers import auth, codex, health, pulls, roster, sync, teams

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
        # A CORS preflight cannot carry custom headers, so it can never present
        # the token. Rejecting it here would fail every real request behind it.
        is_preflight = request.method == "OPTIONS"
        if expected and not is_preflight and request.url.path not in _OPEN_PATHS:
            provided = request.headers.get("X-Sidecar-Token", "")
            # Constant-time compare: the token is a session secret.
            if not secrets.compare_digest(provided, expected):
                return JSONResponse(
                    status_code=401,
                    content={"code": "BAD_TOKEN", "message": "Missing or invalid sidecar token."},
                )
        return await call_next(request)

    # Added after the token middleware so it sits *outside* it and can answer a
    # preflight on its own. Origins are loopback-only; "null" is what a
    # file://-loaded renderer sends once the app is packaged.
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|null|file://)$",
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["X-Sidecar-Token", "Content-Type"],
        # No cookies are used; the token header is the credential.
        allow_credentials=False,
        max_age=3600,
    )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(sync.router)
    app.include_router(roster.router)
    app.include_router(teams.router)
    app.include_router(codex.router)
    app.include_router(pulls.router)

    return app
