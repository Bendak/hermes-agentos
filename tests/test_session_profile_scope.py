"""Escopo por profile no SQL: LIMIT/offset/total contam só o que o viewer vê.

NEW-2/NEW-3 do round 4: filtrar em Python depois do LIMIT causava "starvation"
(as sessões do próprio usuário ficavam fora da página) e `total` virava o
tamanho da página, não o total real.
"""
import asyncio
import sqlite3

import backend.sessions as sessions_mod

COLS = ("id TEXT, source TEXT, model TEXT, title TEXT, started_at TEXT, ended_at TEXT,"
        " message_count INTEGER, tool_call_count INTEGER, chat_type TEXT, archived INTEGER,"
        " hidden INTEGER DEFAULT 0, profile_name TEXT")


def _make_root_db(tmp_path):
    path = tmp_path / "state.db"
    con = sqlite3.connect(path)
    con.execute(f"CREATE TABLE sessions ({COLS})")
    rows = []
    # 25 sessões da família (mais recentes) + 5 do usuário (mais antigas)
    for i in range(25):
        rows.append((f"fam{i:02d}", "cli", "m", f"private {i}", 10_000 + i, None, 0, 0, None, 0, 0, "private_a"))
    for i in range(5):
        rows.append((f"own{i}", "cli", "m", f"minha {i}", 100 + i, None, 0, 0, None, 0, 0, "user_a"))
    con.executemany("INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.commit()
    con.close()
    return path


def test_profile_filter_applies_before_pagination(tmp_path, monkeypatch):
    path = _make_root_db(tmp_path)
    monkeypatch.setattr(sessions_mod, "STATE_DB", str(path))
    monkeypatch.setattr(sessions_mod, "_state_db_files", lambda: [("default", str(path))])

    own = asyncio.run(sessions_mod.list_sessions(limit=20, profile="user_a"))
    assert own["total"] == 5, own["total"]           # total real, não o da página
    assert [s["id"] for s in own["sessions"]] == [f"own{i}" for i in range(4, -1, -1)]
    assert all(s["profile"] == "user_a" for s in own["sessions"])

    # página 2 do viewer continua vazia e coerente, sem vazar as da família
    page2 = asyncio.run(sessions_mod.list_sessions(limit=20, offset=4, profile="user_a"))
    assert page2["total"] == 5 and len(page2["sessions"]) == 1
    assert page2["sessions"][0]["id"] == "own0"

    admin = asyncio.run(sessions_mod.list_sessions(limit=20))
    assert admin["total"] == 30 and len(admin["sessions"]) == 20  # admin: página cheia


def test_legacy_store_without_profile_name_no_bind_mismatch(tmp_path, monkeypatch):
    """NEW-5: store legado sem coluna profile_name não pode gerar bind mismatch
    (a exceção era engolida e a lista vinha vazia)."""
    legacy = tmp_path / "legacy.db"
    con = sqlite3.connect(legacy)
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT, model TEXT, title TEXT,"
                " started_at TEXT, ended_at TEXT, message_count INTEGER, tool_call_count INTEGER,"
                " chat_type TEXT, archived INTEGER, hidden INTEGER DEFAULT 0)")
    con.execute("INSERT INTO sessions VALUES ('l1','cli','m','legado',100,NULL,0,0,NULL,0,0)")
    con.commit(); con.close()
    monkeypatch.setattr(sessions_mod, "_state_db_files", lambda: [("default", str(legacy))])

    # owner diferente do profile → db pulado (sem erro, sem vazamento)
    other = asyncio.run(sessions_mod.list_sessions(limit=20, profile="user_a"))
    assert other["total"] == 0 and other["sessions"] == []

    # owner é o próprio profile → rows aparecem normalmente
    same = asyncio.run(sessions_mod.list_sessions(limit=20, profile="default"))
    assert same["total"] == 1 and same["sessions"][0]["id"] == "l1"

    # admin continua vendo tudo
    admin = asyncio.run(sessions_mod.list_sessions(limit=20))
    assert admin["total"] == 1
