"""Chat titles from the Hermes session (read side) and renames (write side).

The gateway names each session automatically (``title_source='llm'``); the
AgentOS row only has the first user message as a placeholder. The list view
reads the gateway title READ-ONLY from the profile's ``state.db`` and mirrors
it locally; renames go through the gateway's own API
(``PATCH /api/sessions/{id}``) — never a direct write to ``state.db``, whose
title updates carry provenance ranking, compare-and-swap and a per-db
uniqueness rule that only the gateway enforces.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from backend import chat_usage, state_dbs

logger = logging.getLogger(__name__)

_CHUNK = 400  # stay well under SQLite's bound-parameter limit (2 params per id)


@dataclass(frozen=True)
class GatewayThread:
    head_id: str             # newest gateway session of the thread (rename target)
    title: str | None        # title the Hermes session list shows: COALESCE(tip, root)
    source: str | None       # its title_source: 'llm' | 'derived' | 'user' | None


async def gateway_threads(rows: list[dict]) -> dict[str, GatewayThread]:
    """Map ``chat_sessions.id`` -> gateway thread info, for every row that has one.

    plugin mode: ``sessions.chat_id == hermes_id``; legacy HTTP:
    ``sessions.id == hermes_id``. Missing/locked/old dbs degrade to "no info".
    """
    by_profile: dict[str, list[dict]] = {}
    for row in rows:
        if row.get("hermes_id"):
            by_profile.setdefault(row.get("profile") or "default", []).append(row)

    out: dict[str, GatewayThread] = {}
    for profile, prow in by_profile.items():
        db = chat_usage.state_db_for(profile)
        if not db:
            continue
        local_by_hid = {r["hermes_id"]: r["id"] for r in prow}
        hids = list(local_by_hid)
        try:
            conn = await state_dbs.open_ro(db)
            try:
                cols = {r[1] for r in await conn.execute_fetchall("PRAGMA table_info(sessions)")}
                has_chat = "chat_id" in cols
                has_src = "title_source" in cols
                found: list = []
                for i in range(0, len(hids), _CHUNK):
                    part = hids[i:i + _CHUNK]
                    marks = ",".join("?" * len(part))
                    where = f"id IN ({marks})" + (f" OR chat_id IN ({marks})" if has_chat else "")
                    params = part + (part if has_chat else [])
                    found += await conn.execute_fetchall(
                        f"SELECT id, {'chat_id' if has_chat else 'NULL'}, title, "
                        f"{'title_source' if has_src else 'NULL'}, started_at "
                        f"FROM sessions WHERE {where} ORDER BY started_at ASC",
                        params,
                    )
            finally:
                await conn.close()
        except Exception as exc:
            logger.warning("gateway title read failed (%s): %s", profile, type(exc).__name__)
            continue

        acc: dict[str, dict] = {}
        for sid, chat_id, title, source, _started in found:
            hid = chat_id if chat_id in local_by_hid else sid
            if hid not in local_by_hid:
                continue
            slot = acc.setdefault(hid, {"root": (title, source), "tip": (None, None), "head": sid})
            slot["head"] = sid  # rows are ascending, so the last one is the tip
            slot["tip"] = (title, source)
        for hid, slot in acc.items():
            # Same rule as the Hermes session list: COALESCE(tip.title, root.title)
            title, source = slot["tip"] if slot["tip"][0] else slot["root"]
            out[local_by_hid[hid]] = GatewayThread(slot["head"], title or None, source if title else None)
    return out
