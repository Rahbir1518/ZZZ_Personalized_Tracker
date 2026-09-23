"""Transport selection and the primp-backed fetch path.

No network here — the point is that selection and error handling behave, not
that prydwen.gg is up.
"""

from __future__ import annotations

import primp
import pytest

from zzz_sidecar.prydwen.source import PrydwenUnavailable
from zzz_sidecar.prydwen.transport import HttpxTransport, PrimpTransport, build_transport

# -- selection ---------------------------------------------------------------- #


def test_explicit_httpx_is_honoured():
    assert isinstance(build_transport("httpx"), HttpxTransport)


def test_auto_uses_primp():
    assert isinstance(build_transport("auto"), PrimpTransport)


def test_asking_for_primp_explicitly_also_works():
    assert isinstance(build_transport("primp"), PrimpTransport)


# -- primp client behaviour ---------------------------------------------------- #


class _FakeResponse:
    def __init__(self, text: str = "", status_code: int = 200) -> None:
        self.text = text
        self.status_code = status_code


class _FakeAsyncClient:
    """Stands in for primp.AsyncClient so no network call happens."""

    def __init__(self, response: _FakeResponse | None = None, error: Exception | None = None):
        self._response = response
        self._error = error
        self.requested_url: str | None = None

    async def get(self, url: str) -> _FakeResponse:
        self.requested_url = url
        if self._error is not None:
            raise self._error
        assert self._response is not None
        return self._response


def _transport_with(fake_client: _FakeAsyncClient) -> PrimpTransport:
    transport = PrimpTransport.__new__(PrimpTransport)
    from zzz_sidecar.prydwen.transport import _RateLimited

    transport._gate = _RateLimited(crawl_delay=0.0)
    transport._client = fake_client
    return transport


async def test_the_right_url_is_requested():
    fake = _FakeAsyncClient(_FakeResponse(text="<html><body>hello</body></html>"))
    transport = _transport_with(fake)

    html = await transport.get_html("/zenless/characters/miyabi")

    assert html == "<html><body>hello</body></html>"
    assert fake.requested_url == "https://www.prydwen.gg/zenless/characters/miyabi"


async def test_a_non_200_status_becomes_prydwen_unavailable():
    fake = _FakeAsyncClient(_FakeResponse(text="nope", status_code=500))
    transport = _transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="HTTP 500"):
        await transport.get_html("/zenless/characters/miyabi")


async def test_a_cloudflare_challenge_is_reported_distinctly():
    fake = _FakeAsyncClient(_FakeResponse(text="just a moment", status_code=403))
    transport = _transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="Cloudflare"):
        await transport.get_html("/zenless/characters/miyabi")


async def test_empty_body_is_treated_as_a_failure():
    fake = _FakeAsyncClient(_FakeResponse(text="   \n", status_code=200))
    transport = _transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="returned nothing"):
        await transport.get_html("/zenless/characters/miyabi")


async def test_a_primp_error_is_reported_not_crashed():
    fake = _FakeAsyncClient(error=primp.ConnectError("boom"))
    transport = _transport_with(fake)

    with pytest.raises(PrydwenUnavailable, match="failed"):
        await transport.get_html("/zenless/characters/miyabi")
