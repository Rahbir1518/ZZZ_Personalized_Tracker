"""Entry point. Electron spawns this with a port, a token and a data directory.

    python -m zzz_sidecar --port 53124 --token <hex> --data-dir "%APPDATA%/..."

Binds to 127.0.0.1 only: this service holds the user's HoYoLAB session and must
never be reachable from the network.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import uvicorn

from .config import configure


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="zzz_sidecar")
    parser.add_argument("--port", type=int, default=8777)
    parser.add_argument(
        "--token",
        default="",
        help="Shared secret required on every request. Empty disables the check (dev only).",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path.cwd() / ".local",
        help="Where the SQLite cache lives. Electron passes its userData path.",
    )
    parser.add_argument("--reload", action="store_true", help="Dev autoreload.")
    args = parser.parse_args(argv)

    configure(port=args.port, token=args.token, data_dir=args.data_dir)

    uvicorn.run(
        "zzz_sidecar.app:create_app",
        factory=True,
        host="127.0.0.1",
        port=args.port,
        reload=args.reload,
        log_level="info",
        # Access logs would record every request path; keep the noise down and
        # avoid any chance of logging query strings.
        access_log=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
