"""How guide HTML is actually fetched.

Separated from parsing on purpose: the parser is stable and tested, while the
transport is the part that upstream defences keep breaking.

**Why two transports.** As of 2026-09-21 prydwen.gg sits behind a Cloudflare
managed challenge. Plain `httpx` gets HTTP 403 with `cf-mitigated: challenge` on
every path, on the very first request, regardless of headers or HTTP version —
the check is on the TLS/client fingerprint, not on request volume.

`PrimpTransport` fetches through `primp`, which requests using a browser TLS
profile and therefore passes. Be clear-eyed about what that means: it works by
*impersonating Chrome*, which is circumventing an anti-bot control the site
owner deliberately enabled. That was an explicit project decision, not a
default. `HttpxTransport` is kept as the honest, non-impersonating option.

**Being conservative about what gets requested.** This module is the final
safety boundary for two separate site rules, enforced regardless of what a
caller passes in:

- Prydwen's `robots.txt` (`User-agent: *`) allows `/` broadly but disallows
  `/admin/`, `/api/` (except `/api/fa-icon/`, which this adapter never needs
  and so never requests), `/auth/`, `/api/honeypot-trap`, `/playwire-preview`
  and `/news`, and sets `Crawl-delay: 10`. This module does not attempt to
  reproduce that whole rule set — instead `_validate_prydwen_url` allowlists
  the exact two paths the adapter needs (`/zenless/characters` and
  `/zenless/characters/<slug>`), which is a strict subset of what robots.txt
  permits and structurally cannot reach any of its disallowed paths, before
  *and after* redirects.
- `_GATE`, a single process-wide instance of `_RateLimited`, enforces the 10s
  crawl delay across every request from every transport and every
  `HtmlPrydwenSource`/sync run in this process — not per transport instance,
  which used to let a freshly constructed transport start a new 10s countdown
  from zero regardless of when the previous request actually happened.

None of this is a claim that Prydwen has authorised this traffic — robots.txt
compliance and permission are different things. It only means the adapter
stays inside a narrow, explicitly-allowed request surface and paces itself the
way robots.txt asks any crawler to.

Previously this went through **webclaw**, a separate AGPL-3.0 CLI shelled out
to as its own process specifically so the AGPL boundary stayed at "separate
process, never linked, not bundled." `primp` is MIT-licensed and a normal pip
dependency — an in-process Python HTTP client with the same TLS-impersonation
approach, so that whole separate-process/licensing dance is no longer needed.
"""

from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Awaitable, Callable
from typing import Protocol
from urllib.parse import urlsplit

import httpx
import primp

from ..config import PRYDWEN_CRAWL_DELAY_SECONDS, USER_AGENT
from .source import PrydwenUnavailable

BASE_URL = "https://www.prydwen.gg"

#: Browser profile primp presents. Chrome is the most common client on the
#: open web and the least likely to be singled out.
PRIMP_IMPERSONATE = "chrome"

#: Per-request ceiling handed to primp, in seconds.
PRIMP_TIMEOUT = 45.0

# -- request-surface allowlist ------------------------------------------------ #

#: The only host this adapter is ever allowed to talk to.
_ALLOWED_HOST = "www.prydwen.gg"

#: The adapter's entire request surface: the character index, and one guide
#: page per slug (the same `[a-z0-9][a-z0-9-]*` shape `html_adapter._SLUG_RE`
#: extracts). Deliberately an allowlist, not a denylist mirroring robots.txt's
#: `Disallow` lines — an unrecognised path is refused by default rather than
#: permitted because it wasn't explicitly listed as disallowed.
_ALLOWED_PATH_RE = re.compile(r"^/zenless/characters(?:/[a-z0-9][a-z0-9-]*)?$")


def _validate_prydwen_url(url: str, *, context: str) -> None:
    """Refuse any URL outside the adapter's declared request surface.

    Called on the URL about to be requested *and* again on the final URL a
    response reports after following redirects — a redirect landing outside
    the allowlist is refused the same as a directly-requested one would be.
    Never rewrites a disallowed URL into an allowed one; refusal is the only
    outcome.
    """
    parsed = urlsplit(url)
    if parsed.scheme != "https" or parsed.netloc != _ALLOWED_HOST:
        raise PrydwenUnavailable(f"Refusing to {context} outside {_ALLOWED_HOST}: {url}")
    if parsed.query or parsed.fragment:
        raise PrydwenUnavailable(f"Refusing to {context} a URL with a query or fragment: {url}")
    if not _ALLOWED_PATH_RE.fullmatch(parsed.path):
        raise PrydwenUnavailable(f"Refusing to {context} a disallowed path: {url}")


class Transport(Protocol):
    """Fetch one page of HTML, given a site-relative path."""

    async def get_html(self, path: str) -> str: ...

    async def aclose(self) -> None: ...


class _RateLimited:
    """Crawl-delay gate: one request at a time, `crawl_delay` seconds apart.

    `clock`/`sleep` are injectable so tests can drive this deterministically
    with a fake clock instead of actually sleeping 10s per assertion;
    production code always uses the real `time.monotonic`/`asyncio.sleep`.

    The lock is held for the *entire* wait-then-request window, not just
    released after an independent `sleep` — two callers racing in do not both
    compute "elapsed" against the same stale timestamp and both decide it's
    safe to go; the second one only starts computing its own wait once the
    first has fully finished (see `__aexit__`) and stamped the new
    `_last_request_at`.
    """

    def __init__(
        self,
        crawl_delay: float = PRYDWEN_CRAWL_DELAY_SECONDS,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._crawl_delay = crawl_delay
        self._lock = asyncio.Lock()
        self._last_request_at = 0.0
        self._clock = clock
        self._sleep = sleep

    async def __aenter__(self) -> None:
        await self._lock.acquire()
        elapsed = self._clock() - self._last_request_at
        if self._last_request_at > 0.0 and elapsed < self._crawl_delay:
            await self._sleep(self._crawl_delay - elapsed)

    async def __aexit__(self, *_exc: object) -> None:
        # Runs whether the request in the `with` block succeeded or raised —
        # a failed request is still a request the server had to handle, and
        # still counts toward the delay before the next one.
        self._last_request_at = self._clock()
        self._lock.release()


#: One process-wide gate, shared by every transport instance and every
#: `HtmlPrydwenSource`/sync run — not one gate per transport. A new sync
#: creating a new `HtmlPrydwenSource` (and therefore a new transport) used to
#: reset the 10s countdown to zero; sharing this single instance means only
#: real elapsed wall-clock time since the last actual request matters, no
#: matter how many transports get constructed and discarded around it.
_GATE = _RateLimited()


class PrimpTransport:
    """Fetch via `primp`'s browser-impersonating client, in-process.

    Note on the User-Agent: passing a custom `User-Agent` header alongside
    `impersonate=` was tried and verified live (a request to an echo endpoint
    showed the header actually sent on the wire) to have no effect — primp's
    Chrome impersonation profile sends its own internally consistent browser
    fingerprint (User-Agent plus the matching `Sec-Ch-Ua`/`Sec-Fetch-*`
    headers) and silently ignores a header override for it. So this transport
    does not attempt to set one; see `USER_AGENT`'s docstring in config.py for
    what that constant actually applies to.
    """

    def __init__(self) -> None:
        self._client = primp.AsyncClient(
            impersonate=PRIMP_IMPERSONATE,
            timeout=PRIMP_TIMEOUT,
        )

    async def get_html(self, path: str) -> str:
        url = f"{BASE_URL}{path}"
        _validate_prydwen_url(url, context="request")

        async with _GATE:
            try:
                response = await self._client.get(url)
            except primp.PrimpError as exc:
                raise PrydwenUnavailable(f"GET {path} failed: {exc}") from exc

        # response.url is the final URL after primp's own redirect handling -
        # verified against a live redirecting endpoint, not assumed.
        _validate_prydwen_url(response.url, context="follow a redirect to")

        if response.status_code == 403:
            raise PrydwenUnavailable(
                f"Cloudflare challenged the request for {path} even through primp. "
                "The impersonation profile may need updating — see transport.py."
            )
        if response.status_code != 200:
            raise PrydwenUnavailable(f"GET {path} returned HTTP {response.status_code}")

        html = response.text
        if not html.strip():
            raise PrydwenUnavailable(f"primp returned nothing for {path}")
        return html

    async def aclose(self) -> None:
        return None


class HttpxTransport:
    """Plain HTTP with an honest, identifying User-Agent.

    Currently blocked by Cloudflare on prydwen.gg (see the module docstring).
    Kept because it is the correct transport for any host that does not
    challenge, and so the impersonating path stays an explicit opt-in. Unlike
    `PrimpTransport`, this one's `User-Agent` header is genuinely sent as
    configured — no impersonation profile overrides it.
    """

    def __init__(self) -> None:
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
        url = f"{BASE_URL}{path}"
        _validate_prydwen_url(url, context="request")

        async with _GATE:
            try:
                response = await self._client.get(path)
            except httpx.HTTPError as exc:
                raise PrydwenUnavailable(f"GET {path} failed: {exc}") from exc

        # response.url is httpx's own final-URL-after-redirects object.
        _validate_prydwen_url(str(response.url), context="follow a redirect to")

        if response.status_code == 403 and "challenge" in response.headers.get(
            "cf-mitigated", ""
        ):
            raise PrydwenUnavailable(
                f"Cloudflare challenged the request for {path}. "
                "Switch the transport to primp (see the README)."
            )
        if response.status_code != 200:
            raise PrydwenUnavailable(f"GET {path} returned HTTP {response.status_code}")
        return response.text

    async def aclose(self) -> None:
        await self._client.aclose()


def build_transport(preference: str = "auto") -> Transport:
    """Pick a transport.

    ``auto`` (the default) and ``primp`` both use the browser-impersonating
    client — it is a normal pip dependency now, not something that may or may
    not be installed, so there is nothing left to detect. ``httpx`` is the
    explicit opt-out into the honest, non-impersonating path, which currently
    means eating the Cloudflare block.
    """
    if preference == "httpx":
        return HttpxTransport()
    return PrimpTransport()
