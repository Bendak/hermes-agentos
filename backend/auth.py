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
                role TEXT NOT NULL DEFAULT 'admin',
                created_at TEXT NOT NULL
            )
        """)
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

    # Check expiry
    exp = payload.get("exp")
    if exp and datetime.now(timezone.utc).timestamp() > exp:
        raise ValueError("Token expired")

    return payload


def create_access_token(user_id: int, role: str) -> str:
    """Create a short-lived access token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "role": role,
        "type": "access",
        "iat": now.timestamp(),
        "exp": (now + ACCESS_TOKEN_EXPIRY).timestamp(),
    }
    return _create_token(payload, get_jwt_secret())


def create_refresh_token(user_id: int) -> str:
    """Create a long-lived refresh token."""
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "iat": now.timestamp(),
        "exp": (now + REFRESH_TOKEN_EXPIRY).timestamp(),
    }
    return _create_token(payload, get_jwt_secret())


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


def create_user(username: str, password: str, role: str = "admin") -> dict:
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
    """FastAPI dependency: verify Authorization header, return user payload."""
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")

    token = auth_header[7:]
    try:
        payload = verify_token(token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user = get_user_by_id(int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return {"user_id": user["id"], "username": user["username"], "role": user["role"]}


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
            "UPDATE users SET password_hash = ? WHERE id = ?",
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
