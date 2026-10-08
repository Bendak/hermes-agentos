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


def test_refresh_rotation_single_use_under_concurrency(client, fresh_user):
    """N1 regression: N concurrent refreshes with ONE token — exactly one 200.

    verify_and_rotate_refresh does a CAS (UPDATE ... WHERE refresh_jti = old),
    so a single caller wins; every loser is treated as a replay and the
    family is revoked."""
    import threading

    name, _ = fresh_user
    body = login(client, name, "pw-" + "x" * 16).json()
    refresh = body["refresh_token"]

    codes = []

    def go():
        r = client.post("/api/auth/refresh", json={"refresh_token": refresh})
        codes.append(r.status_code)

    threads = [threading.Thread(target=go) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert codes.count(200) == 1, f"winners={codes.count(200)} codes={codes}"
    assert codes.count(401) == 7, f"codes={codes}"


# ── issue #1 (gates): token role claims are the authority ──────────────


def _auth_with(token):
    """Build a minimal Starlette Request carrying the bearer token."""
    import asyncio
    from starlette.requests import Request

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(b"authorization", f"Bearer {token}".encode())],
    }
    return asyncio.run(auth.require_auth(Request(scope)))


def test_claimed_viewer_token_does_not_escalate_to_db_admin(users):
    """A down-scoped token minted with role='viewer' for an ADMIN user
    must act as viewer (the exact path of the issue #1 incident)."""
    adm = auth.get_user_by_username("zz_admin")
    tok = auth.create_access_token(adm["id"], "viewer")
    user = _auth_with(tok)
    assert user["role"] == "viewer"


def test_db_demotion_downgrades_outstanding_admin_token(users):
    """Admin requires BOTH the claim and the current DB role: if the DB
    says non-admin, an old admin token is downgraded immediately."""
    viewer = auth.get_user_by_username("zz_viewer")
    tok = auth.create_access_token(viewer["id"], "admin")
    user = _auth_with(tok)
    assert user["role"] == "viewer"


def test_matching_admin_claim_stays_admin(users):
    adm = auth.get_user_by_username("zz_admin")
    tok = auth.create_access_token(adm["id"], "admin")
    user = _auth_with(tok)
    assert user["role"] == "admin"
