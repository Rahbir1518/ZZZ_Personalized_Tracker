"""Make the tests runnable from anywhere.

``npm run sidecar:test`` invokes pytest from the repo root, while running
pytest by hand usually happens inside ``backend/``. Putting the package root on
sys.path here means both work without an editable install.
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parent.parent

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
