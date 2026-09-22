"""How guide HTML is actually fetched.

Separated from parsing on purpose: the parser is stable and tested, while the
transport is the part that upstream defences keep breaking.

**Why two transports.** As of 2026-09-21 prydwen.gg sits behind a Cloudflare
managed challenge. Plain `httpx` gets HTTP 403 with `cf-mitigated: challenge` on
every path, on the very first request, regardless of headers or HTTP version —
the check is on the TLS/client fingerprint, not on request volume.

`WebclawTransport` shells out to **webclaw**, which fetches using a browser TLS
profile and therefore passes. Be clear-eyed about what that means: it works by
*impersonating Chrome*, which is circumventing an anti-bot control the site
owner deliberately enabled. That was an explicit project decision, not a default.
`HttpxTransport` is kept as the honest, non-impersonating option.

To stay a light consumer either way, requests are serialized behind a lock with
the robots.txt `Crawl-delay: 10` enforced between them, and the app caps full
syncs per day.

> **Licensing:** webclaw is **AGPL-3.0**; this project is MIT. It is invoked as
> a **separate process**, never linked, so it does not make this codebase a
> derivative work. The binary is **not bundled** — the user installs it
> themselves and the app discovers it. See the README before changing that.
"""

from __future__ import annotations

import asyncio
import os
import shutil
import time
from pathlib import Path
from typing import Protocol

import httpx

from ..config import PRYDWEN_CRAWL_DELAY_SECONDS, USER_AGENT
from .source import PrydwenUnavailable

BASE_URL = "https://www.prydwen.gg"

#: Browser profile webclaw presents. Chrome is its default and the most likely
#: to be accepted.
WEBCLAW_BROWSER = "chrome"

#: Per-request ceiling handed to webclaw, in seconds.
WEBCLAW_TIMEOUT = 45


class Transport(Protocol):
    """Fetch one page of HTML, given a site-relative path."""

    async def get_html(self, path: str) -> str: ...

    async def aclose(self) -> None: ...


class _RateLimited:
    """Shared crawl-delay gate: one request at a time, 10s between them."""

    def __init__(self, crawl_delay: float = PRYDWEN_CRAWL_DELAY_SECONDS) -> None:
        self._crawl_delay = crawl_delay
        self._lock = asyncio.Lock()
        self._last_request_at = 0.0

    async def __aenter__(self) -> None:
        await self._lock.acquire()
        elapsed = time.monotonic() - self._last_request_at
        if self._last_request_at > 0.0 and elapsed < self._crawl_delay:
            await asyncio.sleep(self._crawl_delay - elapsed)

    async def __aexit__(self, *_exc: object) -> None:
        self._last_request_at = time.monotonic()
        self._lock.release()


#: Repo-local drop spot for the binary: <repo>/tools/. Gitignored, so placing a
#: copy here is a convenience for the person running the app, not redistribution.
_LOCAL_TOOLS_DIR = Path(__file__).resolve().parents[3] / "tools"


def find_webclaw() -> str | None:
    """Locate a user-installed webclaw binary.

    Checked in order: the ``WEBCLAW_BIN`` override, then PATH, then the repo's
    gitignored ``tools/`` directory.

    A dangling ``WEBCLAW_BIN`` is an error rather than a reason to fall through —
    if someone set an override, silently ignoring it hides the mistake.

    Note this never looks inside the packaged app: webclaw is AGPL-3.0 and is
    not shipped (see the licence note at the top of this module).
    """
    override = os.environ.get("WEBCLAW_BIN", "").strip()
    if override:
        candidate = Path(override)
        return str(candidate) if candidate.is_file() else None

    on_path = shutil.which("webclaw")
    if on_path is not None:
        return on_path

    for name in ("webclaw.exe", "webclaw"):
        local = _LOCAL_TOOLS_DIR / name
        if local.is_file():
            return str(local)
    return None


class WebclawTransport:
    """Fetch via the webclaw CLI, as a separate process."""

    def __init__(self, binary: str | None = None) -> None:
        resolved = binary if binary is not None else find_webclaw()
        if resolved is None:
            raise PrydwenUnavailable(
                "webclaw was not found. Install it and make sure it is on PATH, "
                "or set WEBCLAW_BIN to its full path."
            )
        self._binary = resolved
        self._gate = _RateLimited()

    async def get_html(self, path: str) -> str:
        url = f"{BASE_URL}{path}"

        async with self._gate:
            try:
                process = await asyncio.create_subprocess_exec(
                    self._binary,
                    url,
                    "--format",
                    "html",
                    "--browser",
                    WEBCLAW_BROWSER,
                    "--timeout",
                    str(WEBCLAW_TIMEOUT),
                    # We enforce our own crawl delay between calls, and only
                    # ever pass one URL, so webclaw's internal delay is moot.
                    "--concurrency",
                    "1",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            except OSError as exc:
                raise PrydwenUnavailable(f"Could not run webclaw: {exc}") from exc

            try:
                stdout, stderr = await asyncio.wait_for(
                    process.communicate(), timeout=WEBCLAW_TIMEOUT + 30
                )
            except TimeoutError:
                process.kill()
                raise PrydwenUnavailable(f"webclaw timed out fetching {path}") from None

        if process.returncode != 0:
            detail = stderr.decode("utf-8", "replace").strip()[:300]
            raise PrydwenUnavailable(f"webclaw exited {process.returncode} for {path}: {detail}")

        html = stdout.decode("utf-8", "replace")
        if not html.strip():
            raise PrydwenUnavailable(f"webclaw returned nothing for {path}")

        # webclaw exits 0 even for a 404 page, so emptiness is the only
        # transport-level signal; the parser catches "this is not a guide".
        return html

    async def aclose(self) -> None:
        return None


class HttpxTransport:
    """Plain HTTP with an honest, identifying User-Agent.

    Currently blocked by Cloudflare on prydwen.gg (see the module docstring).
    Kept because it is the correct transport for any host that does not
    challenge, and so the impersonating path stays an explicit opt-in.
    """

    def __init__(self) -> None:
        self._gate = _RateLimited()
        self._client = httpx.AsyncClient(
            base_url=BASE_URL,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=httpx.Timeout(30.0),
            follow_redirects=True,
        )

    async def get_html(self, path: str) -> str:
        async with self._gate:
            try:
                response = await self._client.get(path)
            except httpx.HTTPError as exc:
                raise PrydwenUnavailable(f"GET {path} failed: {exc}") from exc

        if response.status_code == 403 and "challenge" in response.headers.get(
            "cf-mitigated", ""
        ):
            raise PrydwenUnavailable(
                f"Cloudflare challenged the request for {path}. "
                "Install webclaw (see the README) or switch the transport."
            )
        if response.status_code != 200:
            raise PrydwenUnavailable(f"GET {path} returned HTTP {response.status_code}")
        return response.text

    async def aclose(self) -> None:
        await self._client.aclose()


def build_transport(preference: str = "auto") -> Transport:
    """Pick a transport.

    ``auto`` (the default) uses webclaw when it is installed and falls back to
    httpx otherwise, so the app still runs — it just reports the Cloudflare
    block instead of silently returning nothing.
    """
    if preference == "httpx":
        return HttpxTransport()
    if preference == "webclaw":
        return WebclawTransport()

    return WebclawTransport() if find_webclaw() is not None else HttpxTransport()
