import json
import os
from datetime import datetime, timezone
from typing import Dict, Optional

import aiosqlite

from backend.config import settings

STATE_DB = os.path.join(settings.AGENTOS_DATA_DIR, "state.db")


def _display_where(alias: str = "") -> str:
    """WI-6 (F-M3-01/03/11): replicate the Hermes display projection exactly.
    Sources: hermes_state_messages._DISPLAY_ACTIVE_CLAUSE +
    DISPLAY_VISIBLE_SQL (model_only) + hermes_state_common preview eligibility
    (display_kind='hidden' is "scaffolding the gateway never paints").
      - (active=1 OR compacted=1): rewound/branched rows (0,0) are ghost turns
        never displayed (175.896 of 273.278 rows live in the current state.db).
      - model_only: rows flagged model-only never enter a display projection.
      - hidden: model-facing scaffolding, never painted.
    """
    pfx = f"{alias}." if alias else ""
    return (
        f" AND ({pfx}active = 1 OR {pfx}compacted = 1)"
        f" AND COALESCE(CASE WHEN json_valid({pfx}display_metadata)"
        f" THEN json_extract({pfx}display_metadata, '$.model_only') END, 0) = 0"
        f" AND COALESCE({pfx}display_kind, '') <> 'hidden'"
    )


def _display_text_expr(alias: str = "") -> str:
    """F-M3-11: carriers store their renderable text in display_metadata.display_text;
    the gateway paints THAT, never the raw carrier content."""
    pfx = f"{alias}." if alias else ""
    return (
        f"COALESCE(CASE WHEN json_valid({pfx}display_metadata)"
        f" THEN json_extract({pfx}display_metadata, '$.display_text') END, {pfx}content)"
    )


def _representative_clause(alias: str = "", key_alias: str = "c") -> str:
    """F-M3-10: one representative row per display group (protected-tail copies
    share display_order). The canonical pick is active DESC, id DESC."""
    pfx = f"{alias}." if alias else ""
    k = f"{key_alias}."
    return (
        # Perf (fix urgente pós-7ee00be): casar display_order DIRETO deixa o
        # subquery fazer seek no índice parcial idx_messages_display_page
        # (session_id, display_order, active DESC, id DESC). A forma anterior
        # COALESCE(display_order, id) derrotava o índice → O(n²) (probe estourou
        # 300s na maior sessão). Ramo legacy (display_order NULL) não deduplica:
        # cópias protected-tail sempre compartilham display_order (trigger do
        # Hermes), então NULL = row única = mostrar direto é o comportamento fiel.
        f" AND ({pfx}display_order IS NULL OR {pfx}id = (SELECT {k}id FROM messages {k.rstrip('.')}"
        f" WHERE {k}session_id = {pfx}session_id"
        f" AND {k}display_order = {pfx}display_order"
        f" AND {k}role IN ('user', 'assistant', 'tool')"
        + _display_where(key_alias) +
        f" ORDER BY {k}active DESC, {k}id DESC LIMIT 1))"
    )

# model-to-profile mapping fallback when sessions table lacks `profile` column
MODEL_TO_PROFILE: Dict[str, str] = {
    "glm-5.2": "nexus",          # nexus is the orchestrator, uses glm-5.2 most
    "z-ai/glm-5.2": "nexus",
    "kimi-k2.6": "pipeline",      # pipeline uses kimi-k2.6
    "mimo-v2.5": "atlas",         # atlas uses mimo-v2.5
    "mimo-v2.5-pro": "nova",      # nova uses mimo-v2.5-pro (coder delegates to it)
    "deepseek-v4-flash": "coder", # coder uses various models via delegation
    "gemma4:31b": "pixel",        # pixel uses gemma4 for vision
    "nemotron-3-ultra": "coder",
    "gemini-3-flash-preview": "default",   # main-config profile id (was: "hermes", nonexistent)
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

    Tries `SELECT profile_name, COUNT(*) FROM sessions` first.
    Falls back to grouping by model name and mapping to profiles.
    """
    if not os.path.exists(STATE_DB):
        return {}

    try:
        async with aiosqlite.connect(STATE_DB) as db:
            # Attempt the ideal query first
            try:
                async with db.execute(
                    "SELECT profile_name, COUNT(*) FROM sessions WHERE profile_name IS NOT NULL GROUP BY profile_name"
                ) as cursor:
                    rows = await cursor.fetchall()
                    if rows:
                        return {row[0]: row[1] for row in rows}
            except Exception:
                pass

            # Fallback: use model column mapping
            async with db.execute(
                "SELECT model, COUNT(*) FROM sessions GROUP BY model"
            ) as cursor:
                rows = await cursor.fetchall()
            result: Dict[str, int] = {}
            for model, cnt in rows:
                # Unmapped models must NOT vanish (M10-10) — conserve the count
                # in an explicit bucket instead of silently dropping it.
                profile = MODEL_TO_PROFILE.get(model, "unknown")
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


async def get_session_message_count(session_id: str) -> int:
    """Return total message count for a session (excluding session_meta)."""
    if not os.path.exists(STATE_DB):
        return 0

    async with aiosqlite.connect(STATE_DB) as db:
        async with db.execute(
            f"""
            SELECT COUNT(*) FROM messages m
            WHERE m.session_id = ? AND m.role IN ('user', 'assistant', 'tool')
            {_display_where('m')}{_representative_clause('m')}
            """,
            (session_id,),
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else 0


async def get_session_messages(session_id: str, limit: int = 100, offset: int = 0) -> dict:
    """Return paginated messages for a session.

    Returns: {"messages": [...], "total": N, "limit": 100, "offset": 0}
    """
    if not os.path.exists(STATE_DB):
        return {"messages": [], "total": 0, "limit": limit, "offset": offset}

    total = await get_session_message_count(session_id)
    messages: list[dict] = []

    async with aiosqlite.connect(STATE_DB) as db:
        async with db.execute(
            f"""
            SELECT
                m.id, m.session_id, m.role, {_display_text_expr('m')} AS content, m.tool_name,
                m.timestamp, m.tool_calls, m.finish_reason, m.token_count,
                m.reasoning_content, m.compacted
            FROM messages m
            WHERE m.session_id = ? AND m.role IN ('user', 'assistant', 'tool')
            {_display_where('m')}{_representative_clause('m')}
            ORDER BY COALESCE(m.display_order, m.id) ASC
            LIMIT ? OFFSET ?
            """,
            (session_id, limit, offset),
        ) as cursor:
            rows = await cursor.fetchall()
            for row in rows:
                (
                    mid,
                    sid,
                    role,
                    content,
                    tool_name,
                    ts,
                    tool_calls_raw,
                    finish_reason,
                    token_count,
                    reasoning_content,
                    compacted,
                ) = row
                tool_calls = None
                if tool_calls_raw:
                    import json
                    try:
                        tool_calls = json.loads(tool_calls_raw)
                    except Exception:
                        tool_calls = None
                if compacted:
                    content = "[compacted]"
                messages.append(
                    {
                        "id": mid,
                        "session_id": sid,
                        "role": role,
                        "content": content or "",
                        "tool_name": tool_name,
                        "timestamp": _ts_to_iso(ts),
                        "tool_calls": tool_calls,
                        "finish_reason": finish_reason,
                        "token_count": token_count,
                        "reasoning_content": reasoning_content,
                    }
                )

    return {"messages": messages, "total": total, "limit": limit, "offset": offset}


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
            f"""
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
                {_display_text_expr('m')} AS content
            FROM messages_fts
            JOIN messages m ON m.rowid = messages_fts.rowid
            JOIN sessions s ON s.id = m.session_id
            WHERE messages_fts MATCH ?{_display_where('m')}
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
