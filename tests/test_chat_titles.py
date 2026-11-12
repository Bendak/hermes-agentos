"""Chat titles mirrored from the Hermes session, renames through the gateway API.

No network: ``state.db`` is a throwaway sqlite file and the gateway PATCH is
replaced. What is tested is precedence (placeholder < automatic < rename),
that renames never write ``state.db`` directly, and the conflict/pending paths.
"""

import asyncio
import hashlib
import json
import sqlite3

import pytest

import backend.chat as chat
import backend.chat_sessions as cs
import backend.chat_usage as chat_usage

_SCHEMA = """
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, chat_id TEXT, title TEXT, title_source TEXT, started_at REAL
);
"""


@pytest.fixture
def gw(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENTOS_CHAT_PROFILES",
                       json.dumps({"zz_admin": "default", "zz_viewer": "default"}))
    monkeypatch.setenv("AGENTOS_PROFILES_DIR", str(tmp_path / "profiles"))
    monkeypatch.setenv("API_SERVER_KEY", "test-gateway-key-" + "x" * 20)
    cs.reset_initialized_for_tests()

    async def fake_create(profile, session_id, title):
        return None

    monkeypatch.setattr(chat, "_create_remote_session", fake_create)
    monkeypatch.setattr(chat, "channel_mode", lambda: True)
    cs.init_db()
    db = tmp_path / "state.db"
    conn = sqlite3.connect(db)
    conn.executescript(_SCHEMA)
    conn.commit()
    conn.close()
    monkeypatch.setattr(chat_usage, "state_db_for", lambda profile: str(db))

    calls = []
    state = {"reply": ("ok", "")}

    async def fake_set_title(profile, gateway_session_id, title):
        calls.append((profile, gateway_session_id, title))
        return state["reply"]

    monkeypatch.setattr(chat, "_gateway_set_title", fake_set_title)
    return {"db": db, "calls": calls, "state": state}


def _new(client, headers):
    r = client.post("/api/chat/sessions", json={}, headers=headers)
    assert r.status_code == 200, r.text
    pub = r.json()
    return pub, cs.get(pub["id"])


def _gw_row(db, sid, chat_id, title=None, source=None, started=1.0):
    conn = sqlite3.connect(db)
    conn.execute("INSERT INTO sessions VALUES (?,?,?,?,?)", (sid, chat_id, title, source, started))
    conn.commit()
    conn.close()


def _title_of(client, headers, sid):
    rows = client.get("/api/chat/sessions", headers=headers).json()["data"]
    return next(r["title"] for r in rows if r["id"] == sid)


def _sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_list_shows_gateway_llm_title_over_placeholder(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    cs.touch(pub["id"], title="ola, pode ligar o ar do escritorio pra mim")
    before = cs.get(pub["id"])["updated_at"]
    _gw_row(gw["db"], "g1", row["hermes_id"], "Ligar ar condicionado", "llm")

    assert _title_of(client, admin_headers, pub["id"]) == "Ligar ar condicionado"
    local = cs.get(pub["id"])
    assert local["title"] == "Ligar ar condicionado"
    assert local["title_source"] == "gateway"
    assert local["updated_at"] == before  # a mirrored title is not activity


def test_newest_titled_session_of_thread_wins(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    hid = row["hermes_id"]
    _gw_row(gw["db"], "g1", hid, "Antigo", "llm", started=1.0)
    _gw_row(gw["db"], "g2", hid, "Depois da compressão", "llm", started=2.0)
    _gw_row(gw["db"], "g3", hid, None, None, started=3.0)  # untitled newest head
    _gw_row(gw["db"], "x", "agentos_outra", "De outra conversa", "llm", started=9.0)
    # same rule as the Hermes session list: COALESCE(tip.title, root.title)
    assert _title_of(client, admin_headers, pub["id"]) == "Antigo"

    gw["state"]["reply"] = ("ok", "")
    r = client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Nome novo"},
                     headers=admin_headers)
    assert r.status_code == 200
    assert gw["calls"][-1] == ("default", "g3", "Nome novo")  # rename targets the head


def test_rename_goes_through_gateway_and_never_writes_state_db(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    _gw_row(gw["db"], "g1", row["hermes_id"], "Título automático", "llm")
    digest = _sha(gw["db"])

    r = client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "  Meu   nome "},
                     headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["title"] == "Meu nome"
    assert gw["calls"] == [("default", "g1", "Meu nome")]
    assert cs.get(pub["id"])["title_source"] == "user"
    assert _sha(gw["db"]) == digest  # state.db untouched by AgentOS


def test_agentos_rename_beats_automatic_gateway_title(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    _gw_row(gw["db"], "g1", row["hermes_id"], "Título automático", "llm")
    client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Meu nome"}, headers=admin_headers)
    # the fake gateway did not really rename, so state.db still says 'llm'
    assert _title_of(client, admin_headers, pub["id"]) == "Meu nome"


def test_rename_made_in_hermes_beats_older_agentos_rename(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    cs.rename(pub["id"], row["user_id"], "Nome antigo do AgentOS", source="user")
    _gw_row(gw["db"], "g1", row["hermes_id"], "Renomeado no desktop", "user")
    assert _title_of(client, admin_headers, pub["id"]) == "Renomeado no desktop"
    assert cs.get(pub["id"])["title_source"] == "user"


def test_rename_conflict_is_409_and_keeps_old_title(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    _gw_row(gw["db"], "g1", row["hermes_id"], "Original", "llm")
    _title_of(client, admin_headers, pub["id"])  # mirror it locally
    gw["state"]["reply"] = ("conflict", "Title 'Teste' is already in use by session z")
    r = client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Teste"}, headers=admin_headers)
    assert r.status_code == 409
    assert "already in use" in r.json()["detail"]
    assert cs.get(pub["id"])["title"] == "Original"


def test_rename_before_first_message_is_pending_then_pushed(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    r = client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Planejamento"},
                     headers=admin_headers)
    assert r.status_code == 200
    assert gw["calls"] == []  # no gateway session exists yet
    assert cs.get(pub["id"])["title_source"] == "pending"

    # first turn creates the gateway session, auto-titled
    _gw_row(gw["db"], "g1", row["hermes_id"], "Algo automático", "llm")

    async def run():
        rows = [cs.get(pub["id"])]
        await chat._overlay_gateway_titles(rows)
        await asyncio.gather(*list(chat._background_tasks))
        return rows

    rows = asyncio.run(run())
    assert rows[0]["title"] == "Planejamento"  # pending local name is kept
    assert gw["calls"] == [("default", "g1", "Planejamento")]
    assert cs.get(pub["id"])["title_source"] == "user"


def test_gateway_down_during_rename_keeps_local_and_retries(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    _gw_row(gw["db"], "g1", row["hermes_id"], "Automático", "llm")
    gw["state"]["reply"] = ("unavailable", "ConnectError")
    r = client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Local"}, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["title"] == "Local"
    assert cs.get(pub["id"])["title_source"] == "pending"
    assert _title_of(client, admin_headers, pub["id"]) == "Local"


def test_missing_state_db_falls_back_to_local_title(client, admin_headers, gw, monkeypatch):
    pub, _ = _new(client, admin_headers)
    cs.touch(pub["id"], title="placeholder")
    monkeypatch.setattr(chat_usage, "state_db_for", lambda profile: None)
    assert _title_of(client, admin_headers, pub["id"]) == "placeholder"


def test_rename_still_owner_only(client, admin_headers, viewer_headers, gw):
    pub, _ = _new(client, admin_headers)
    r = client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "x"}, headers=viewer_headers)
    assert r.status_code == 404
    assert gw["calls"] == []


def test_tip_title_wins_over_root(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    _gw_row(gw["db"], "g1", row["hermes_id"], "Raiz", "llm", started=1.0)
    _gw_row(gw["db"], "g2", row["hermes_id"], "Ponta", "llm", started=2.0)
    assert _title_of(client, admin_headers, pub["id"]) == "Ponta"


def test_stale_pending_push_never_reverts_a_newer_rename(client, admin_headers, gw, monkeypatch):
    """A push scheduled for 'Nome UM' must not clobber 'Nome DOIS' renamed meanwhile."""
    pub, row = _new(client, admin_headers)
    cs.rename(pub["id"], row["user_id"], "Nome UM", source="pending")
    _gw_row(gw["db"], "g1", row["hermes_id"], "Automático", "llm")

    async def slow_then_record(profile, sid, title):
        gw["calls"].append((profile, sid, title))
        return ("ok", "")

    monkeypatch.setattr(chat, "_gateway_set_title", slow_then_record)

    async def run():
        rows = [cs.get(pub["id"])]           # list built while 'Nome UM' is pending
        # the user renames before the background push runs
        cs.rename(pub["id"], row["user_id"], "Nome DOIS", source="user")
        await chat._overlay_gateway_titles(rows)
        await asyncio.gather(*list(chat._background_tasks))

    asyncio.run(run())
    assert ("default", "g1", "Nome UM") not in gw["calls"]
    local = cs.get(pub["id"])
    assert (local["title"], local["title_source"]) == ("Nome DOIS", "user")


def test_push_result_is_not_applied_to_a_newer_title(gw, client, admin_headers, monkeypatch):
    """If the title changes while the PATCH is in flight, the CAS keeps it pending."""
    pub, row = _new(client, admin_headers)
    cs.rename(pub["id"], row["user_id"], "Primeiro", source="pending")
    _gw_row(gw["db"], "g1", row["hermes_id"], "Automático", "llm")

    async def rename_during_patch(profile, sid, title):
        cs.rename(pub["id"], row["user_id"], "Segundo", source="pending")
        return ("ok", "")

    monkeypatch.setattr(chat, "_gateway_set_title", rename_during_patch)

    async def run():
        await chat._overlay_gateway_titles([cs.get(pub["id"])])
        await asyncio.gather(*list(chat._background_tasks))

    asyncio.run(run())
    local = cs.get(pub["id"])
    assert (local["title"], local["title_source"]) == ("Segundo", "pending")


def test_pending_push_backs_off(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    cs.rename(pub["id"], row["user_id"], "Offline", source="pending")
    _gw_row(gw["db"], "g1", row["hermes_id"], "Automático", "llm")
    gw["state"]["reply"] = ("unavailable", "ConnectError")
    chat._title_push_after.pop(pub["id"], None)

    async def run():
        for _ in range(3):
            await chat._overlay_gateway_titles([cs.get(pub["id"])])
            await asyncio.gather(*list(chat._background_tasks))

    asyncio.run(run())
    assert len(gw["calls"]) == 1  # one attempt, then backoff
    assert cs.get(pub["id"])["title_source"] == "pending"


def test_legacy_mode_rename_uses_gateway_and_failure_stays_pending(client, admin_headers, gw, monkeypatch):
    monkeypatch.setattr(chat, "channel_mode", lambda: False)
    pub, row = _new(client, admin_headers)
    # legacy: the gateway session id IS the hermes_id
    _gw_row(gw["db"], row["hermes_id"], None, "Primeiro nome", "user")
    gw["state"]["reply"] = ("unavailable", "ConnectError")
    r = client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Segundo nome"},
                     headers=admin_headers)
    assert r.status_code == 200
    assert gw["calls"][-1] == ("default", row["hermes_id"], "Segundo nome")
    assert cs.get(pub["id"])["title_source"] == "pending"
    # the older gateway 'user' title must not revert the rename
    assert _title_of(client, admin_headers, pub["id"]) == "Segundo nome"


def test_legacy_mode_without_state_db_still_targets_hermes_id(client, admin_headers, gw, monkeypatch):
    monkeypatch.setattr(chat, "channel_mode", lambda: False)
    monkeypatch.setattr(chat_usage, "state_db_for", lambda profile: None)
    pub, row = _new(client, admin_headers)
    r = client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Sem db"}, headers=admin_headers)
    assert r.status_code == 200
    assert gw["calls"] == [("default", row["hermes_id"], "Sem db")]
    assert cs.get(pub["id"])["title_source"] == "user"


def test_overlay_never_clobbers_a_pending_rename_landing_during_read(client, admin_headers, gw, monkeypatch):
    pub, row = _new(client, admin_headers)
    cs.sync_gateway_title(pub["id"], "Velho")  # local mirror: ('Velho', 'gateway')
    real = chat.chat_titles.gateway_threads

    async def rename_during_read(rows):
        out = await real(rows)
        cs.rename(pub["id"], row["user_id"], "Novo nome do AgentOS", source="pending")
        return out

    _gw_row(gw["db"], "g1", row["hermes_id"], "Renomeado no desktop", "user")
    monkeypatch.setattr(chat.chat_titles, "gateway_threads", rename_during_read)
    gw["state"]["reply"] = ("unavailable", "x")

    async def run():
        rows = await chat._overlay_gateway_titles([cs.get(pub["id"])])
        await asyncio.gather(*list(chat._background_tasks))
        return rows

    rows = asyncio.run(run())
    local = cs.get(pub["id"])
    assert (local["title"], local["title_source"]) == ("Novo nome do AgentOS", "pending")
    assert rows[0]["title"] == "Novo nome do AgentOS"


def test_overlay_cas_keeps_user_rename_landing_during_read(client, admin_headers, gw, monkeypatch):
    pub, row = _new(client, admin_headers)
    cs.rename(pub["id"], row["user_id"], "Antes", source="user")
    real = chat.chat_titles.gateway_threads

    async def rename_during_read(rows):
        out = await real(rows)
        cs.rename(pub["id"], row["user_id"], "Depois", source="user")
        return out

    _gw_row(gw["db"], "g1", row["hermes_id"], "Antigo do desktop", "user")
    monkeypatch.setattr(chat.chat_titles, "gateway_threads", rename_during_read)
    rows = asyncio.run(chat._overlay_gateway_titles([cs.get(pub["id"])]))
    assert cs.get(pub["id"])["title"] == "Depois"
    assert rows[0]["title"] == "Depois"


def test_legacy_pending_is_delivered_without_state_db(client, admin_headers, gw, monkeypatch):
    monkeypatch.setattr(chat, "channel_mode", lambda: False)
    monkeypatch.setattr(chat_usage, "state_db_for", lambda profile: None)
    pub, row = _new(client, admin_headers)
    cs.rename(pub["id"], row["user_id"], "Offline legado", source="pending")
    chat._title_push_after.pop(pub["id"], None)

    async def run():
        await chat._overlay_gateway_titles([cs.get(pub["id"])])
        await asyncio.gather(*list(chat._background_tasks))

    asyncio.run(run())
    assert gw["calls"] == [("default", row["hermes_id"], "Offline legado")]
    assert cs.get(pub["id"])["title_source"] == "user"


def test_plugin_pending_without_thread_waits(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    cs.rename(pub["id"], row["user_id"], "Sem sessão ainda", source="pending")

    async def run():
        await chat._overlay_gateway_titles([cs.get(pub["id"])])
        await asyncio.gather(*list(chat._background_tasks))

    asyncio.run(run())
    assert gw["calls"] == []  # no gateway session to rename yet


def test_title_locks_are_per_event_loop():
    async def get():
        return chat._title_lock("same-chat")

    a = asyncio.run(get())
    b = asyncio.run(get())
    assert a is not b


def _set_gw_title(db, sid, title, source):
    conn = sqlite3.connect(db)
    conn.execute("UPDATE sessions SET title = ?, title_source = ? WHERE id = ?", (title, source, sid))
    conn.commit()
    conn.close()


def _drain_overlay(pub_id):
    async def run():
        await chat._overlay_gateway_titles([cs.get(pub_id)])
        await asyncio.gather(*list(chat._background_tasks))
    asyncio.run(run())


def test_pending_push_yields_to_newer_rename_made_in_hermes(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    _gw_row(gw["db"], "g1", row["hermes_id"], "Automático", "llm")
    gw["state"]["reply"] = ("unavailable", "ConnectError")
    client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Nome antigo"}, headers=admin_headers)
    assert cs.get(pub["id"])["title_source"] == "pending"
    # later, renamed in the Hermes desktop while AgentOS could not deliver
    _set_gw_title(gw["db"], "g1", "Renomeado DEPOIS no desktop", "user")
    gw["state"]["reply"] = ("ok", "")
    gw["calls"].clear()
    chat._title_push_after.pop(pub["id"], None)
    _drain_overlay(pub["id"])
    assert gw["calls"] == []  # the stale name is not pushed over the newer one
    local = cs.get(pub["id"])
    assert (local["title"], local["title_source"]) == ("Renomeado DEPOIS no desktop", "user")


def test_pending_push_still_delivers_over_an_older_user_title(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    _gw_row(gw["db"], "g1", row["hermes_id"], "Primeiro (entregue)", "user")
    gw["state"]["reply"] = ("unavailable", "ConnectError")
    client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Segundo"}, headers=admin_headers)
    gw["state"]["reply"] = ("ok", "")
    gw["calls"].clear()
    chat._title_push_after.pop(pub["id"], None)
    _drain_overlay(pub["id"])
    assert gw["calls"] == [("default", "g1", "Segundo")]
    assert cs.get(pub["id"])["title_source"] == "user"


def test_unknown_base_delivers_instead_of_adopting_older_title(client, admin_headers, gw, monkeypatch):
    """Round-4 G3: state.db unreadable at rename time -> base unknown -> deliver."""
    monkeypatch.setattr(chat, "channel_mode", lambda: False)
    pub, row = _new(client, admin_headers)
    _gw_row(gw["db"], row["hermes_id"], None, "Nome ANTIGO entregue antes", "user")
    real_db = chat_usage.state_db_for
    monkeypatch.setattr(chat_usage, "state_db_for", lambda profile: None)
    gw["state"]["reply"] = ("unavailable", "ConnectError")
    client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Nome NOVO"}, headers=admin_headers)
    assert cs.get(pub["id"])["title_base"] is None
    monkeypatch.setattr(chat_usage, "state_db_for", real_db)
    gw["state"]["reply"] = ("ok", "")
    gw["calls"].clear()
    chat._title_push_after.pop(pub["id"], None)
    _drain_overlay(pub["id"])
    assert gw["calls"] == [("default", row["hermes_id"], "Nome NOVO")]
    assert (cs.get(pub["id"])["title"], cs.get(pub["id"])["title_source"]) == ("Nome NOVO", "user")


def test_untitled_base_still_detects_rename_made_in_hermes(client, admin_headers, gw):
    pub, row = _new(client, admin_headers)
    _gw_row(gw["db"], "g1", row["hermes_id"], None, None)  # session exists, no title yet
    gw["state"]["reply"] = ("unavailable", "ConnectError")
    client.patch(f"/api/chat/sessions/{pub['id']}", json={"title": "Do AgentOS"}, headers=admin_headers)
    assert cs.get(pub["id"])["title_base"] == ""
    _set_gw_title(gw["db"], "g1", "Do desktop depois", "user")
    gw["state"]["reply"] = ("ok", "")
    gw["calls"].clear()
    chat._title_push_after.pop(pub["id"], None)
    _drain_overlay(pub["id"])
    assert gw["calls"] == []
    assert cs.get(pub["id"])["title"] == "Do desktop depois"
