"""Exit when the Electron app that spawned us goes away.

Electron stops the sidecar on a normal quit, but that code never runs if the
app crashes, is ended from Task Manager, or Windows kills it. Without this the
server would be orphaned: still holding its port, the cache database, and a
lock on zzz-sidecar.exe (which blocks the next install or update).

On Windows this waits on a handle to the parent process, so it wakes the
moment the parent exits — no polling, and no chance of PID reuse fooling it,
because the handle refers to that exact process. Elsewhere it polls.
"""

from __future__ import annotations

import os
import sys
import threading
import time


def _wait_windows(pid: int) -> None:
    import ctypes
    from ctypes import wintypes

    synchronize = 0x00100000
    infinite = 0xFFFFFFFF

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.OpenProcess.restype = wintypes.HANDLE
    kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    kernel32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)

    handle = kernel32.OpenProcess(synchronize, False, pid)
    if not handle:
        # Already gone (or never existed): nothing to serve.
        return
    kernel32.WaitForSingleObject(handle, infinite)


def _wait_posix(pid: int) -> None:
    while True:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        except PermissionError:
            pass  # exists, just not ours to signal
        time.sleep(2)


def exit_with_parent(pid: int) -> None:
    """Start a daemon thread that ends this process once ``pid`` exits."""

    def watch() -> None:
        (_wait_windows if sys.platform == "win32" else _wait_posix)(pid)
        # os._exit, not sys.exit: this runs off the main thread, and the point
        # is to go now, not after uvicorn's graceful shutdown waits on requests
        # that nobody is left to read.
        os._exit(0)

    threading.Thread(target=watch, name="parent-watchdog", daemon=True).start()
