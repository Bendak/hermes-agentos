"""Lote 1 do chat da família: sessões por usuário e isolamento.

Nenhuma chamada real ao gateway: `_create_remote_session`/`_remote_messages`
são substituídos. O que se testa aqui é a POSSE — quem vê, renomeia e abre o quê.
"""

import pytest

import backend.chat as chat
import backend.chat_sessions as cs


@pytest.fixture(autouse=True)
def _no_network(monkeypatch):
    async def fake_create(profile, session_id, title):
        return None
    async def fake_messages(profile, session_id, limit, offset):
        return {"data": [{"role": "assistant", "content": "ok", "timestamp": 1}], "pagination": {}}
    monkeypatch.setattr(chat, "_create_remote_session", fake_create)
    monkeypatch.setattr(chat, "_remote_messages", fake_messages)
    cs.init_db()
    yield


def _create(client, headers, **body):
    r = client.post("/api/chat/sessions", json=body, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_session_is_owned_by_creator(client, admin_headers, viewer_headers):
    mine = _create(client, admin_headers, title="do admin")
    assert mine["profile"] == "default"

    r = client.get("/api/chat/sessions", headers=admin_headers)
    assert r.status_code == 200
    assert any(s["id"] == mine["id"] for s in r.json()["data"])

    # viewer não vê, não abre, não renomeia e não apaga
    other = client.get("/api/chat/sessions", headers=viewer_headers)
    assert all(s["id"] != mine["id"] for s in other.json()["data"])
    assert client.get(f"/api/chat/sessions/{mine['id']}/messages", headers=viewer_headers).status_code == 404
    assert client.patch(f"/api/chat/sessions/{mine['id']}", json={"title": "hack"}, headers=viewer_headers).status_code == 404
    assert client.delete(f"/api/chat/sessions/{mine['id']}", headers=viewer_headers).status_code == 404


def test_ids_and_session_key_are_private_to_user(client, admin_headers, viewer_headers):
    a = _create(client, admin_headers)
    b = _create(client, viewer_headers)
    assert a["hermes_id"] != b["hermes_id"]
    row_a = cs.get(a["id"])
    row_b = cs.get(b["id"])
    assert row_a["session_key"].startswith(f"agentos:{row_a['user_id']}:")
    assert row_a["session_key"] != row_b["session_key"]


def test_rename_and_archive(client, admin_headers):
    s = _create(client, admin_headers)
    r = client.patch(f"/api/chat/sessions/{s['id']}", json={"title": "  Planejamento  "}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["title"] == "Planejamento"

    r = client.patch(f"/api/chat/sessions/{s['id']}", json={"archived": True}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["archived"] is True

    listing = client.get("/api/chat/sessions", headers=admin_headers).json()["data"]
    assert all(x["id"] != s["id"] for x in listing)
    with_archived = client.get("/api/chat/sessions?include_archived=1", headers=admin_headers).json()["data"]
    assert any(x["id"] == s["id"] for x in with_archived)


def test_empty_title_rejected(client, admin_headers):
    s = _create(client, admin_headers)
    r = client.patch(f"/api/chat/sessions/{s['id']}", json={"title": "   "}, headers=admin_headers)
    assert r.status_code == 400


def test_profile_follows_logged_user(client, admin_headers, viewer_headers, monkeypatch):
    monkeypatch.setenv("AGENTOS_CHAT_PROFILES", '{"zz_viewer": "private_a"}')
    s = _create(client, viewer_headers)
    assert s["profile"] == "private_a"

    # admin pode escolher outro profile (teste/suporte)
    s2 = _create(client, admin_headers, profile="private_b")
    assert s2["profile"] == "private_b"


def test_messages_proxy_shape(client, admin_headers):
    s = _create(client, admin_headers)
    r = client.get(f"/api/chat/sessions/{s['id']}/messages?limit=10&offset=0", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["data"][0]["role"] == "assistant"
    assert body["data"][0]["content"] == "ok"


def test_invalid_pagination(client, admin_headers):
    s = _create(client, admin_headers)
    assert client.get(f"/api/chat/sessions/{s['id']}/messages?limit=0", headers=admin_headers).status_code == 400
    assert client.get(f"/api/chat/sessions/{s['id']}/messages?limit=9999", headers=admin_headers).status_code == 400


def test_title_from_first_message():
    assert cs.title_from_message("  oi\n  tudo bem?  ") == "oi tudo bem?"
    long = "x" * 100
    assert cs.title_from_message(long).endswith("…")
    assert len(cs.title_from_message(long)) <= 61
