"""Chat sessions owned by AgentOS users (Lote 1 — chat da família).

Each row is one conversation: who owns it, which Hermes profile answers it, and
the session id that exists in the Hermes gateway (`state.db`). The gateway is
the source of truth for the transcript; this table is the index that makes a
conversation *belong* to somebody.

Ownership always comes from the JWT (``user_id``) — never from the request
body — so one user can't open, rename or delete another's session.
"""

from __future__ import annotations

import json
import os
import sqlite3
import time
import uuid
from typing import Any, Optional

from backend.auth import DB_PATH

# username -> Hermes profile. Overridable with AGENTOS_CHAT_PROFILES (JSON) so
# the mapping lives in config, not in code, when the family grows.
_DEFAULT_PROFILES = {
    "mauricio": "default",
    "simone": "familia_simone",
    "anna": "familia_anna",
}

_MAX_TITLE = 120

_SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_sessions (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL,
    profile      TEXT NOT NULL,
    hermes_id    TEXT NOT NULL,
    session_key  TEXT NOT NULL,
    title        TEXT,
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL,
    archived     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user
    ON chat_sessions(user_id, updated_at DESC);
"""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.executescript(_SCHEMA)


def profile_for(username: str) -> str:
    """Hermes profile that answers this user's chat."""
    raw = os.environ.get("AGENTOS_CHAT_PROFILES", "")
    if raw:
        try:
            mapping = json.loads(raw)
            if isinstance(mapping, dict) and isinstance(mapping.get(username), str):
                return mapping[username]
        except ValueError:
            pass
    return _DEFAULT_PROFILES.get((username or "").strip().lower(), "default")


def _new_ids(user_id: int) -> tuple[str, str, str]:
    local = uuid.uuid4().hex
    hermes_id = f"agentos_{local}"
    session_key = f"agentos:{user_id}:{local}"
    return local, hermes_id, session_key


def create(user_id: int, profile: str, title: Optional[str] = None) -> dict:
    """Insert the local row. The caller creates the gateway session first."""
    local_id, hermes_id, session_key = _new_ids(user_id)
    now = int(time.time())
    with _connect() as conn:
        conn.execute(
            "INSERT INTO chat_sessions"
            " (id, user_id, profile, hermes_id, session_key, title, created_at, updated_at, archived)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
            (local_id, user_id, profile, hermes_id, session_key, title, now, now),
        )
    row = get(local_id)
    assert row is not None  # just inserted in this call
    return row


def get(session_id: str) -> Optional[dict]:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
    return dict(row) if row else None


def get_owned(session_id: str, user_id: int) -> Optional[dict]:
    row = get(session_id)
    if row is None or row["user_id"] != user_id:
        return None
    return row


def list_for_user(user_id: int, include_archived: bool = False) -> list[dict]:
    query = "SELECT * FROM chat_sessions WHERE user_id = ?"
    if not include_archived:
        query += " AND archived = 0"
    query += " ORDER BY updated_at DESC"
    with _connect() as conn:
        rows = conn.execute(query, (user_id,)).fetchall()
    return [dict(r) for r in rows]


def touch(session_id: str, title: Optional[str] = None) -> None:
    """Bump updated_at; optionally seed the title from the first message."""
    now = int(time.time())
    with _connect() as conn:
        if title:
            row = conn.execute("SELECT title FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
            if row is not None and not row["title"]:
                conn.execute(
                    "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?",
                    (title[:_MAX_TITLE], now, session_id),
                )
                return
        conn.execute("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", (now, session_id))


def rename(session_id: str, user_id: int, title: str) -> Optional[dict]:
    clean = (title or "").strip()[:_MAX_TITLE]
    if not clean:
        return None
    with _connect() as conn:
        conn.execute(
            "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (clean, int(time.time()), session_id, user_id),
        )
    return get_owned(session_id, user_id)


def set_archived(session_id: str, user_id: int, archived: bool) -> Optional[dict]:
    with _connect() as conn:
        conn.execute(
            "UPDATE chat_sessions SET archived = ?, updated_at = ? WHERE id = ? AND user_id = ?",
            (1 if archived else 0, int(time.time()), session_id, user_id),
        )
    return get_owned(session_id, user_id)


def title_from_message(text: str) -> str:
    """Short title from the first user message (single line)."""
    line = " ".join((text or "").split())
    return line[:60].rstrip() + ("…" if len(line) > 60 else "")


def public(row: dict) -> dict[str, Any]:
    """Shape returned to the UI (no internal session_key leakage beyond need)."""
    return {
        "id": row["id"],
        "profile": row["profile"],
        "hermes_id": row["hermes_id"],
        "title": row.get("title") or "Nova conversa",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "archived": bool(row["archived"]),
    }
