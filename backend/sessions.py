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


def _messages_union_sql() -> str:
    """The two-branch display union (WI-6 batch 3): indexed rows (display_order
    set, pick per group via the display index) UNION ALL legacy reps (identity
    dedup, MIN(id) as sort_key = Hermes legacy sort_id). Legacy branch drives
    via CROSS JOIN (rowid seeks). 13th col `legacy_flag` feeds the M22-6
    straddle dedup wrapper. Bindings: 3x session_id (outer idx, legacy window,
    legacy outer)."""
    return f"""
                SELECT
                    m.id, m.session_id, m.role, {_display_text_expr('m')} AS content, m.tool_name,
                    m.timestamp, m.tool_calls, m.tool_call_id, m.finish_reason, m.token_count,
                    m.reasoning_content, m.compacted,
                    m.display_order AS sort_key, 0 AS legacy_flag
                FROM messages m
                WHERE m.session_id = ? AND m.role IN ('user', 'assistant', 'tool')
                  AND m.display_order IS NOT NULL
                  AND m.id = (SELECT c.id FROM messages c
                              WHERE c.session_id = m.session_id AND c.display_order = m.display_order
                                AND c.role IN ('user', 'assistant', 'tool')
                                {_display_where('c')}
                              ORDER BY c.active DESC, c.id DESC LIMIT 1)
                  {_display_where('m')}
                UNION ALL
                SELECT
                    m.id, m.session_id, m.role, {_display_text_expr('m')} AS content, m.tool_name,
                    m.timestamp, m.tool_calls, m.tool_call_id, m.finish_reason, m.token_count,
                    m.reasoning_content, m.compacted,
                    L.grp_min AS sort_key, 1 AS legacy_flag
                FROM (SELECT rid, grp_min FROM (SELECT c.id AS rid,
                     MIN(c.id) OVER (PARTITION BY c.role, c.content, c.timestamp, c.tool_call_id, c.tool_calls, c.tool_name) AS grp_min,
                     ROW_NUMBER() OVER (PARTITION BY c.role, c.content, c.timestamp, c.tool_call_id, c.tool_calls, c.tool_name
                                        ORDER BY c.active DESC, c.id DESC) AS rn
                     FROM messages c WHERE c.session_id = ? AND c.display_order IS NULL
                       AND c.role IN ('user', 'assistant', 'tool') {_display_where('c')}
                ) WHERE rn = 1) L
                CROSS JOIN messages m
                WHERE m.id = L.rid AND m.session_id = ? AND m.role IN ('user', 'assistant', 'tool')
                  {_display_where('m')}
            """


def _straddle_dedup_wrap(union_sql: str) -> str:
    """M22-6: a legacy rep whose identity ALSO has indexed copies is painted
    twice (once per branch). Drop only the legacy twin: indexed rows never
    collapse among themselves (legit duplicate content is kept as distinct
    display groups). Count and list share this wrapper = consistent by
    construction."""
    ident = "role, content, timestamp, tool_call_id, tool_calls, tool_name"
    return f"""
            SELECT id, session_id, role, content, tool_name, timestamp, tool_calls,
                   finish_reason, token_count, reasoning_content, compacted, sort_key
            FROM (
                SELECT *, SUM(CASE WHEN legacy_flag = 0 THEN 1 ELSE 0 END)
                       OVER (PARTITION BY {ident}) AS idx_cnt
                FROM ({union_sql})
            ) WHERE NOT (legacy_flag = 1 AND idx_cnt > 0)
        """


def _representative_clause(alias: str = "", key_alias: str = "c", legacy_via: str = "") -> str:
    """F-M3-10 + M20-2 + M21-3/4: one representative row per display group.

    Indexed rows (display_order set): protected-tail copies share display_order
    (Hermes trigger) — pick active DESC, id DESC via the display index.
    Legacy rows (display_order NULL = pre-index stores): dedup by exact payload
    identity (role, content, timestamp, tool_call_id, tool_calls, tool_name),
    mirroring the Hermes legacy branch in _display_rows_sql.

    legacy_via="" (count path): the representative set is an uncorrelated
    IN-subquery (session bound as its own param).
    legacy_via="L" (messages path): the set comes from the _legacy_rep_join()
    derived table, which also carries grp_min = MIN(id) OVER identity — the
    Hermes legacy sort key (M21-3: mixed stores ordered per-row used to
    diverge from the Hermes per-session legacy order in 463/1008 positions;
    M21-4: group position = min id, not rep id).

    Perf (fix urgente pós-7ee00be): casar display_order DIRETO faz seek no
    índice parcial idx_messages_display_page. A forma COALESCE derrotava o
    índice → O(n²) (probe estourou 300s na maior sessão).
    """
    pfx = f"{alias}." if alias else ""
    k = f"{key_alias}."
    if legacy_via:
        legacy = f" OR ({pfx}display_order IS NULL AND {pfx}id = {legacy_via}.rid))"
    else:
        ident = (f"{k}role, {k}content, {k}timestamp, {k}tool_call_id,"
                 f" {k}tool_calls, {k}tool_name")
        legacy = (
            f" OR ({pfx}display_order IS NULL AND {pfx}id IN ("
            f" SELECT rid FROM (SELECT {k}id AS rid,"
            f" ROW_NUMBER() OVER (PARTITION BY {ident}"
            f" ORDER BY {k}active DESC, {k}id DESC) AS rn"
            f" FROM messages {k.rstrip('.')}"
            # M20-2 perf: sessão via parâmetro próprio (desacopla o subquery)
            f" WHERE {k}session_id = ? AND {k}display_order IS NULL"
            f" AND {k}role IN ('user', 'assistant', 'tool')"
            + _display_where(key_alias) +
            f") WHERE rn = 1)))"
        )
    return (
        f" AND (({pfx}display_order IS NOT NULL AND {pfx}id = (SELECT {k}id FROM messages {k.rstrip('.')}"
        f" WHERE {k}session_id = {pfx}session_id"
        f" AND {k}display_order = {pfx}display_order"
        f" AND {k}role IN ('user', 'assistant', 'tool')"
        + _display_where(key_alias) +
        f" ORDER BY {k}active DESC, {k}id DESC LIMIT 1))"
        + legacy
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


def _state_db_files() -> list[tuple[str, str]]:
    """WI-7: todos os state.db — root ('default') + sub-profiles.

    Perfil vivo = diretório com config.yaml (órfãos pós-delete ficam de fora,
    consistente com get_profiles/efa44da). O dir de profiles é DERIVADO do
    local do STATE_DB (<raiz>/profiles/*) — mantém sandboxes de teste
    isolados sem monkeypatch extra."""
    out: list[tuple[str, str]] = [("default", STATE_DB)]
    prof_root = os.path.join(os.path.dirname(STATE_DB), "profiles")
    if os.path.isdir(prof_root):
        for pid in sorted(os.listdir(prof_root)):
            cfg = os.path.join(prof_root, pid, "config.yaml")
            db = os.path.join(prof_root, pid, "state.db")
            if os.path.isfile(cfg) and os.path.isfile(db):
                out.append((pid, db))
    return out


def _row_to_session(row: tuple) -> dict:
    """Map a sessions SELECT row to a session dict."""
    profile = row[10] if len(row) > 10 else None
    row = row[:10]
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
        "profile": profile,
    }


async def count_sessions_by_profile() -> Dict[str, int]:
    """M10-04/WI-7: sessões por profile em TODOS os state.db.

    COALESCE(profile_name, dono_do_db): sub-stores têm profile_name
    majoritariamente NULL = do próprio profile (flag do veredito M10).
    Stores sem a coluna caem no mapeamento por modelo (M10-10: descarta
    modelos fora do map)."""
    totals: Dict[str, int] = {}
    for owner, path in _state_db_files():
        if not os.path.exists(path):
            continue
        async with aiosqlite.connect(path) as db:
            cols = {r[1] for r in await (await db.execute(
                "PRAGMA table_info(sessions)")).fetchall()}
            if "profile_name" in cols:
                async with db.execute(
                    "SELECT COALESCE(profile_name, ?), COUNT(*) FROM sessions GROUP BY 1",
                    (owner,),
                ) as cursor:
                    for pid, count in await cursor.fetchall():
                        totals[pid] = totals.get(pid, 0) + count
            else:
                async with db.execute(
                    "SELECT model, COUNT(*) FROM sessions GROUP BY model"
                ) as cursor:
                    for model, count in await cursor.fetchall():
                        pid = MODEL_TO_PROFILE.get(model or "", "unknown")
                        totals[pid] = totals.get(pid, 0) + count
    return totals


async def list_sessions(
    limit: int = 50,
    offset: int = 0,
    search: Optional[str] = None,
    source: Optional[str] = None,
    model: Optional[str] = None,
    include_hidden: bool = False,
) -> dict:
    """Return paginated session list, aggregated across ALL profile state.dbs
    (WI-7). Each item carries `profile` = COALESCE(profile_name, owner).

    Returns: {"sessions": [...], "total": N, "limit": 50, "offset": 0}
    """
    where_clauses: list[str] = []
    if not include_hidden:
        where_clauses.append("hidden = 0")  # F-M3-07: Bot Mode marca sessions hidden de propósito
    params: list = []

    if search:
        where_clauses.append("title LIKE ? ESCAPE '\\'")  # F-M3-06: % e _ são literais
        params.append(
            f"%{search.replace(chr(92), chr(92) * 2).replace('%', chr(92) + '%').replace('_', chr(92) + '_')}%"
        )
    if source:
        where_clauses.append("source = ?")
        params.append(source)
    if model:
        where_clauses.append("model = ?")
        params.append(model)

    where_sql = ""
    if where_clauses:
        where_sql = "WHERE " + " AND ".join(where_clauses)

    merged: list[dict] = []
    for owner, path in _state_db_files():
        if not os.path.exists(path):
            continue
        async with aiosqlite.connect(path) as db:
            cols = {r[1] for r in await (await db.execute(
                "PRAGMA table_info(sessions)")).fetchall()}
            prof_expr = "COALESCE(profile_name, ?)" if "profile_name" in cols else "?"
            sql = f"""
                SELECT
                    id, source, model, title, started_at, ended_at,
                    message_count, tool_call_count, chat_type, archived,
                    {prof_expr}
                FROM sessions
                {where_sql}
                ORDER BY started_at DESC
            """
            async with db.execute(sql, [owner] + params) as cursor:
                merged.extend(_row_to_session(r) for r in await cursor.fetchall())

    merged.sort(key=lambda x: x.get("started_at") or "", reverse=True)
    total = len(merged)
    sessions = merged[offset:offset + limit]
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
            WHERE id = ? AND hidden = 0
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
            f"SELECT COUNT(*) FROM ({_straddle_dedup_wrap(_messages_union_sql())})",
            (session_id, session_id, session_id),
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
            _straddle_dedup_wrap(_messages_union_sql())
            + " ORDER BY sort_key ASC, id ASC LIMIT ? OFFSET ?",
            (session_id, session_id, session_id, limit, offset),
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
                    _sort_key,  # M21-3/4: só para ORDER BY, não vai pro dict
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


def _fts_quote(query: str) -> str:
    """M20-3/F-M3-02: FTS5 parses user input as MATCH syntax — quote each
    whitespace token as a string literal (syntax becomes data).

    M21-1: quotes INSIDE tokens are dropped — the FTS5 default tokenizer
    treats them as separators anyway, and a token ending in " used to leave
    the literal unterminated ('a"' -> 500).
    M21-6: AND/OR/NOT are preserved as operators (Hermes
    hermes_state_search._FTS_OPERATORS) for recall parity ('frigate OR
    portão' matches either term). Dangling operators (first/last token) are
    dropped — '"foo" OR' is invalid FTS5. A query of ONLY operators falls
    back to literal search.
    """
    tokens = []
    for t in query.split():
        t = t.replace('"', "").replace("\x00", "")  # M22-3: NUL quebra o literal
        if t:
            tokens.append(t)
    ops = {"AND", "OR", "NOT"}
    non_op = [t for t in tokens if t.upper() not in ops]
    if not non_op:
        return " ".join('"' + t + '"' for t in tokens)
    kept = []
    for i, t in enumerate(tokens):
        if t.upper() in ops:
            if i == 0 or i == len(tokens) - 1:
                continue  # M21-6: operador pendurado = sintaxe inválida
            if kept and kept[-1].upper() in ops:
                continue  # M22-2: operador adjacente ('a AND OR b') = sintaxe inválida
            kept.append(t)
        else:
            kept.append('"' + t + '"')
    return " ".join(kept)


async def search_sessions_fts(query: str, limit: int = 20) -> list[dict]:
    """Search sessions using FTS5 on messages_fts table.

    Joins back to sessions to return session metadata.
    Returns matching sessions with snippet of matched text.
    M22-2/M22-3 fallback: any residual MATCH syntax error degrades to an
    empty result — never a 500 (parity with hermes_state_search ~1103,
    'FTS5 syntax error despite sanitization' -> return []).
    """
    try:
        return await _search_sessions_fts_run(query, limit)
    except aiosqlite.OperationalError:
        return []


async def _search_sessions_fts_run(query: str, limit: int = 20) -> list[dict]:
    if not os.path.exists(STATE_DB):
        return []
    q = _fts_quote(query)
    if not q:
        return []  # M20-3: MATCH '' é sintaxe inválida no FTS5 — nada a buscar

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
            WHERE messages_fts MATCH ? AND s.hidden = 0{_display_where('m')}
            GROUP BY s.id
            ORDER BY COUNT(messages_fts.rowid) DESC
            LIMIT ?
            """,
            (_fts_quote(query), limit),  # M20-3: sintaxe FTS5 vira dado
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
