"""Token lifecycle suite (WI-3a): strict claims, revocation, refresh rotation.

Covers backend/auth.py + the /api/auth endpoints:
- F-M1-10: a token WITHOUT exp is rejected (was accepted forever);
- legacy tokens without the ``ver`` claim are revoked;
- password change and server-side logout revoke every outstanding token;
- refresh rotation with jti: replaying a stale refresh token is treated as
  theft and revokes the whole family.
"""

import pytest

import backend.auth as auth


def craft(payload: dict) -> str:
    """Forge a token with the REAL secret but arbitrary claims."""
    return auth._create_token(payload, auth.get_jwt_secret())


def login(client, username, password):
    return client.post("/api/auth/login", json={"username": username, "password": password})


@pytest.fixture()
def fresh_user():
    import uuid

    name = f"zz_tok_{uuid.uuid4().hex[:8]}"
    auth.create_user(name, "pw-" + "x" * 16, "viewer")
    yield name, auth.get_user_by_username(name)


def test_login_returns_token_pair(client, fresh_user):
    name, user = fresh_user
    r = login(client, name, "pw-" + "x" * 16)
    assert r.status_code == 200
    body = r.json()
    assert body.get("access_token") and body.get("refresh_token")
    me = client.get("/api/auth/me", headers={"Authorization": "Bearer " + body["access_token"]})
    assert me.status_code == 200


def test_token_without_exp_rejected(client, fresh_user):
    """F-M1-10 regression: no exp => reject, never accept forever."""
    _, user = fresh_user
    token = craft({"sub": str(user["id"]), "type": "access", "ver": user["token_version"]})
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer " + token})
    assert r.status_code == 401


def test_expired_token_rejected(client, fresh_user):
    import time

    _, user = fresh_user
    token = craft(
        {
            "sub": str(user["id"]),
            "type": "access",
            "ver": user["token_version"],
            "iat": time.time() - 7200,
            "exp": time.time() - 3600,
        }
    )
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer " + token})
    assert r.status_code == 401


def test_legacy_token_without_ver_rejected(client, fresh_user):
    import time

    _, user = fresh_user
    token = craft(
        {
            "sub": str(user["id"]),
            "type": "access",
            "iat": time.time(),
            "exp": time.time() + 3600,
        }
    )
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer " + token})
    assert r.status_code == 401


def test_wrong_signature_rejected(client, fresh_user):
    import time

    _, user = fresh_user
    token = auth._create_token(
        {
            "sub": str(user["id"]),
            "type": "access",
            "ver": user["token_version"],
            "iat": time.time(),
            "exp": time.time() + 3600,
        },
        "not-the-real-secret",
    )
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer " + token})
    assert r.status_code == 401


def test_refresh_rotates_and_old_refresh_revokes_family(client, fresh_user):
    name, _ = fresh_user
    body = login(client, name, "pw-" + "x" * 16).json()
    old_access, old_refresh = body["access_token"], body["refresh_token"]

    r = client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r.status_code == 200
    rotated = r.json()
    assert rotated["refresh_token"] != old_refresh  # rotation happened

    # new access works
    assert (
        client.get("/api/auth/me", headers={"Authorization": "Bearer " + rotated["access_token"]}).status_code
        == 200
    )

    # replaying the STALE refresh = theft signal -> family revoked
    r = client.post("/api/auth/refresh", json={"refresh_token": old_refresh})
    assert r.status_code == 401
    assert (
        client.get("/api/auth/me", headers={"Authorization": "Bearer " + rotated["access_token"]}).status_code
        == 401
    )
    assert (
        client.get("/api/auth/me", headers={"Authorization": "Bearer " + old_access}).status_code
        == 401
    )


def test_logout_revokes_everything(client, fresh_user):
    name, _ = fresh_user
    body = login(client, name, "pw-" + "x" * 16).json()
    h = {"Authorization": "Bearer " + body["access_token"]}

    r = client.post("/api/auth/logout", headers=h)
    assert r.status_code == 200

    assert client.get("/api/auth/me", headers=h).status_code == 401
    r = client.post("/api/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 401


def test_password_change_revokes_tokens(client, fresh_user):
    name, _ = fresh_user
    pw = "pw-" + "x" * 16
    body = login(client, name, pw).json()
    h = {"Authorization": "Bearer " + body["access_token"], "Content-Type": "application/json"}

    r = client.put("/api/auth/password", headers=h, json={"current_password": pw, "new_password": "pw-" + "y" * 16})
    assert r.status_code == 200

    assert client.get("/api/auth/me", headers=h).status_code == 401
    r = client.post("/api/auth/refresh", json={"refresh_token": body["refresh_token"]})
    assert r.status_code == 401


def test_nonexistent_user_token_rejected(client):
    import time

    token = craft(
        {
            "sub": "999999",
            "type": "access",
            "ver": 1,
            "iat": time.time(),
            "exp": time.time() + 3600,
        }
    )
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer " + token})
    assert r.status_code == 401


def test_access_token_with_refresh_type_rejected(client, fresh_user):
    """A refresh token must not work as an access token."""
    name, _ = fresh_user
    body = login(client, name, "pw-" + "x" * 16).json()
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer " + body["refresh_token"]})
    assert r.status_code == 401
