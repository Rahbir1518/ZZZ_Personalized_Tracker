"""PyInstaller entry point.

Points PyInstaller at this script (which lives outside the `zzz_sidecar`
package, in `backend/`) instead of directly at `zzz_sidecar/__main__.py`.
Pointing PyInstaller at the package's own `__main__.py` makes it execute that
file as a parentless top-level script, which breaks every relative import
inside the package (`from .config import configure`, etc.) with
"ImportError: attempted relative import with no known parent package" - the
built binary would `--help` and print nothing but that traceback. Running
`zzz_sidecar.__main__` as a real package import here instead keeps its
internals untouched and working exactly as `python -m zzz_sidecar` already
does in dev.
"""

from __future__ import annotations

import sys

from zzz_sidecar.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
