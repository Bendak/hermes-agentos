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
    tool_call_count INTEGER, chat_type TEXT, archived INTEGER
);
CREATE TABLE messages (
    id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,
    tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp TEXT,
    token_count INTEGER, finish_reason TEXT, reasoning TEXT,
    reasoning_content TEXT, display_kind TEXT, display_metadata TEXT,
    display_order INTEGER, active INTEGER, compacted INTEGER
);
CREATE VIRTUAL TABLE messages_fts USING fts5(content, content_rowid='id');
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
