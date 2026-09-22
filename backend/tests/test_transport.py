"""Transport selection and the webclaw subprocess wrapper.

No network here — the point is that discovery, selection and error handling
behave, not that prydwen.gg is up.
"""

from __future__ import annotations

import pytest

from zzz_sidecar.prydwen.source import PrydwenUnavailable
from zzz_sidecar.prydwen.transport import (
    HttpxTransport,
    WebclawTransport,
    build_transport,
    find_webclaw,
)


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    monkeypatch.delenv("WEBCLAW_BIN", raising=False)


# -- discovery -------------------------------------------------------------- #


def test_webclaw_bin_override_is_used_when_it_points_at_a_real_file(monkeypatch, tmp_path):
    binary = tmp_path / "webclaw.exe"
    binary.write_text("", encoding="utf-8")
    monkeypatch.setenv("WEBCLAW_BIN", str(binary))
    assert find_webclaw() == str(binary)


def test_a_dangling_webclaw_bin_override_is_not_silently_ignored(monkeypatch, tmp_path):
    # Falling back to PATH here would be worse: the user set an override and
    # deserves to be told it is wrong, not to have it quietly bypassed.
    monkeypatch.setenv("WEBCLAW_BIN", str(tmp_path / "nope.exe"))
    assert find_webclaw() is None


def test_discovery_falls_back_to_path(monkeypatch):
    monkeypatch.setattr(
        "zzz_sidecar.prydwen.transport.shutil.which",
        lambda name: "/usr/bin/webclaw" if name == "webclaw" else None,
    )
    assert find_webclaw() == "/usr/bin/webclaw"


# -- selection -------------------------------------------------------------- #


def test_explicit_httpx_is_honoured_even_when_webclaw_exists(monkeypatch):
    monkeypatch.setattr("zzz_sidecar.prydwen.transport.find_webclaw", lambda: "/usr/bin/webclaw")
    assert isinstance(build_transport("httpx"), HttpxTransport)


def test_auto_prefers_webclaw_when_installed(monkeypatch):
    monkeypatch.setattr("zzz_sidecar.prydwen.transport.find_webclaw", lambda: "/usr/bin/webclaw")
    assert isinstance(build_transport("auto"), WebclawTransport)


def test_auto_falls_back_to_httpx_so_the_app_still_runs(monkeypatch):
    monkeypatch.setattr("zzz_sidecar.prydwen.transport.find_webclaw", lambda: None)
    assert isinstance(build_transport("auto"), HttpxTransport)


def test_asking_for_webclaw_without_it_installed_says_so(monkeypatch):
    monkeypatch.setattr("zzz_sidecar.prydwen.transport.find_webclaw", lambda: None)
    with pytest.raises(PrydwenUnavailable, match="webclaw was not found"):
        build_transport("webclaw")


# -- subprocess behaviour --------------------------------------------------- #


class _FakeProcess:
    """Stands in for the spawned webclaw process."""

    def __init__(self, stdout: bytes = b"", stderr: bytes = b"", returncode: int = 0) -> None:
        self._stdout = stdout
        self._stderr = stderr
        self.returncode = returncode
        self.killed = False

    async def communicate(self) -> tuple[bytes, bytes]:
        return self._stdout, self._stderr

    def kill(self) -> None:
        self.killed = True


@pytest.fixture
def spawned(monkeypatch):
    """Capture the argv WebclawTransport builds, and control the result."""
    captured: dict[str, object] = {}
    process = _FakeProcess()

    async def fake_exec(*args, **kwargs):
        captured["argv"] = list(args)
        return captured["process"]

    captured["process"] = process
    monkeypatch.setattr(
        "zzz_sidecar.prydwen.transport.asyncio.create_subprocess_exec", fake_exec
    )
    return captured


async def test_the_right_url_and_flags_are_passed_to_webclaw(spawned):
    spawned["process"] = _FakeProcess(stdout=b"<html><body>hello</body></html>")
    transport = WebclawTransport(binary="/bin/webclaw")

    html = await transport.get_html("/zenless/characters/miyabi")

    assert html == "<html><body>hello</body></html>"
    argv = spawned["argv"]
    assert argv[0] == "/bin/webclaw"
    assert argv[1] == "https://www.prydwen.gg/zenless/characters/miyabi"
    # HTML, not markdown — the parser needs the real DOM.
    assert "--format" in argv and argv[argv.index("--format") + 1] == "html"


async def test_a_nonzero_exit_becomes_prydwen_unavailable(spawned):
    spawned["process"] = _FakeProcess(stderr=b"boom", returncode=3)
    transport = WebclawTransport(binary="/bin/webclaw")

    with pytest.raises(PrydwenUnavailable, match="exited 3"):
        await transport.get_html("/zenless/characters/miyabi")


async def test_empty_output_is_treated_as_a_failure(spawned):
    # webclaw exits 0 even for a page it could not fetch, so empty stdout is
    # the only transport-level signal that something went wrong.
    spawned["process"] = _FakeProcess(stdout=b"   \n", returncode=0)
    transport = WebclawTransport(binary="/bin/webclaw")

    with pytest.raises(PrydwenUnavailable, match="returned nothing"):
        await transport.get_html("/zenless/characters/miyabi")


async def test_a_missing_binary_is_reported_not_crashed():
    transport = WebclawTransport(binary="/definitely/not/a/real/binary")
    with pytest.raises(PrydwenUnavailable):
        await transport.get_html("/zenless/characters/anyone")
