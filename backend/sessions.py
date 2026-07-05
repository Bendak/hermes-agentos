import os
from datetime import datetime, timezone
from typing import Dict, Optional

import aiosqlite

from backend.config import settings

STATE_DB = os.path.join(settings.AGENTOS_DATA_DIR, "state.db")

# model-to-profile mapping fallback when sessions table lacks `profile` column
MODEL_TO_PROFILE: Dict[str, str] = {
    "glm-5.2": "coder",
    "kimi-k2.6": "pixel",
    "mimo-v2.5": "atlas",  # shared with nova; best-effort fallback
    "mimo-v2.5-pro": "nexus",
}


def _ts_to_iso(ts: Optional[float]) -> Optional[str]:
    """Convert Unix timestamp float to ISO 8601 UTC string."""
    if ts is None:
        return None
    try:
        dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
        return dt.isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def _row_to_session(row: tuple) -> dict:
    """Map a sessions SELECT row to a session dict."""
    (
        sid,
        source,
        model,
        title,
        started_at,
        ended_at,
        message_count,
        tool_call_count,
        chat_type,
        archived,
    ) = row
    started_iso = _ts_to_iso(started_at)
    ended_iso = _ts_to_iso(ended_at)
    duration = None
    if started_at is not None and ended_at is not None:
        try:
            duration = float(ended_at) - float(started_at)
        except (ValueError, TypeError):
            duration = None
    return {
        "id": sid,
        "source": source,
        "model": model,
        "title": title,
        "started_at": started_iso,
        "ended_at": ended_iso,
        "message_count": message_count,
        "tool_call_count": tool_call_count,
        "chat_type": chat_type,
        "archived": bool(archived),
        "duration_seconds": duration,
    }


async def count_sessions_by_profile() -> Dict[str, int]:
    """Return session counts per profile from state.db.

    Tries `SELECT profile, COUNT(*) FROM sessions GROUP BY profile` first.
    Falls back to grouping by model name and mapping to profiles.
    """
    if not os.path.exists(STATE_DB):
        return {}

    try:
        async with aiosqlite.connect(STATE_DB) as db:
            # Attempt the ideal query first
            try:
                async with db.execute(
                    "SELECT profile, COUNT(*) FROM sessions GROUP BY profile"
                ) as cursor:
                    rows = await cursor.fetchall()
                    return {row[0]: row[1] for row in rows}
            except Exception:
                # Fallback: use model column mapping
                async with db.execute(
                    "SELECT model, COUNT(*) FROM sessions GROUP BY model"
                ) as cursor:
                    rows = await cursor.fetchall()
                result: Dict[str, int] = {}
                for model, cnt in rows:
                    profile = MODEL_TO_PROFILE.get(model)
                    if profile:
                        result[profile] = result.get(profile, 0) + cnt
                return result
    except Exception:
        return {}


async def list_sessions(
    limit: int = 50,
    offset: int = 0,
    search: Optional[str] = None,
    source: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Return paginated session list from state.db.

    Returns: {"sessions": [...], "total": N, "limit": 50, "offset": 0}
    """
    if not os.path.exists(STATE_DB):
        return {"sessions": [], "total": 0, "limit": limit, "offset": offset}

    where_clauses: list[str] = []
    params: list = []

    if search:
        where_clauses.append("title LIKE ?")
        params.append(f"%{search}%")
    if source:
        where_clauses.append("source = ?")
        params.append(source)
    if model:
        where_clauses.append("model = ?")
        params.append(model)

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    total = 0
    sessions = []

    async with aiosqlite.connect(STATE_DB) as db:
        # Count total
        count_sql = f"SELECT COUNT(*) FROM sessions {where_sql}"
        async with db.execute(count_sql, params) as cursor:
            row = await cursor.fetchone()
            total = row[0] if row else 0

        # Select paginated rows
        select_sql = f"""
            SELECT
                id, source, model, title, started_at, ended_at,
                message_count, tool_call_count, chat_type, archived
            FROM sessions
            {where_sql}
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
        """
        async with db.execute(select_sql, params + [limit, offset]) as cursor:
            rows = await cursor.fetchall()
            sessions = [_row_to_session(r) for r in rows]

    return {"sessions": sessions, "total": total, "limit": limit, "offset": offset}


async def get_session(session_id: str) -> Optional[dict]:
    """Return full session detail by id."""
    if not os.path.exists(STATE_DB):
        return None

    async with aiosqlite.connect(STATE_DB) as db:
        async with db.execute(
            """
            SELECT
                id, source, user_id, model, title, started_at, ended_at,
                end_reason, message_count, tool_call_count,
                input_tokens, output_tokens, billing_provider,
                chat_type, archived, git_branch, cwd, chat_id
            FROM sessions
            WHERE id = ?
            """,
            (session_id,),
        ) as cursor:
            row = await cursor.fetchone()
            if row is None:
                return None

    (
        sid,
        source,
        user_id,
        model,
        title,
        started_at,
        ended_at,
        end_reason,
        message_count,
        tool_call_count,
        input_tokens,
        output_tokens,
        billing_provider,
        chat_type,
        archived,
        git_branch,
        cwd,
        chat_id,
    ) = row

    started_iso = _ts_to_iso(started_at)
    ended_iso = _ts_to_iso(ended_at)
    duration = None
    if started_at is not None and ended_at is not None:
        try:
            duration = float(ended_at) - float(started_at)
        except (ValueError, TypeError):
            duration = None

    return {
        "id": sid,
        "source": source,
        "user_id": user_id,
        "model": model,
        "title": title,
        "started_at": started_iso,
        "ended_at": ended_iso,
        "end_reason": end_reason,
        "message_count": message_count,
        "tool_call_count": tool_call_count,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "billing_provider": billing_provider,
        "chat_type": chat_type,
        "archived": bool(archived),
        "duration_seconds": duration,
        "git_branch": git_branch,
        "cwd": cwd,
        "chat_id": chat_id,
    }


async def search_sessions_fts(query: str, limit: int = 20) -> list[dict]:
    """Search sessions using FTS5 on messages_fts table.

    Joins back to sessions to return session metadata.
    Returns matching sessions with snippet of matched text.
    """
    if not os.path.exists(STATE_DB):
        return []

    results: list[dict] = []
    async with aiosqlite.connect(STATE_DB) as db:
        # First gather matching session IDs with their best snippet
        async with db.execute(
            """
            SELECT
                s.id,
                s.source,
                s.model,
                s.title,
                s.started_at,
                s.ended_at,
                s.message_count,
                s.tool_call_count,
                s.chat_type,
                s.archived,
                m.content
            FROM messages_fts
            JOIN messages m ON m.rowid = messages_fts.rowid
            JOIN sessions s ON s.id = m.session_id
            WHERE messages_fts MATCH ?
            GROUP BY s.id
            ORDER BY COUNT(messages_fts.rowid) DESC
            LIMIT ?
            """,
            (query, limit),
        ) as cursor:
            rows = await cursor.fetchall()

        for row in rows:
            (
                sid,
                source,
                model,
                title,
                started_at,
                ended_at,
                message_count,
                tool_call_count,
                chat_type,
                archived,
                snippet_text,
            ) = row

            started_iso = _ts_to_iso(started_at)
            ended_iso = _ts_to_iso(ended_at)
            duration = None
            if started_at is not None and ended_at is not None:
                try:
                    duration = float(ended_at) - float(started_at)
                except (ValueError, TypeError):
                    duration = None

            results.append(
                {
                    "id": sid,
                    "source": source,
                    "model": model,
                    "title": title,
                    "started_at": started_iso,
                    "ended_at": ended_iso,
                    "message_count": message_count,
                    "tool_call_count": tool_call_count,
                    "chat_type": chat_type,
                    "archived": bool(archived),
                    "duration_seconds": duration,
                    "snippet": (snippet_text or "")[:200],
                }
            )

    return results
