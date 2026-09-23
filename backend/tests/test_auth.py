"""Logout's effect on the in-memory roster."""

from __future__ import annotations

import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from zzz_sidecar.config import configure
from zzz_sidecar.models import Agent, Analysis

TOKEN = "test-token"
HEADERS = {"X-Sidecar-Token": TOKEN}


@pytest.fixture
def client() -> TestClient:
    configure(port=8999, token=TOKEN, data_dir=Path(tempfile.mkdtemp()))
    from zzz_sidecar.app import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def test_logout_clears_the_roster_so_a_new_account_starts_from_nothing(
    client: TestClient,
) -> None:
    """Without this, signing back in as someone else would show the outgoing
    account's roster until the next sync finished — their agents, under the
    new account's name."""
    from zzz_sidecar.deps import get_sync

    sync = get_sync()
    sync._agents = [Agent(id=1, name="Miyabi", owned=True)]  # noqa: SLF001
    sync._analysis = Analysis(build_gaps=[])  # noqa: SLF001

    response = client.post("/auth/logout", headers=HEADERS)

    assert response.status_code == 200
    assert sync.agents == []
