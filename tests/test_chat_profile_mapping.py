"""Mapping de profile de chat por usuário (admin define na tela de usuários).

Precedência: `users.chat_profile` > mapa legado (`AGENTOS_CHAT_PROFILES`).
Usuário comum nunca escolhe o profile; só o admin, via API.
"""
from backend import auth, chat_sessions


def test_user_column_overrides_legacy_map_and_can_be_cleared(client):
    created = auth.create_user("zz_map_probe", "pw-123456", "viewer")
    uid = created["id"]
    try:
        auth.set_user_chat_profile(uid, "private_a")
        assert chat_sessions.profile_for_user(uid, "zz_map_probe") == "private_a"

        # limpar volta ao mapa legado (que não conhece esse usuário -> default-deny)
        auth.set_user_chat_profile(uid, None)
        assert chat_sessions.profile_for_user(uid, "zz_map_probe") is None

        # o mapa legado continua valendo quando a coluna está vazia
        assert chat_sessions.profile_for_user(uid, "user_b") == "private_b"
    finally:
        auth.delete_user(uid)


def test_admin_sets_profile_and_viewer_cannot(client, admin_headers, viewer_headers):
    users = auth.list_all_users()
    assert all("chat_profile" in u for u in users)
    target = auth.create_user("zz_map_target", "pw-123456", "viewer")
    uid = target["id"]
    try:
        r = client.put(
            f"/api/auth/users/{uid}/profile", json={"chat_profile": "default"}, headers=admin_headers
        )
        assert r.status_code == 200, r.text
        assert r.json()["chat_profile"] == "default"

        bad = client.put(
            f"/api/auth/users/{uid}/profile",
            json={"chat_profile": "nao_existe_zz"},
            headers=admin_headers,
        )
        assert bad.status_code == 400

        forbidden = client.put(
            f"/api/auth/users/{uid}/profile",
            json={"chat_profile": "default"},
            headers=viewer_headers,
        )
        assert forbidden.status_code == 403
    finally:
        auth.delete_user(uid)
