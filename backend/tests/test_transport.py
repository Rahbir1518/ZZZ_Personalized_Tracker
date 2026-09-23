"""Transport selection, the URL allowlist, and the process-wide crawl-delay
gate.

No real network here — the point is that selection, URL validation and
rate-limiting behave correctly, not that prydwen.gg is up. The rate-limiter
tests use an injected fake clock/sleep so they run instantly instead of
actually waiting out a 10s delay.
"""

from __future__ import annotations

import httpx
import primp
import pytest

from zzz_sidecar.config import configure
from zzz_sidecar.prydwen.source import PrydwenUnavailable
from zzz_sidecar.prydwen.transport import (
    BrowserWindowTransport,
    HttpxTransport,
    PrimpTransport,
    _RateLimited,
    _validate_prydwen_url,
    build_transport,
)

# -- transport selection ------------------------------------------------------- #


def test_explicit_httpx_is_honoured():
    assert isinstance(build_transport("httpx"), HttpxTransport)


def test_auto_uses_primp():
    assert isinstance(build_transport("auto"), PrimpTransport)


def test_asking_for_primp_explicitly_also_works():
    assert isinstance(build_transport("primp"), PrimpTransport)


def test_explicit_browser_is_honoured(tmp_path):
    configure(
        port=8999,
        token="t",
        data_dir=tmp_path,
        prydwen_transport="browser",
        browser_fetch_origin="http://127.0.0.1:54321",
        browser_fetch_token="secret",
    )
    assert isinstance(build_transport("browser"), BrowserWindowTransport)


def test_no_preference_falls_back_to_the_configured_settings(tmp_path):
    """`HtmlPrydwenSource()`'s real construction site calls `build_transport()`
    with no argument - this is what makes Electron's --prydwen-transport flag
    actually take effect without touching that call site."""
    configure(
        port=8999,
        token="t",
        data_dir=tmp_path,
        prydwen_transport="browser",
        browser_fetch_origin="http://127.0.0.1:54321",
        browser_fetch_token="secret",
    )
    assert isinstance(build_transport(), BrowserWindowTransport)

    configure(port=8999, token="t", data_dir=tmp_path)  # back to the default
    assert isinstance(build_transport(), PrimpTransport)


def test_browser_transport_without_a_configured_endpoint_refuses_to_construct(tmp_path):
    configure(port=8999, token="t", data_dir=tmp_path, prydwen_transport="browser")
    with pytest.raises(PrydwenUnavailable, match="no browser-fetch endpoint"):
        build_transport("browser")


# -- URL allowlist -------------------------------------------------------------- #


@pytest.mark.parametrize(
    "url",
    [
        "https://www.prydwen.gg/zenless/characters",
        "https://www.prydwen.gg/zenless/characters/ellen",
        "https://www.prydwen.gg/zenless/characters/anby-demara",
    ],
)
def test_allowed_urls_pass_validation(url: str):
    _validate_prydwen_url(url, context="request")  # must not raise


@pytest.mark.parametrize(
    "url",
    [
        "https://www.prydwen.gg/api/foo",
        "https://www.prydwen.gg/api/",
        "https://www.prydwen.gg/api/honeypot-trap",
        "https://www.prydwen.gg/admin/foo",
        "https://www.prydwen.gg/admin/",
        "https://www.prydwen.gg/auth/foo",
        "https://www.prydwen.gg/auth/",
        "https://www.prydwen.gg/news",
        "https://www.prydwen.gg/news/foo",
        "https://www.prydwen.gg/playwire-preview",
        "https://www.prydwen.gg/playwire-preview/foo",
        "https://evil.example/zenless/characters/ellen",
        "https://www.prydwen.gg.evil.example/zenless/characters",
        "http://www.prydwen.gg/zenless/characters",  # not https
        "https://www.prydwen.gg/zenless/characters/",  # trailing slash, not a valid slug shape
        "https://www.prydwen.gg/zenless/characters/Ellen",  # uppercase not a valid slug
        "https://www.prydwen.gg/zenless/characters/ellen/../../admin/foo",
        "https://www.prydwen.gg/zenless/characters?x=1",  # query string
        "https://www.prydwen.gg/zenless/characters#frag",  # fragment
        "https://www.prydwen.gg/zenless",
        "https://www.prydwen.gg/",
    ],
)
def test_disallowed_urls_are_rejected(url: str):
    with pytest.raises(PrydwenUnavailable):
        _validate_prydwen_url(url, context="request")


# -- primp / httpx client behaviour --------------------------------------------- #


class _FakeResponse:
    def __init__(self, text: str = "", status_code: int = 200, url: str = "") -> None:
        self.text = text
        self.status_code = status_code
        self.url = url


class _FakeAsyncClient:
    """Stands in for primp.AsyncClient / httpx.AsyncClient so no network
    call happens. Exposes both `.get(url)` (primp shape) and `.get(path)`
    (httpx shape, called against a base_url) equally, since both transports
    just call `.get()` with one positional argument."""

    def __init__(self, response: _FakeResponse | None = None, error: Exception | None = None):
        self._response = response
        self._error = error
        self.requested: str | None = None
        self.call_count = 0

    async def get(self, url_or_path: str) -> _FakeResponse:
        self.requested = url_or_path
        self.call_count += 1
        if self._error is not None:
            raise self._error
        assert self._response is not None
        return self._response


def _primp_transport_with(fake_client: _FakeAsyncClient) -> PrimpTransport:
    transport = PrimpTransport.__new__(PrimpTransport)
    transport._client = fake_client
    return transport


def _httpx_transport_with(fake_client: _FakeAsyncClient) -> HttpxTransport:
    transport = HttpxTransport.__new__(HttpxTransport)
    transport._client = fake_client
    return transport


class _FakePostResponse:
    def __init__(self, payload: dict | None = None, status_code: int = 200, text: str = "") -> None:
        self._payload = payload or {}
        self.status_code = status_code
        self.text = text or str(self._payload)

    def json(self) -> dict:
        return self._payload


class _FakePostClient:
    """Stands in for the httpx client BrowserWindowTransport POSTs the
    fetch request through, so no real Electron endpoint is needed."""

    def __init__(self, response: _FakePostResponse | None = None, error: Exception | None = None):
        self._response = response
        self._error = error
        self.requested_path: str | None = None
        self.call_count = 0

    async def post(self, url: str, *, json: dict) -> _FakePostResponse:
        self.requested_path = json.get("path")
        self.call_count += 1
        if self._error is not None:
            raise self._error
        assert self._response is not None
        return self._response


def _browser_transport_with(fake_client: _FakePostClient) -> BrowserWindowTransport:
    transport = BrowserWindowTransport.__new__(BrowserWindowTransport)
    transport._client = fake_client
    return transport


@pytest.fixture(autouse=True)
def _fresh_gate(monkeypatch):
    """Every test gets its own zero-delay gate, isolated from both the real
    process-wide `_GATE` and from other tests — production code always uses
    the real one (see the rate-limiter tests below for that instance
    directly)."""
    import zzz_sidecar.prydwen.transport as transport_module

    monkeypatch.setattr(transport_module, "_GATE", _RateLimited(crawl_delay=0.0))


async def test_the_right_url_is_requested_via_primp():
    fake = _FakeAsyncClient(
        _FakeResponse(
            text="<html><body>hello</body></html>",
            url="https://www.prydwen.gg/zenless/characters/miyabi",
        )
    )
    transport = _primp_transport_with(fake)

    html = await transport.get_html("/zenless/characters/miyabi")

    assert html == "<html><body>hello</body></html>"
    assert fake.requested == "https://www.prydwen.gg/zenless/characters/miyabi"


async def test_the_right_url_is_requested_via_httpx():
    fake = _FakeAsyncClient(
        _FakeResponse(
            text="<html><body>hello</body></html>",
            url="https://www.prydwen.gg/zenless/characters/miyabi",
        )
    )
    transport = _httpx_transport_with(fake)

    html = await transport.get_html("/zenless/characters/miyabi")

    assert html == "<html><body>hello</body></html>"
    # httpx is called with the relative path against its own base_url.
    assert fake.requested == "/zenless/characters/miyabi"


async def test_a_disallowed_path_is_refused_before_any_request_is_made():
    fake = _FakeAsyncClient(_FakeResponse(text="should never be seen"))
    transport = _primp_transport_with(fake)

    # Not a path the adapter ever legitimately builds, but the transport must
    # not trust its caller either - this is the "final safety boundary".
    with pytest.raises(PrydwenUnavailable):
        await transport.get_html("/api/honeypot-trap")

    assert fake.call_count == 0


async def test_a_non_200_status_becomes_prydwen_unavailable():
    fake = _FakeAsyncClient(
        _FakeResponse(text="nope", status_code=500, url="https://www.prydwen.gg/zenless/characters")
    )
    transport = _primp_transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="HTTP 500"):
        await transport.get_html("/zenless/characters")


async def test_a_cloudflare_challenge_is_reported_distinctly():
    fake = _FakeAsyncClient(
        _FakeResponse(
            text="just a moment", status_code=403, url="https://www.prydwen.gg/zenless/characters"
        )
    )
    transport = _primp_transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="Cloudflare"):
        await transport.get_html("/zenless/characters")


async def test_empty_body_is_treated_as_a_failure():
    fake = _FakeAsyncClient(
        _FakeResponse(text="   \n", status_code=200, url="https://www.prydwen.gg/zenless/characters")
    )
    transport = _primp_transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="returned nothing"):
        await transport.get_html("/zenless/characters")


async def test_a_primp_error_is_reported_not_crashed():
    fake = _FakeAsyncClient(error=primp.ConnectError("boom"))
    transport = _primp_transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="failed"):
        await transport.get_html("/zenless/characters")


# -- BrowserWindowTransport ------------------------------------------------------ #


def test_browser_window_transport_refuses_to_construct_without_endpoint_config():
    with pytest.raises(PrydwenUnavailable, match="no browser-fetch endpoint"):
        BrowserWindowTransport("", "")


async def test_browser_window_transport_posts_the_path_and_returns_the_html():
    fake = _FakePostClient(_FakePostResponse({"html": "<html>real browser</html>"}))
    transport = _browser_transport_with(fake)

    html = await transport.get_html("/zenless/characters/miyabi")

    assert html == "<html>real browser</html>"
    assert fake.requested_path == "/zenless/characters/miyabi"


async def test_browser_window_transport_a_disallowed_path_is_refused_before_any_request():
    fake = _FakePostClient(_FakePostResponse({"html": "should never be seen"}))
    transport = _browser_transport_with(fake)

    with pytest.raises(PrydwenUnavailable):
        await transport.get_html("/api/honeypot-trap")

    assert fake.call_count == 0


async def test_browser_window_transport_a_non_200_becomes_prydwen_unavailable():
    fake = _FakePostClient(_FakePostResponse({}, status_code=500, text="server error"))
    transport = _browser_transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="HTTP 500"):
        await transport.get_html("/zenless/characters")


async def test_browser_window_transport_reports_electrons_own_error_message():
    fake = _FakePostClient(
        _FakePostResponse({"html": "", "error": "Cloudflare challenge was not cleared in time"})
    )
    transport = _browser_transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="Cloudflare challenge was not cleared"):
        await transport.get_html("/zenless/characters")


async def test_browser_window_transport_a_connection_failure_is_reported_not_crashed():
    fake = _FakePostClient(error=httpx.ConnectError("boom"))
    transport = _browser_transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="Could not reach"):
        await transport.get_html("/zenless/characters")


# -- redirect destination validation -------------------------------------------- #


async def test_a_redirect_to_an_allowed_url_is_accepted():
    fake = _FakeAsyncClient(
        _FakeResponse(
            text="<html>ok</html>",
            status_code=200,
            # e.g. Prydwen slug casing/aliasing redirecting to the canonical
            # guide page - still inside the allowlist.
            url="https://www.prydwen.gg/zenless/characters/anby-demara",
        )
    )
    transport = _primp_transport_with(fake)

    html = await transport.get_html("/zenless/characters/anby")
    assert html == "<html>ok</html>"


@pytest.mark.parametrize(
    "redirect_target",
    [
        "https://www.prydwen.gg/api/foo",
        "https://www.prydwen.gg/admin/foo",
        "https://www.prydwen.gg/auth/foo",
        "https://www.prydwen.gg/news/foo",
        "https://www.prydwen.gg/playwire-preview/foo",
        "https://evil.example/zenless/characters",
    ],
)
async def test_a_redirect_to_a_disallowed_destination_is_rejected_via_primp(redirect_target: str):
    fake = _FakeAsyncClient(
        _FakeResponse(
            text="<html>should not be returned</html>", status_code=200, url=redirect_target
        )
    )
    transport = _primp_transport_with(fake)

    with pytest.raises(PrydwenUnavailable):
        await transport.get_html("/zenless/characters/anby")


@pytest.mark.parametrize(
    "redirect_target",
    [
        "https://www.prydwen.gg/api/foo",
        "https://www.prydwen.gg/admin/foo",
        "https://www.prydwen.gg/auth/foo",
        "https://www.prydwen.gg/news/foo",
        "https://www.prydwen.gg/playwire-preview/foo",
        "https://evil.example/zenless/characters",
    ],
)
async def test_a_redirect_to_a_disallowed_destination_is_rejected_via_httpx(redirect_target: str):
    fake = _FakeAsyncClient(
        _FakeResponse(
            text="<html>should not be returned</html>", status_code=200, url=redirect_target
        )
    )
    transport = _httpx_transport_with(fake)

    with pytest.raises(PrydwenUnavailable):
        await transport.get_html("/zenless/characters/anby")


# -- process-wide rate limiter --------------------------------------------------- #


class _FakeClock:
    """A controllable monotonic clock for deterministic rate-limit tests.

    Starts well above zero on purpose: `_RateLimited` treats
    `_last_request_at == 0.0` as its "no previous request yet" sentinel,
    exactly like `time.monotonic()` (which never legitimately returns 0.0) -
    starting a fake clock at 0.0 would collide with that sentinel and make
    the very first stamped timestamp indistinguishable from "never happened".
    """

    def __init__(self, start: float = 1_000.0) -> None:
        self._now = start

    def __call__(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds


class _RecordingSleeper:
    """Fake `asyncio.sleep`: records requested durations and advances the
    fake clock instead of actually waiting, so tests run instantly."""

    def __init__(self, clock: _FakeClock) -> None:
        self._clock = clock
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)
        self._clock.advance(seconds)


def _gated(
    clock: _FakeClock, sleeper: _RecordingSleeper, crawl_delay: float = 10.0
) -> _RateLimited:
    return _RateLimited(crawl_delay=crawl_delay, clock=clock, sleep=sleeper)


async def test_the_first_request_does_not_wait():
    clock = _FakeClock()
    sleeper = _RecordingSleeper(clock)
    gate = _gated(clock, sleeper)

    async with gate:
        pass

    assert sleeper.calls == []


async def test_a_second_request_waits_out_the_remaining_delay():
    clock = _FakeClock()
    sleeper = _RecordingSleeper(clock)
    gate = _gated(clock, sleeper)

    async with gate:
        pass
    clock.advance(3.0)  # only 3s have passed since the first request
    async with gate:
        pass

    assert sleeper.calls == [7.0]  # waited the remaining 10 - 3 = 7s


async def test_a_request_after_the_full_delay_does_not_wait_again():
    clock = _FakeClock()
    sleeper = _RecordingSleeper(clock)
    gate = _gated(clock, sleeper)

    async with gate:
        pass
    clock.advance(10.0)
    async with gate:
        pass

    assert sleeper.calls == []


async def test_two_transport_instances_share_one_gate(monkeypatch):
    """Requirement: PrimpTransport and HttpxTransport - and every
    HtmlPrydwenSource/sync run that constructs a fresh transport - must go
    through the *same* limiter, not one each."""
    import zzz_sidecar.prydwen.transport as transport_module

    clock = _FakeClock()
    sleeper = _RecordingSleeper(clock)
    shared_gate = _gated(clock, sleeper)
    monkeypatch.setattr(transport_module, "_GATE", shared_gate)

    fake_a = _FakeAsyncClient(
        _FakeResponse(text="a", status_code=200, url="https://www.prydwen.gg/zenless/characters")
    )
    fake_b = _FakeAsyncClient(
        _FakeResponse(text="b", status_code=200, url="https://www.prydwen.gg/zenless/characters")
    )
    transport_a = _primp_transport_with(fake_a)
    transport_b = _httpx_transport_with(fake_b)

    await transport_a.get_html("/zenless/characters")
    clock.advance(2.0)
    # A brand new transport instance - simulating a new HtmlPrydwenSource /
    # new sync run - must still see the previous request's timestamp.
    await transport_b.get_html("/zenless/characters")

    assert sleeper.calls == [8.0]  # waited the remaining 10 - 2 = 8s, not 0


async def test_constructing_a_new_gate_like_object_does_not_bypass_the_real_one(monkeypatch):
    """A fresh `_RateLimited()` starts its own countdown from zero - which is
    exactly why production code must never construct one per transport. This
    pins that a *naively* re-instantiated gate (the old, buggy pattern) would
    indeed reset, so the fix is specifically "share one instance", not
    "the class is inherently safe"."""
    clock = _FakeClock()
    sleeper = _RecordingSleeper(clock)

    first_gate = _gated(clock, sleeper)
    async with first_gate:
        pass
    clock.advance(1.0)

    second_gate = _gated(clock, sleeper)  # simulates the old per-instance bug
    async with second_gate:
        pass

    assert sleeper.calls == []  # the bug: a fresh instance never waits


async def test_a_failed_request_still_advances_the_limiter():
    clock = _FakeClock()
    sleeper = _RecordingSleeper(clock)
    gate = _gated(clock, sleeper)

    with pytest.raises(RuntimeError):
        async with gate:
            raise RuntimeError("simulated request failure")

    clock.advance(4.0)
    async with gate:
        pass

    assert sleeper.calls == [6.0]  # still measured from the failed attempt


async def test_concurrent_requests_are_serialized_not_independently_slept():
    """Two callers racing in must not both read the same stale timestamp and
    both decide it's safe to go - the second must wait based on when the
    first *finished*, not when both started."""
    import asyncio

    clock = _FakeClock()
    sleeper = _RecordingSleeper(clock)
    gate = _gated(clock, sleeper)

    order: list[str] = []

    async def worker(name: str) -> None:
        async with gate:
            order.append(f"{name}-start")
            order.append(f"{name}-end")

    await asyncio.gather(worker("a"), worker("b"))

    # Both ran (the lock does not deadlock or drop a caller)...
    assert order == ["a-start", "a-end", "b-start", "b-end"] or order == [
        "b-start",
        "b-end",
        "a-start",
        "a-end",
    ]
    # ...and the second one paid the full crawl delay, proving it computed
    # its wait *after* the first had already stamped `_last_request_at`,
    # rather than both computing "elapsed since 0" concurrently.
    assert sleeper.calls == [10.0]


def test_the_gate_has_no_reset_method():
    """Cancellation/restart in SyncService has no API surface here to call
    even if it wanted to - the gate can only ever be waited on, never reset."""
    gate = _RateLimited()
    public_attrs = [name for name in dir(gate) if not name.startswith("_")]
    assert public_attrs == []
