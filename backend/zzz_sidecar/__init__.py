"""Local sidecar service for ZZZ Team Tracker.

Owns all networking (HoYoLAB, hakushin, Prydwen), the SQLite cache, and the
join/analysis layer. Binds to loopback only and is spawned by the Electron main
process with a per-run auth token.
"""

__version__ = "0.1.0"
