"""Token gate and CORS.

These two interact, and getting it wrong is silent and total: the renderer is a
different origin from the sidecar (``http://localhost:5173`` in dev, ``file://``
once packaged), so the ``X-Sidecar-Token`` header triggers a preflight. If the
preflight is rejected, every single request fails in the browser with an opaque
network error and the app looks completely dead.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from zzz_sidecar.config import configure

TOKEN = "test-token"
PREFLIGHT_HEADERS = {
    "Access-Control-Request-Method": "POST",
    "Access-Control-Request-Headers": "x-sidecar-token,content-type",
}


@pytest.fixture
def client() -> TestClient:
    configure(port=8999, token=TOKEN, data_dir=Path(tempfile.mkdtemp()))
    from zzz_sidecar.app import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


# -- token gate ------------------------------------------------------------- #


def test_health_needs_no_token_so_the_supervisor_can_poll(client: TestClient):
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_a_request_without_the_token_is_refused(client: TestClient):
    response = client.get("/agents")
    assert response.status_code == 401
    assert response.json()["code"] == "BAD_TOKEN"


def test_a_request_with_the_wrong_token_is_refused(client: TestClient):
    response = client.get("/agents", headers={"X-Sidecar-Token": "not-it"})
    assert response.status_code == 401


def test_a_request_with_the_token_is_allowed(client: TestClient):
    assert client.get("/agents", headers={"X-Sidecar-Token": TOKEN}).status_code == 200


# -- CORS ------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "origin",
    [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173",
        "null",  # what a file:// renderer sends once packaged
    ],
)
def test_preflight_succeeds_for_every_origin_the_renderer_can_have(
    client: TestClient, origin: str
):
    response = client.options(
        "/auth/login", headers={"Origin": origin, **PREFLIGHT_HEADERS}
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_preflight_is_not_blocked_by_the_token_gate(client: TestClient):
    # A preflight cannot carry custom headers, so it can never present a token.
    response = client.options(
        "/agents",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "x-sidecar-token",
        },
    )
    assert response.status_code == 200


def test_an_offsite_origin_is_rejected(client: TestClient):
    response = client.options(
        "/auth/login", headers={"Origin": "https://evil.example.com", **PREFLIGHT_HEADERS}
    )
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_cors_does_not_weaken_the_token_gate(client: TestClient):
    # An allowed origin still has to present the token for a real request.
    response = client.get("/agents", headers={"Origin": "http://localhost:5173"})
    assert response.status_code == 401
    assert response.json()["code"] == "BAD_TOKEN"
