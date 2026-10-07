"""WI-6 lote 1 — message visibility projection (F-M3-01/03/10/11).

Fixture replicates the real taxonomy measured on /opt/data/state.db (06/10/26):
ghosts (0,0), compacted-archive (0,1), live (1,0), display_kind='hidden',
model_only metadata, carriers with display_metadata.display_text, and
display_order groups (protected-tail copies) needing a representative pick.
"""

import asyncio
import json
import sqlite3

import backend.sessions as sessions_mod


_SCHEMA = """
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, source TEXT, model TEXT, title TEXT,
    started_at TEXT, ended_at TEXT, message_count INTEGER,
    tool_call_count INTEGER, chat_type TEXT, archived INTEGER,
    hidden INTEGER DEFAULT 0,
    user_id TEXT, end_reason TEXT, input_tokens INTEGER,
    output_tokens INTEGER, billing_provider TEXT,
    git_branch TEXT, cwd TEXT, chat_id TEXT
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
    tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp TEXT,
    token_count INTEGER, finish_reason TEXT, reasoning TEXT,
    reasoning_content TEXT, display_kind TEXT, display_metadata TEXT,
    display_order INTEGER, active INTEGER, compacted INTEGER
);
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content_rowid='id');
CREATE INDEX idx_messages_display_page ON messages(session_id, display_order, active DESC, id DESC)
    WHERE active = 1 OR compacted = 1;
"""


def _sandbox_db(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    conn = sqlite3.connect(str(db_path))
    conn.executescript(_SCHEMA)
    conn.execute("INSERT INTO sessions (id, source, model, title, started_at, message_count)"
                 " VALUES ('s1', 'cli', 'm', 'Sessão de teste', '2026-10-01T00:00:00', 99)")
    rows = [
        # (id, role, content, display_kind, display_metadata, display_order, active, compacted)
        (1, "user", "primeira mensagem visível", None, None, 1, 1, 0),
        (2, "assistant", "resposta normal", None, None, 2, 1, 0),
        (3, "user", "GHOST rebobinada", None, None, 3, 0, 0),
        (4, "assistant", "arquivo compactado", None, None, 4, 0, 1),
        (5, "assistant", "conteúdo cru do carrier", "async_delegation_complete",
         json.dumps({"display_text": "texto bonito do carrier"}), 5, 1, 0),
        (6, "user", "scaffolding hidden", "hidden", None, 6, 1, 0),
        (7, "assistant", "model only row", None, json.dumps({"model_only": 1}), 7, 1, 0),
        (8, "user", "cópia protected-tail velha", None, None, 8, 0, 1),
        (9, "user", "cópia protected-tail viva", None, None, 8, 1, 0),
        (10, "assistant", "legacy sem display_order", None, None, None, 1, 0),
    ]
    for mid, role, content, dk, dm, dor, active, compacted in rows:
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, display_kind,"
            " display_metadata, display_order, active, compacted)"
            " VALUES (?, 's1', ?, ?, ?, ?, ?, ?, ?)",
            (mid, role, content, dk, dm, dor, active, compacted),
        )
        conn.execute("INSERT INTO messages_fts (rowid, content) VALUES (?, ?)", (mid, content))
    conn.commit()
    conn.close()
    monkeypatch.setattr(sessions_mod, "STATE_DB", str(db_path))
    return db_path


def test_count_matches_display_projection(tmp_path, monkeypatch):
    """F-M3-01/03: ghosts/hidden/model_only out; compacted in; one per group."""
    _sandbox_db(tmp_path, monkeypatch)
    total = asyncio.run(sessions_mod.get_session_message_count("s1"))
    # visible: 1, 2, 4, 5(carrier), 8/9 grupo (1 representante), 10 legacy = 6
    assert total == 6


def test_messages_project_display_text_and_order(tmp_path, monkeypatch):
    """F-M3-10/11: display_order order, representative per group, display_text."""
    _sandbox_db(tmp_path, monkeypatch)
    res = asyncio.run(sessions_mod.get_session_messages("s1", limit=50))
    contents = [m["content"] for m in res["messages"]]
    ids = [m["id"] for m in res["messages"]]
    assert res["total"] == 6
    assert "GHOST rebobinada" not in contents          # F-M3-01
    assert "scaffolding hidden" not in contents        # F-M3-11
    assert "model only row" not in contents            # model_only
    assert "texto bonito do carrier" in contents       # display_text, not raw
    assert "conteúdo cru do carrier" not in contents
    # grupo display_order=8: representante = active DESC → a cópia viva (id 9)
    assert 9 in ids and 8 not in ids
    # ordem por display_order: 1,2,4,5,8-grupo, depois legacy (id 10)
    assert ids == [1, 2, 4, 5, 9, 10]
    # total da lista bate com o count (consistência paginada)
    assert res["total"] == len(res["messages"])


def test_search_does_not_leak_ghosts_or_hidden(tmp_path, monkeypatch):
    """F-M3-03: FTS matches only rows the display projection shows."""
    _sandbox_db(tmp_path, monkeypatch)
    ghost = asyncio.run(sessions_mod.search_sessions_fts("GHOST", limit=5))
    assert ghost == [] or all("GHOST" not in (r.get("snippet") or "") for r in ghost)
    hidden = asyncio.run(sessions_mod.search_sessions_fts("scaffolding", limit=5))
    assert hidden == []
    ok = asyncio.run(sessions_mod.search_sessions_fts("visível", limit=5))
    assert ok and ok[0]["id"] == "s1"


def test_representative_query_seeks_display_index(tmp_path, monkeypatch):
    """Perf regression guard (pós-7ee00be): the representative subquery must
    SEEK idx_messages_display_page — the COALESCE form defeated the index and
    timed out (>300s) on the largest live session (~74k rows)."""
    _sandbox_db(tmp_path, monkeypatch)
    import sqlite3 as _sq
    from backend.sessions import _display_where, _representative_clause
    q = (f"SELECT COUNT(*) FROM messages m WHERE m.session_id = ?"
         f" AND m.role IN ('user', 'assistant', 'tool')"
         f"{_display_where('m')}{_representative_clause('m')}")
    conn = _sq.connect(str(tmp_path / "state.db"))
    plan = "\n".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN " + q, ("s1", "s1")))
    conn.close()
    assert "SCAN messages c" not in plan, plan
    assert "SEARCH" in plan, plan


# ── WI-6 batch 2 (M20-2 legacy dedup, M20-3 FTS escape, F-M3-06 LIKE) ───────

def test_legacy_identity_copies_dedupe(tmp_path, monkeypatch):
    """M20-2: NULL display_order rows (pre-index stores) dedup by payload
    identity — 3 copies -> 1 shown (44.398 duplicate rows live in 3 sessions)."""
    _sandbox_db(tmp_path, monkeypatch)
    import sqlite3 as _sq
    conn = _sq.connect(str(tmp_path / "state.db"))
    dup = ("cópia de identidade",)
    for i, (mid, active) in enumerate([(20, 0), (21, 1), (22, 1)]):
        conn.execute(
            "INSERT INTO messages (id, session_id, role, content, display_order, active, compacted)"
            " VALUES (?, 's2', 'user', ?, NULL, ?, 1)",
            (mid, dup[0], 0 if active == 0 else 1),
        )
    # ghost copy (0,0) de mesma identidade NÃO conta como visível
    conn.execute(
        "INSERT INTO messages (id, session_id, role, content, display_order, active, compacted)"
        " VALUES (23, 's2', 'user', ?, NULL, 0, 0)", dup)
    conn.execute("INSERT INTO sessions (id, source, model, title, started_at, message_count)"
                 " VALUES ('s2', 'cli', 'm', 'Legado', '2026-10-01T00:00:00', 4)")
    conn.commit()
    conn.close()

    res = asyncio.run(sessions_mod.get_session_messages("s2", limit=50))
    ids = [m["id"] for m in res["messages"]]
    assert res["total"] == 1 and len(ids) == 1       # 3 visíveis -> 1 representante
    assert ids[0] == 22                              # active DESC, id DESC entre os vivos (mais novo vence)


def test_fts_metacharacters_never_500(tmp_path, monkeypatch):
    """M20-3/F-M3-02: 'foo AND', '"unbalanced', 'NEAR(' = data, not syntax."""
    _sandbox_db(tmp_path, monkeypatch)
    for q in ("foo AND", '"unbalanced', "(( NEAR(", "a-b OR", 'x"y', "   "):
        try:
            asyncio.run(sessions_mod.search_sessions_fts(q, limit=5))
        except Exception as e:  # noqa: BLE001
            raise AssertionError(f"FTS query {q!r} raised {e!r}")


def test_title_like_wildcards_are_literal(tmp_path, monkeypatch):
    """F-M3-06: % e _ no título do usuário não viram wildcard."""
    _sandbox_db(tmp_path, monkeypatch)
    import sqlite3 as _sq
    conn = _sq.connect(str(tmp_path / "state.db"))
    conn.execute("INSERT INTO sessions (id, source, model, title, started_at, message_count)"
                 " VALUES ('s_pct', 'cli', 'm', 'Relatório 100% pronto', '2026-10-01T00:00:00', 0)")
    conn.execute("INSERT INTO sessions (id, source, model, title, started_at, message_count)"
                 " VALUES ('s_und', 'cli', 'm', 'nota_x', '2026-10-01T00:00:00', 0)")
    conn.commit()
    conn.close()

    import backend.sessions as sm
    only = asyncio.run(sm.list_sessions(search="100%"))
    assert [r["id"] for r in only["sessions"]] == ["s_pct"]   # não casou 'nota_x' nem tudo
    only2 = asyncio.run(sm.list_sessions(search="nota_x"))
    assert [r["id"] for r in only2["sessions"]] == ["s_und"]  # _ literal
    none = asyncio.run(sm.list_sessions(search="100_"))
    assert none["sessions"] == []                             # _ não é wildcard


# ── WI-6 batch 3 (M21-1/3/4/6) ──────────────────────────────────────────────

def test_fts_trailing_quote_and_operators(tmp_path, monkeypatch):
    """M21-1: token 'a"' nunca deixa literal aberta. M21-6: AND/OR/NOT
    preservados como operadores (recall paridade Hermes); dangling dropado."""
    _sandbox_db(tmp_path, monkeypatch)
    for q in ('a"', 'x""y', '"', 'foo OR', 'OR foo', 'foo OR bar', 'AND'):
        try:
            asyncio.run(sessions_mod.search_sessions_fts(q, limit=5))
        except Exception as e:  # noqa: BLE001
            raise AssertionError(f"FTS query {q!r} raised {e!r}")
    from backend.sessions import _fts_quote
    assert '"' not in _fts_quote('a"').replace('"a"', "")   # aspa interna sumiu
    assert _fts_quote("foo OR bar") == '"foo" OR "bar"'      # operador no meio
    assert _fts_quote("foo OR") == '"foo"'                   # dangling dropado
    assert _fts_quote("AND") == '"AND"'                      # solo = literal


def test_legacy_group_sorts_at_min_id_position(tmp_path, monkeypatch):
    """M21-3/M21-4: grupo legado ordena na posição do MIN(id) da identidade
    (sort_id do Hermes legacy), não na posição do representante vivo."""
    _sandbox_db(tmp_path, monkeypatch)
    import sqlite3 as _sq
    conn = _sq.connect(str(tmp_path / "state.db"))
    conn.execute("INSERT INTO sessions (id, source, model, title, started_at, message_count)"
                 " VALUES ('s3', 'cli', 'm', 'Ordem', '2026-10-01T00:00:00', 4)")
    # linha normal id 30; cópias legadas ids 31 (min) e 33 (rep vivo); linha 32 entre elas
    rows = [(30, "primeiro", None, 1, 0), (31, "cópia antiga", None, 0, 1),
            (32, "entre as cópias", None, 1, 0), (33, "cópia antiga", None, 1, 0)]
    for mid, content, dor, active, compacted in rows:
        conn.execute("INSERT INTO messages (id, session_id, role, content, display_order, active, compacted)"
                     " VALUES (?, 's3', 'user', ?, ?, ?, ?)", (mid, content, dor, active, compacted))
    conn.commit()
    conn.close()

    res = asyncio.run(sessions_mod.get_session_messages("s3", limit=50))
    contents = [m["content"] for m in res["messages"]]
    # grupo (31/33) ordena na posição do min id (31) → ANTES de 'entre as cópias'
    assert contents == ["primeiro", "cópia antiga", "entre as cópias"], contents
    ids = [m["id"] for m in res["messages"]]
    assert ids[1] == 33  # representante vivo


# ── WI-6 batch 3.5 (M22-2/3/6 + fallback OperationalError) ───────────────────

def test_fts_residual_syntax_never_500(tmp_path, monkeypatch):
    """M22-2 ('a AND OR b') e M22-3 (NUL): degradam para resultado — nunca
    500. Fallback = paridade Hermes (hermes_state_search ~1103)."""
    _sandbox_db(tmp_path, monkeypatch)
    for q in ("a AND OR b", "nul\x00x", "AND OR NOT", "x AND AND y", "a OR OR OR b"):
        try:
            res = asyncio.run(sessions_mod.search_sessions_fts(q, limit=5))
            assert isinstance(res, list)
        except Exception as e:  # noqa: BLE001
            raise AssertionError(f"FTS query {q!r} raised {e!r}")


def test_straddle_identity_paints_once(tmp_path, monkeypatch):
    """M22-6: cópia legacy + gêmea indexada da mesma identidade pintam 1x
    (a indexada vence). Indexadas legítimas com conteúdo igual NÃO colapsam."""
    _sandbox_db(tmp_path, monkeypatch)
    import sqlite3 as _sq
    conn = _sq.connect(str(tmp_path / "state.db"))
    conn.execute("INSERT INTO sessions (id, source, model, title, started_at, message_count)"
                 " VALUES ('s4', 'cli', 'm', 'Straddle', '2026-10-01T00:00:00', 4)")
    rows = [
        (60, "dup identidade", None, 1, 1),   # réplica legacy (pintada antes do fix = 2x)
        (61, "dup identidade", 70, 1, 0),     # gêmea indexada (vence)
        (62, "dup identidade", 80, 1, 0),     # indexada legítima, mesmo conteúdo — MANTIDA
        (63, "outra", 90, 1, 0),
    ]
    for mid, content, dor, active, compacted in rows:
        conn.execute("INSERT INTO messages (id, session_id, role, content, display_order, active, compacted)"
                     " VALUES (?, 's4', 'user', ?, ?, ?, ?)", (mid, content, dor, active, compacted))
    conn.commit()
    conn.close()

    res = asyncio.run(sessions_mod.get_session_messages("s4", limit=50))
    contents = [m["content"] for m in res["messages"]]
    assert contents.count("dup identidade") == 2, contents   # indexadas 61+62, legacy 60 fora
    assert 60 not in [m["id"] for m in res["messages"]]        # réplica legacy suprimida
    total = asyncio.run(sessions_mod.get_session_message_count("s4"))
    assert total == len(res["messages"]) == 3                  # count==list por construção


def test_list_sessions_filters_hidden_by_default(tmp_path, monkeypatch):
    """F-M3-07: sessions.hidden (Bot Mode) fora da lista por default;
    include_hidden=True mostra."""
    _sandbox_db(tmp_path, monkeypatch)
    import sqlite3 as _sq
    conn = _sq.connect(str(tmp_path / "state.db"))
    conn.execute("INSERT INTO sessions (id, source, model, title, started_at, message_count, hidden)"
                 " VALUES ('s_vis', 'cli', 'm', 'Visível', '2026-10-01T00:00:00', 0, 0)")
    conn.execute("INSERT INTO sessions (id, source, model, title, started_at, message_count, hidden)"
                 " VALUES ('s_hid', 'cli', 'm', 'Bot', '2026-10-01T00:00:00', 0, 1)")
    conn.commit()
    conn.close()
    import backend.sessions as sm
    res = asyncio.run(sm.list_sessions())
    ids = [s["id"] for s in res["sessions"]]
    assert "s_vis" in ids and "s_hid" not in ids, ids
    res2 = asyncio.run(sm.list_sessions(include_hidden=True))
    assert "s_hid" in [s["id"] for s in res2["sessions"]]
    # M23-1: detalhe e FTS também respeitam sessions.hidden
    assert asyncio.run(sm.get_session("s_hid")) is None
    assert asyncio.run(sm.get_session("s_vis")) is not None
