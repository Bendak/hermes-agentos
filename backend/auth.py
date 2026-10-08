"""Authentication module for AgentOS.

Multi-user ready, single-user for now. Uses stdlib only (no extra deps).
JWT tokens implemented with hmac + base64 + json.
Password hashing with hashlib.pbkdf2_hmac.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import Depends, HTTPException, Request

# ── Constants ────────────────────────────────────────────────────────

DB_PATH = os.environ.get("AGENTOS_DB", "/opt/data/agentos/agentos.db")
SALT_BYTES = 16
PBKDF2_ITERATIONS = 100_000
ACCESS_TOKEN_EXPIRY = timedelta(hours=24)
REFRESH_TOKEN_EXPIRY = timedelta(days=7)
JWT_ALGORITHM = "HS256"

# ── Database helpers ─────────────────────────────────────────────────

def _get_db() -> sqlite3.Connection:
    """Open a synchronous SQLite connection."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _init_db() -> None:
    """Create users table and config table if they don't exist."""
    conn = _get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'viewer',
                created_at TEXT NOT NULL,
                token_version INTEGER NOT NULL DEFAULT 1,
                refresh_jti TEXT
            )
        """)
        # migrations for tables created before these columns existed
        for ddl in (
            "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE users ADD COLUMN refresh_jti TEXT",
        ):
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        conn.commit()
    finally:
        conn.close()


# ── JWT Secret ───────────────────────────────────────────────────────

_jwt_secret_cache: Optional[str] = None


def get_jwt_secret() -> str:
    """Get JWT secret from env or generate and persist one."""
    global _jwt_secret_cache
    if _jwt_secret_cache:
        return _jwt_secret_cache

    env_secret = os.environ.get("AGENTOS_JWT_SECRET")
    if env_secret:
        _jwt_secret_cache = env_secret
        return env_secret

    # Ensure tables exist
    _init_db()

    # Try to read from DB
    conn = _get_db()
    try:
        row = conn.execute(
            "SELECT value FROM app_config WHERE key = 'jwt_secret'"
        ).fetchone()
        if row:
            _jwt_secret_cache = row["value"]
            return _jwt_secret_cache

        # Generate new secret and store
        secret = secrets.token_urlsafe(48)
        conn.execute(
            "INSERT INTO app_config (key, value) VALUES ('jwt_secret', ?)",
            (secret,),
        )
        conn.commit()
        _jwt_secret_cache = secret
        return secret
    finally:
        conn.close()


# ── Password hashing (stdlib only) ──────────────────────────────────

def hash_password(password: str) -> str:
    """Hash a password with PBKDF2-HMAC-SHA256. Returns salt:hash (hex)."""
    salt = os.urandom(SALT_BYTES)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex() + ":" + dk.hex()


def verify_password(password: str, stored_hash: str) -> bool:
    """Verify a password against a stored salt:hash."""
    try:
        salt_hex, dk_hex = stored_hash.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
        return hmac.compare_digest(dk.hex(), dk_hex)
    except (ValueError, AttributeError):
        return False


# ── JWT implementation (stdlib only) ────────────────────────────────

def _b64_encode(data: bytes) -> str:
    return urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64_decode(s: str) -> bytes:
    padding = 4 - len(s) % 4
    if padding != 4:
        s += "=" * padding
    return urlsafe_b64decode(s)


def _create_token(payload: dict, secret: str) -> str:
    """Create a JWT token (HS256)."""
    header = _b64_encode(json.dumps({"alg": JWT_ALGORITHM, "typ": "JWT"}).encode())
    body = _b64_encode(json.dumps(payload).encode())
    signing_input = f"{header}.{body}"
    signature = _b64_encode(
        hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    )
    return f"{signing_input}.{signature}"


def _decode_token(token: str, secret: str) -> dict:
    """Decode and verify a JWT token. Returns payload or raises ValueError."""
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid token format")

    header_b64, body_b64, sig_b64 = parts
    signing_input = f"{header_b64}.{body_b64}"
    expected_sig = _b64_encode(
        hmac.new(secret.encode(), signing_input.encode(), hashlib.sha256).digest()
    )
    if not hmac.compare_digest(sig_b64, expected_sig):
        raise ValueError("Invalid token signature")

    payload = json.loads(_b64_decode(body_b64))

    # Strict claims: a token WITHOUT exp must never be accepted (F-M1-10).
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)):
        raise ValueError("Token missing expiry")
    if datetime.now(timezone.utc).timestamp() > exp:
        raise ValueError("Token expired")
    try:
        int(payload.get("sub"))
    except (TypeError, ValueError):
        raise ValueError("Invalid token subject")
    if payload.get("type") not in ("access", "refresh"):
        raise ValueError("Invalid token type")

    return payload


def create_access_token(user_id: int, role: str, ver: Optional[int] = None) -> str:
    """Create a short-lived access token carrying the user's token_version claim."""
    if ver is None:
        user = get_user_by_id(int(user_id))
        ver = (user or {}).get("token_version", 1)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "ver": int(ver),
        "iat": now.timestamp(),
        "exp": (now + ACCESS_TOKEN_EXPIRY).timestamp(),
    }
    return _create_token(payload, get_jwt_secret())


def create_refresh_token(user_id: int) -> str:
    """Create a long-lived refresh token and rotate the stored jti.

    Only the latest issued refresh token stays valid (users.refresh_jti); older
    ones become replay evidence in verify_and_rotate_refresh()."""
    user = get_user_by_id(int(user_id))
    ver = (user or {}).get("token_version", 1)
    jti = secrets.token_urlsafe(16)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "ver": int(ver),
        "jti": jti,
        "iat": now.timestamp(),
        "exp": (now + REFRESH_TOKEN_EXPIRY).timestamp(),
    }
    token = _create_token(payload, get_jwt_secret())
    conn = _get_db()
    try:
        conn.execute(
            "UPDATE users SET refresh_jti = ? WHERE id = ?", (jti, int(user_id))
        )
        conn.commit()
    finally:
        conn.close()
    return token


def verify_token(token: str) -> dict:
    """Verify a JWT token. Returns payload or raises."""
    return _decode_token(token, get_jwt_secret())


# ── User CRUD ────────────────────────────────────────────────────────

def get_user_by_username(username: str) -> Optional[dict]:
    conn = _get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: int) -> Optional[dict]:
    conn = _get_db()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def create_user(username: str, password: str, role: str = "viewer") -> dict:
    """Create a new user. Returns user dict or raises."""
    _init_db()
    now = datetime.now(timezone.utc).isoformat()
    pw_hash = hash_password(password)
    conn = _get_db()
    try:
        cursor = conn.execute(
            "INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, ?)",
            (username, pw_hash, role, now),
        )
        conn.commit()
        return {
            "id": cursor.lastrowid,
            "username": username,
            "role": role,
            "created_at": now,
        }
    except sqlite3.IntegrityError:
        raise ValueError(f"Username '{username}' already exists")
    finally:
        conn.close()


def users_exist() -> bool:
    """Check if any users exist in the database."""
    _init_db()
    conn = _get_db()
    try:
        row = conn.execute("SELECT COUNT(*) as cnt FROM users").fetchone()
        return row["cnt"] > 0
    finally:
        conn.close()


# ── FastAPI Dependencies ─────────────────────────────────────────────

async def require_auth(request: Request) -> dict:
    """FastAPI dependency: verify Authorization header or query param, return user payload.

    Supports two auth methods:
    1. Authorization: Bearer <token> (standard, used by fetch interceptor)
    2. ?token=<token> query param (for media elements like <video src=...> that can't set headers)
    """
    # Authorization header only. F-M4-08: the old ?token= query-param fallback
    # leaked credentials via logs/referrers/history — media elements now load
    # bytes through authenticated fetch + blob object URLs instead.
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    else:
        token = ""

    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    try:
        payload = verify_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    try:
        user = get_user_by_id(int(payload["sub"]))
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token subject")
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if payload.get("ver") != user["token_version"]:
        raise HTTPException(status_code=401, detail="Token revoked")

    # Issue #1 (gates): the token's role claim is the authority — a
    # down-scoped ("viewer") token must never act as the user's full DB
    # role. The DB can only DOWNGRADE: a demotion takes effect immediately
    # even on outstanding tokens (admin requires BOTH the claim and the
    # current DB role).
    claimed = payload.get("role")
    role = claimed or user["role"]
    if user["role"] != "admin" and role == "admin":
        role = user["role"]
    return {"user_id": user["id"], "username": user["username"], "role": role}


async def require_admin(user: dict = Depends(require_auth)) -> dict:
    """FastAPI dependency: require admin role."""
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Extended User CRUD ───────────────────────────────────────────────

def list_all_users() -> list[dict]:
    """List all users (id, username, role, created_at). Excludes password_hash."""
    conn = _get_db()
    try:
        rows = conn.execute(
            "SELECT id, username, role, created_at FROM users ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def update_user_password(user_id: int, new_password: str) -> bool:
    """Update a user's password. Returns True if user existed."""
    pw_hash = hash_password(new_password)
    conn = _get_db()
    try:
        cursor = conn.execute(
            "UPDATE users SET password_hash = ?, "
            "token_version = token_version + 1, refresh_jti = NULL WHERE id = ?",
            (pw_hash, user_id),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def delete_user(user_id: int) -> bool:
    """Delete a user by ID. Returns True if user existed."""
    conn = _get_db()
    try:
        cursor = conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


# ── Token revocation & refresh rotation (WI-3) ───────────────────────

def bump_token_version(user_id: int) -> bool:
    """Invalidate every outstanding token for a user (server-side logout)."""
    conn = _get_db()
    try:
        cursor = conn.execute(
            "UPDATE users SET token_version = token_version + 1, "
            "refresh_jti = NULL WHERE id = ?",
            (user_id,),
        )
        conn.commit()
        return cursor.rowcount > 0
    finally:
        conn.close()


def verify_and_rotate_refresh(token: str) -> tuple[dict, str]:
    """Validate a refresh token and rotate its jti ATOMICALLY (CAS).

    Returns (user, new_refresh_token). Raises ValueError on any failure.

    N1: the check-and-swap is a single conditional UPDATE (refresh_jti must
    still equal the presented jti), so exactly ONE concurrent caller can
    rotate a given token. A CAS miss is indistinguishable from a replay —
    the whole family is revoked via token_version bump (strict single-use
    rotation with reuse detection; a losing concurrent tab must log in
    again)."""
    payload = _decode_token(token, get_jwt_secret())
    if payload.get("type") != "refresh":
        raise ValueError("Invalid token type")
    try:
        uid = int(payload["sub"])
    except (TypeError, ValueError):
        raise ValueError("Invalid token subject")
    user = get_user_by_id(uid)
    if not user:
        raise ValueError("User not found")
    if payload.get("ver") != user["token_version"]:
        raise ValueError("Token revoked")
    old_jti = payload.get("jti")
    if not old_jti:
        raise ValueError("Invalid refresh token")

    new_jti = secrets.token_urlsafe(16)
    conn = _get_db()
    try:
        cursor = conn.execute(
            "UPDATE users SET refresh_jti = ? WHERE id = ? AND refresh_jti = ?",
            (new_jti, user["id"], old_jti),
        )
        conn.commit()
        swapped = cursor.rowcount == 1
    finally:
        conn.close()

    if not swapped:
        # CAS miss: replayed token or a concurrent rotation won the race.
        bump_token_version(user["id"])
        raise ValueError("Refresh token reused; all sessions revoked")

    now = datetime.now(timezone.utc)
    new_payload = {
        "sub": str(user["id"]),
        "type": "refresh",
        "ver": user["token_version"],
        "jti": new_jti,
        "iat": now.timestamp(),
        "exp": (now + REFRESH_TOKEN_EXPIRY).timestamp(),
    }
    return user, _create_token(new_payload, get_jwt_secret())
