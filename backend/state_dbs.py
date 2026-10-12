"""Shared discovery/opening of Hermes state.dbs (root + sub-profiles).

WI-7 first walked these for session visibility (``sessions._state_db_files``);
WI-9 (M5-01/M5-05) needs the same universe for analytics. The walk lives here
so no module re-implements it (M5-05 coordination: shared helper, not more
copies of the ``os.path.exists`` pattern).

Contract:
- The root db is labelled ``'default'``; each sub-profile contributes its
  directory name.
- A profile is *live* only when BOTH ``config.yaml`` and ``state.db`` exist in
  its directory (orphan dirs after profile deletion stay out — consistent with
  ``get_profiles`` / efa44da).
- The profiles dir is DERIVED from the root STATE_DB location
  (``<root>/profiles/*``) so test sandboxes stay isolated without extra
  monkeypatching.
"""

import os

import aiosqlite

from backend.config import settings

STATE_DB = os.path.join(settings.AGENTOS_DATA_DIR, "state.db")


def state_db_files(root_state_db: str | None = None) -> list[tuple[str, str]]:
    """Return ``[(owner_label, path), ...]`` — root ('default') + sub-profiles.

    *root_state_db* defaults to the module-level ``STATE_DB``. Callers that
    keep their own module global (``sessions.STATE_DB``) pass it explicitly —
    tests monkeypatch that seam and it must keep working.

    Deterministic order (root first, profiles sorted) so aggregate ties break
    the same way on every call.
    """
    root = root_state_db if root_state_db is not None else STATE_DB
    out: list[tuple[str, str]] = [("default", root)]
    prof_root = os.path.join(os.path.dirname(root), "profiles")
    if os.path.isdir(prof_root):
        for pid in sorted(os.listdir(prof_root)):
            cfg = os.path.join(prof_root, pid, "config.yaml")
            db = os.path.join(prof_root, pid, "state.db")
            if os.path.isfile(cfg) and os.path.isfile(db):
                out.append((pid, db))
    return out


async def open_ro(path: str) -> aiosqlite.Connection:
    """Open a state.db READ-ONLY.

    ``mode=ro`` is deliberate (M5-05): a plain connect auto-creates a phantom
    empty db when the file is missing and read paths must never write to the
    live store. Callers own the connection lifecycle (use ``async with``).
    """
    return await aiosqlite.connect(f"file:{path}?mode=ro", uri=True)
