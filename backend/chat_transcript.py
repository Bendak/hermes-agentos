"""Local transcript for channel-mode conversations.

The gateway remains the source of truth for memory and model context.  This
table exists only so the AgentOS UI can reload a channel-mode thread after a
page refresh while the legacy HTTP session store is still the fallback for
``AGENTOS_CHANNEL=http`` threads.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any, Optional

from backend.auth import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS chat_transcript (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL DEFAULT '',
    timestamp  INTEGER NOT NULL,
    meta       TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_chat_transcript_session
    ON chat_transcript(session_id, id);
"""

_lock = threading.Lock()
_initialized = False


def init_db() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        with sqlite3.connect(DB_PATH, timeout=10) as conn:
            conn.executescript(_SCHEMA)
        _initialized = True


def append(session_id: str, role: str, content: str = "",
           meta: Optional[dict[str, Any]] = None) -> int:
    init_db()
    now = int(time.time())
    with sqlite3.connect(DB_PATH, timeout=10) as conn:
        cur = conn.execute(
            "INSERT INTO chat_transcript(session_id, role, content, timestamp, meta) "
            "VALUES (?, ?, ?, ?, ?)",
            (session_id, role, content or "", now,
             json.dumps(meta or {}, ensure_ascii=False)),
        )
        return int(cur.lastrowid or 0)


def list_messages(session_id: str, limit: int = 200, offset: int = 0) -> list[dict[str, Any]]:
    init_db()
    with sqlite3.connect(DB_PATH, timeout=10) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT id, role, content, timestamp, meta FROM chat_transcript "
            "WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?",
            (session_id, max(1, min(limit, 500)), max(0, offset)),
        ).fetchall()
    out = []
    for row in rows:
        try:
            meta = json.loads(row["meta"] or "{}")
        except ValueError:
            meta = {}
        out.append({
            "role": row["role"],
            "content": row["content"] or "",
            "timestamp": row["timestamp"],
            "tool_name": meta.get("tool_name"),
            "reasoning_content": meta.get("reasoning_content"),
            "tool_calls": meta.get("tool_calls"),
            "display_kind": meta.get("display_kind"),
            "error": meta.get("error"),
            "attachments": meta.get("attachments") or [],
        })
    return out


def clear(session_id: str) -> None:
    init_db()
    with sqlite3.connect(DB_PATH, timeout=10) as conn:
        conn.execute("DELETE FROM chat_transcript WHERE session_id = ?", (session_id,))
