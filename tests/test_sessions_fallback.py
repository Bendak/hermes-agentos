"""WI-4b lote 1 — M10-10: session-count model→profile fallback.

Counts must map to REAL profile ids ('default', not the nonexistent 'hermes')
and unmapped models must be conserved in an explicit bucket, never dropped.
"""

import os
import sqlite3

import pytest

import backend.sessions as sessions_mod


def test_fallback_maps_to_real_ids_and_conserves(tmp_path, monkeypatch):
    db_path = tmp_path / "state.db"
    con = sqlite3.connect(db_path)
    # sessions table WITHOUT profile_name → forces the model-mapping fallback
    con.execute("CREATE TABLE sessions (model TEXT)")
    con.executemany("INSERT INTO sessions (model) VALUES (?)",
                    [("gemini-3-flash-preview",)] * 2 +
                    [("zz-unmapped-model",)] * 3)
    con.commit()
    con.close()
    monkeypatch.setattr(sessions_mod, "STATE_DB", str(db_path))

    import asyncio
    result = asyncio.run(sessions_mod.count_sessions_by_profile())

    assert result.get("default") == 2, result       # was: 'hermes' (nonexistent id)
    assert result.get("unknown") == 3, result       # unmapped models conserved
    assert sum(result.values()) == 5, result        # nothing dropped
    assert "hermes" not in result, result


def test_parse_yaml_simple_handles_quotes_and_comments(tmp_path):
    """M10-11: the hand-rolled parser kept quotes and bled keys across blocks."""
    import backend.agents as agents_mod
    cfg = tmp_path / "config.yaml"
    cfg.write_text(
        '# comment with default: fake\n'
        'model:\n'
        '  default: "quoted-model"\n'
        '  provider: plain-prov  # trailing comment\n'
        'other:\n'
        '  default: not-this-one\n'
    )
    parsed = agents_mod._parse_yaml_simple(str(cfg))
    assert parsed["model"]["default"] == "quoted-model", parsed
    assert parsed["model"]["provider"] == "plain-prov", parsed


def test_discovery_single_source_and_collision_safe(tmp_path, monkeypatch):
    """M10-16: one source, consistent filters, 'default' reserved exactly once."""
    import backend.profile_discovery as disc
    sub = tmp_path / "profiles"
    sub.mkdir()
    (sub / "ok").mkdir()
    (sub / "default").mkdir()      # collision attempt — must be ignored
    (sub / ".hidden").mkdir()
    (sub / "_archive").mkdir()
    (tmp_path / "config.yaml").write_text("model:\n  default: m\n")
    monkeypatch.setattr(disc, "PROFILES_DIR", str(sub))
    monkeypatch.setattr(disc, "MAIN_CONFIG", str(tmp_path / "config.yaml"))

    ids = disc.discover_profile_ids(include_default=True)
    assert ids == ["default", "ok"], ids
    assert disc.iter_sub_profile_ids() == ["ok"]


def test_multi_db_aggregation_profile_attribution(tmp_path, monkeypatch):
    """WI-7 lote 1: counts e lista agregam todos os state.db; NULL = dono;
    profile_name explícito vence; dir sem config.yaml (órfão) fica de fora."""
    root = tmp_path
    # root db: 1 sessão default
    con = sqlite3.connect(root / "state.db")
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT, model TEXT, title TEXT,"
                " started_at TEXT, ended_at TEXT, message_count INTEGER,"
                " tool_call_count INTEGER, chat_type TEXT, archived INTEGER,"
                " hidden INTEGER DEFAULT 0, profile_name TEXT)")
    con.execute("INSERT INTO sessions VALUES ('r1','cli','m','root',100,NULL,0,0,NULL,0,0,'default')")
    con.commit(); con.close()
    # sub-profile vivo: 1 NULL (dono) + 1 com profile_name explícito
    (root / "profiles" / "coder").mkdir(parents=True)
    (root / "profiles" / "coder" / "config.yaml").write_text("model: {}")
    con = sqlite3.connect(root / "profiles" / "coder" / "state.db")
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT, model TEXT, title TEXT,"
                " started_at TEXT, ended_at TEXT, message_count INTEGER,"
                " tool_call_count INTEGER, chat_type TEXT, archived INTEGER,"
                " hidden INTEGER DEFAULT 0, profile_name TEXT)")
    con.execute("INSERT INTO sessions VALUES ('c1','cli','m','nulo',200,NULL,0,0,NULL,0,0,NULL)")
    con.execute("INSERT INTO sessions VALUES ('c2','cli','m','explicito',300,NULL,0,0,NULL,0,0,'atlas')")
    con.commit(); con.close()
    # órfão pós-delete: sem config.yaml → fora
    (root / "profiles" / "gemeni").mkdir(parents=True)
    con = sqlite3.connect(root / "profiles" / "gemeni" / "state.db")
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT, model TEXT, title TEXT,"
                " started_at TEXT, ended_at TEXT, message_count INTEGER,"
                " tool_call_count INTEGER, chat_type TEXT, archived INTEGER,"
                " hidden INTEGER DEFAULT 0, profile_name TEXT)")
    con.execute("INSERT INTO sessions VALUES ('g1','cli','m','orfao',400,NULL,0,0,NULL,0,0,NULL)")
    con.commit(); con.close()

    monkeypatch.setattr(sessions_mod, "STATE_DB", str(root / "state.db"))
    import asyncio
    counts = asyncio.run(sessions_mod.count_sessions_by_profile())
    assert counts == {"default": 1, "coder": 1, "atlas": 1}, counts

    res = asyncio.run(sessions_mod.list_sessions(limit=50))
    ids = [x["id"] for x in res["sessions"]]
    assert ids == ["c2", "c1", "r1"], ids          # started_at DESC cross-DB
    profs = {x["id"]: x["profile"] for x in res["sessions"]}
    assert profs == {"r1": "default", "c1": "coder", "c2": "atlas"}, profs
    assert res["total"] == 3


def test_m243_detail_messages_fts_cross_db(tmp_path, monkeypatch):
    """M24-3: detalhe/messages/FTS acham sessões de sub-profiles (a lista
    agregava mas o clique dava 404 e a busca era cega)."""
    root = tmp_path
    con = sqlite3.connect(root / "state.db")
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT, model TEXT, title TEXT,"
                " started_at INTEGER, ended_at INTEGER, message_count INTEGER,"
                " tool_call_count INTEGER, chat_type TEXT, archived INTEGER,"
                " hidden INTEGER DEFAULT 0, profile_name TEXT,"
                " user_id TEXT, end_reason TEXT, input_tokens INTEGER,"
                " output_tokens INTEGER, billing_provider TEXT,"
                " git_branch TEXT, cwd TEXT, chat_id TEXT)")
    con.execute("INSERT INTO sessions VALUES ('r1','cli','m','root','100',NULL,0,0,NULL,0,0,'default',"
                "NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)")
    con.commit(); con.close()
    (root / "profiles" / "coder").mkdir(parents=True)
    (root / "profiles" / "coder" / "config.yaml").write_text("model: {}")
    con = sqlite3.connect(root / "profiles" / "coder" / "state.db")
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT, model TEXT, title TEXT,"
                " started_at INTEGER, ended_at INTEGER, message_count INTEGER,"
                " tool_call_count INTEGER, chat_type TEXT, archived INTEGER,"
                " hidden INTEGER DEFAULT 0, profile_name TEXT,"
                " user_id TEXT, end_reason TEXT, input_tokens INTEGER,"
                " output_tokens INTEGER, billing_provider TEXT,"
                " git_branch TEXT, cwd TEXT, chat_id TEXT)")
    con.execute("INSERT INTO sessions VALUES ('c9','cli','m','Adversarial WI-7','200',NULL,1,0,NULL,0,0,NULL,"
                "NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)")
    con.execute("CREATE TABLE messages (id INTEGER PRIMARY KEY, session_id TEXT, role TEXT, content TEXT,"
                " display_order INTEGER, active INTEGER, compacted INTEGER, display_kind TEXT, display_text TEXT,"
                " display_metadata TEXT,"
                " timestamp REAL, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, model_only INTEGER DEFAULT 0,"
                " reasoning_content TEXT, finish_reason TEXT, token_count INTEGER)")
    con.execute("INSERT INTO messages (id, session_id, role, content, display_order, active, compacted)"
                " VALUES (1,'c9','user','adversarial probe text',1,1,0)")
    con.execute("CREATE VIRTUAL TABLE messages_fts USING fts5(content, content=messages, content_rowid=id)")
    con.execute("INSERT INTO messages_fts(rowid, content) VALUES (1,'adversarial probe text')")
    con.commit(); con.close()

    monkeypatch.setattr(sessions_mod, "STATE_DB", str(root / "state.db"))
    import asyncio
    # detalhe vive no sub-db
    det = asyncio.run(sessions_mod.get_session("c9"))
    assert det is not None and det["id"] == "c9" and det["profile"] == "coder", det
    assert asyncio.run(sessions_mod.get_session("nao-existe")) is None
    # messages + count via db dono
    res = asyncio.run(sessions_mod.get_session_messages("c9"))
    assert res["total"] == 1 and res["messages"][0]["content"] == "adversarial probe text", res
    # FTS agrega cross-db e ordena por relevância
    hits = asyncio.run(sessions_mod.search_sessions_fts("adversarial", limit=10))
    assert any(h["id"] == "c9" and h.get("profile") == "coder" for h in hits), hits


def test_m241_broken_subdb_degrades_gracefully(tmp_path, monkeypatch):
    """M24-1: sub-db sqlite válido SEM tabela sessions não derruba count/list
    (antes: OperationalError → 500 no dashboard inteiro, incl. /api/agents)."""
    root = tmp_path
    con = sqlite3.connect(root / "state.db")
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT, model TEXT, title TEXT,"
                " started_at INTEGER, ended_at INTEGER, message_count INTEGER,"
                " tool_call_count INTEGER, chat_type TEXT, archived INTEGER,"
                " hidden INTEGER DEFAULT 0, profile_name TEXT)")
    con.execute("INSERT INTO sessions VALUES ('r1','cli','m','root','100',NULL,0,0,NULL,0,0,'default')")
    con.commit(); con.close()
    (root / "profiles" / "quebrado").mkdir(parents=True)
    (root / "profiles" / "quebrado" / "config.yaml").write_text("model: {}")
    con = sqlite3.connect(root / "profiles" / "quebrado" / "state.db")
    con.execute("CREATE TABLE outra_coisa (x INTEGER)")  # sem tabela sessions
    con.commit(); con.close()

    monkeypatch.setattr(sessions_mod, "STATE_DB", str(root / "state.db"))
    import asyncio
    counts = asyncio.run(sessions_mod.count_sessions_by_profile())
    assert counts == {"default": 1}, counts
    res = asyncio.run(sessions_mod.list_sessions())
    assert res["total"] == 1, res
