"""Chat sessions owned by AgentOS users (Lote 1 — chat da família).

Each row is one conversation: who owns it, which Hermes profile answers it, and
the session id that exists in the Hermes gateway (`state.db`). The gateway is
the source of truth for the transcript; this table is the index that makes a
conversation *belong* to somebody.

Ownership always comes from the JWT (``user_id``) — never from the request
body — so one user can't open, rename or delete another's session.

Adversarial batch 1 fixes: profile mapping is default-deny (an unmapped user
gets None, never the admin profile), the env map is normalized, malformed JSON
raises instead of silently falling back, titles are capped at the gateway's own
100 chars, and ``init_db`` runs once per process.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
import uuid
from typing import Any, Optional

from backend.auth import DB_PATH

# username -> Hermes profile. Overridable with AGENTOS_CHAT_PROFILES (JSON) so
# the mapping lives in config, not in code, when the family grows.
_DEFAULT_PROFILES = {
    "user_a": "default",
    "hermes": "default",   # conta de operação/admin do AgentOS
    "user_b": "private_b",
    "user_c": "private_a",
}

# Gateway MAX_TITLE_LENGTH (hermes_state.py): a longer title is rejected
# upstream with 400 invalid_title, so we never store more than this.
MAX_TITLE = 100

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

_init_lock = threading.Lock()
_initialized = False


class ProfileConfigError(RuntimeError):
    """AGENTOS_CHAT_PROFILES is set but malformed — fail loudly, never fall back."""


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    """Create the table once per process (idempotent, thread-safe)."""
    global _initialized
    if _initialized:
        return
    with _init_lock:
        if _initialized:
            return
        with _connect() as conn:
            conn.executescript(_SCHEMA)
        _initialized = True


def reset_initialized_for_tests() -> None:
    """Test hook: allow a sandbox to re-create the table after dropping it."""
    global _initialized
    _initialized = False


def profile_map() -> dict[str, str]:
    """Normalized username -> profile map (lowercase keys)."""
    raw = (os.environ.get("AGENTOS_CHAT_PROFILES") or "").strip()
    if not raw:
        return dict(_DEFAULT_PROFILES)
    try:
        data = json.loads(raw)
    except ValueError as exc:
        raise ProfileConfigError(f"AGENTOS_CHAT_PROFILES is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ProfileConfigError("AGENTOS_CHAT_PROFILES must be a JSON object")
    mapping: dict[str, str] = {}
    for key, value in data.items():
        if isinstance(key, str) and isinstance(value, str):
            name, profile = key.strip().lower(), value.strip()
            if name and profile:
                mapping[name] = profile
    return mapping


def profile_for(username: Optional[str]) -> Optional[str]:
    """Hermes profile for this user, or None meaning "no chat" (403).

    Never falls back to the admin profile: an unmapped account must not inherit
    full power just because it exists.
    """
    name = (username or "").strip().lower()
    if not name:
        return None
    return profile_map().get(name)


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
            (local_id, user_id, profile, hermes_id, session_key, _clean_title(title), now, now),
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


def list_all(include_archived: bool = True) -> list[dict]:
    """Admin/support view: every row, newest first."""
    query = "SELECT * FROM chat_sessions"
    if not include_archived:
        query += " WHERE archived = 0"
    query += " ORDER BY updated_at DESC"
    with _connect() as conn:
        rows = conn.execute(query).fetchall()
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
                    (_clean_title(title), now, session_id),
                )
                return
        conn.execute("UPDATE chat_sessions SET updated_at = ? WHERE id = ?", (now, session_id))


def rename(session_id: str, user_id: int, title: str) -> Optional[dict]:
    clean = _clean_title(title)
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


def delete_for_user(user_id: int) -> int:
    """Cleanup when an AgentOS user is deleted (called from auth.delete_user)."""
    with _connect() as conn:
        cur = conn.execute("DELETE FROM chat_sessions WHERE user_id = ?", (user_id,))
    return cur.rowcount


def _clean_title(title: Any) -> Optional[str]:
    if title is None:
        return None
    text = " ".join(str(title).split())
    if not text:
        return None
    return text[:MAX_TITLE]


def title_from_message(text: str) -> str:
    """Short title from the first user message (single line)."""
    line = " ".join((text or "").split())
    return line[:60].rstrip() + ("…" if len(line) > 60 else "")


def public(row: dict) -> dict[str, Any]:
    """Shape returned to the UI (internal gateway ids stay server-side)."""
    return {
        "id": row["id"],
        "profile": row["profile"],
        "title": row.get("title") or "Nova conversa",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "archived": bool(row["archived"]),
    }
