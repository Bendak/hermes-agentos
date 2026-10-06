"""Authorization matrix (WI-2): mutations require admin, reads require auth.

Contract:
- viewer: GET -> 200, mutations -> 403 (self-service password never 403)
- admin: mutations pass the gate (payload validation may still answer 4xx)

Uses REAL tokens minted against the sandbox auth DB — no dependency
overrides — so the whole auth path (decode -> user lookup -> role) is what
actually runs.
"""

import pytest

import backend.cron as cron_mod

READS = [
    ("GET", "/api/tasks"),
    ("GET", "/api/config"),
    ("GET", "/api/workflows"),
    pytest.param(
        "GET",
        "/api/cron",
        marks=pytest.mark.skipif(
            not cron_mod.HAVE_STORE,
            reason="cron endpoints answer 503 without the Hermes store",
        ),
    ),
    ("GET", "/api/profiles"),
]

MUTATIONS = [
    ("POST", "/api/tasks"),
    ("PATCH", "/api/tasks/zz"),
    ("POST", "/api/tasks/zz/comments"),
    ("POST", "/api/tasks/bulk"),
    ("PATCH", "/api/config"),
    ("POST", "/api/workflows"),
    ("PUT", "/api/workflows/zz"),
    ("DELETE", "/api/workflows/zz"),
    ("POST", "/api/workflows/zz/run"),
    ("POST", "/api/cron"),
    ("PUT", "/api/cron/zz"),
    ("DELETE", "/api/cron/zz"),
    ("POST", "/api/cron/zz/run"),
    ("POST", "/api/cron/zz/pause"),
    ("POST", "/api/cron/zz/resume"),
    ("POST", "/api/profiles"),
    ("PUT", "/api/profiles/zz"),
    ("DELETE", "/api/profiles/zz"),
    ("POST", "/api/profiles/zz/duplicate"),
    ("PUT", "/api/profiles/zz/soul"),
    ("POST", "/api/auth/register"),
]


def call(client, method, path, headers, body=None):
    return client.request(method, path, headers=headers, json=body or {})


@pytest.mark.parametrize("method,path", READS)
def test_viewer_can_read(client, viewer_headers, method, path):
    assert call(client, method, path, viewer_headers).status_code == 200


@pytest.mark.parametrize("method,path", MUTATIONS)
def test_viewer_cannot_mutate(client, viewer_headers, method, path):
    assert call(client, method, path, viewer_headers).status_code == 403


@pytest.mark.parametrize("method,path", MUTATIONS)
def test_admin_passes_gate(client, admin_headers, method, path):
    # 4xx from payload validation is fine — what matters is the gate does not
    # answer 401/403 to a valid admin token.
    assert call(client, method, path, admin_headers).status_code not in (401, 403)


def test_register_first_is_bootstrap_only(client, admin_headers):
    """POST /api/auth/register-first only works on a pristine install; once
    users exist it must refuse regardless of role (bootstrap semantics)."""
    r = call(client, "POST", "/api/auth/register-first", admin_headers, {})
    assert r.status_code in (400, 403)


def test_viewer_self_password_not_blocked(client, viewer_headers):
    # Self-service password change must be available to every authenticated
    # user (it validates the current password itself).
    r = call(client, "PUT", "/api/auth/password", viewer_headers, {})
    assert r.status_code in (200, 400, 422)


def test_no_token_is_401_everywhere(client):
    for entry in READS + MUTATIONS:
        method, path = getattr(entry, "values", entry)  # unwrap pytest.param
        r = client.request(method, path, json={})
        assert r.status_code == 401, f"{method} {path} -> {r.status_code}"


def test_created_user_defaults_to_viewer(client, admin_headers):
    import backend.auth as auth

    r = call(
        client,
        "POST",
        "/api/auth/register",
        admin_headers,
        {"username": "zz_default_role", "password": "pw-" + "x" * 16},
    )
    assert r.status_code in (200, 201), r.text
    created = auth.get_user_by_username("zz_default_role")
    assert created is not None
    assert created["role"] == "viewer"
