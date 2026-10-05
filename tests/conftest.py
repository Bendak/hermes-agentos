"""Canonical test suite for AgentOS.

Runs entirely against an isolated sandbox: a throwaway data dir with throwaway
databases. No real users, workspaces, cron jobs or config files are ever read
or written.

IMPORTANT: the sandbox environment is pinned at conftest import time — BEFORE
any ``backend.*`` import — because backend modules resolve paths at import
time (the pydantic-settings singleton, ``auth.DB_PATH``, ``tasks.DB_PATH``).
pytest always imports conftest.py before test modules, so this ordering is
guaranteed as long as no test imports backend at module scope above the
fixtures it needs.
"""

import os
import pathlib
import sys
import tempfile

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT))

# ── sandbox environment (must precede backend imports) ──────────────────────
SANDBOX = tempfile.mkdtemp(prefix="agentos-tests-")
os.environ["AGENTOS_DATA_DIR"] = SANDBOX
os.environ["AGENTOS_DB"] = os.path.join(SANDBOX, "auth.db")
os.environ["AGENTOS_JWT_SECRET"] = "test-only-secret-not-real"
os.environ["AGENTOS_WORKSPACE_ROOTS"] = os.path.join(SANDBOX, "wsroot")
os.environ["AGENTOS_PROFILES_DIR"] = os.path.join(SANDBOX, "profiles")
os.environ["AGENTOS_CRON_HOME"] = SANDBOX
os.makedirs(os.environ["AGENTOS_WORKSPACE_ROOTS"], exist_ok=True)

import backend.auth as auth  # noqa: E402  (env must be set first)


# ── kanban schema bootstrap ────────────────────────────────────────────────
# The API's own CREATE TABLE (backend/tasks.py) is a SUBSET of the real
# Hermes kanban schema and later queries reference columns it lacks
# (e.g. task_runs.metadata). The sandbox therefore starts from the real
# schema so the suite exercises production-shaped tables.
_KANBAN_SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id                   TEXT PRIMARY KEY,
    title                TEXT NOT NULL,
    body                 TEXT,
    assignee             TEXT,
    status               TEXT NOT NULL,
    priority             INTEGER DEFAULT 0,
    created_by           TEXT,
    created_at           INTEGER NOT NULL,
    started_at           INTEGER,
    completed_at         INTEGER,
    workspace_kind       TEXT NOT NULL DEFAULT 'scratch',
    workspace_path       TEXT,
    branch_name          TEXT,
    claim_lock           TEXT,
    claim_expires        INTEGER,
    tenant               TEXT,
    result               TEXT,
    idempotency_key      TEXT,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    worker_pid           INTEGER,
    last_failure_error   TEXT,
    max_runtime_seconds  INTEGER,
    last_heartbeat_at    INTEGER,
    current_run_id       INTEGER,
    workflow_template_id TEXT,
    current_step_key     TEXT,
    skills               TEXT,
    model_override       TEXT,
    max_retries          INTEGER,
    session_id           TEXT,
    goal_mode            INTEGER NOT NULL DEFAULT 0,
    goal_max_turns       INTEGER,
    project_id           TEXT,
    block_kind           TEXT,
    block_recurrences    INTEGER NOT NULL DEFAULT 0,
    provider_override    TEXT,
    reasoning_effort     TEXT,
    completion_contract  TEXT,
    worker_started_at    INTEGER
);
CREATE TABLE IF NOT EXISTS task_runs (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id             TEXT NOT NULL,
    profile             TEXT,
    step_key            TEXT,
    status              TEXT NOT NULL,
    claim_lock          TEXT,
    claim_expires       INTEGER,
    worker_pid          INTEGER,
    max_runtime_seconds INTEGER,
    last_heartbeat_at   INTEGER,
    started_at          INTEGER NOT NULL,
    ended_at            INTEGER,
    outcome             TEXT,
    summary             TEXT,
    metadata            TEXT,
    error               TEXT,
    worker_started_at   INTEGER
);
"""

import sqlite3  # noqa: E402

_conn = sqlite3.connect(os.path.join(SANDBOX, "kanban.db"))
_conn.executescript(_KANBAN_SCHEMA)
_conn.commit()
_conn.close()

# minimal config.yaml so the config viewer endpoints have something to read
# (the /api/config handler answers 404 when the file is missing)
with open(os.path.join(SANDBOX, "config.yaml"), "w") as _f:
    _f.write(
        "model:\n"
        "  default: test-model\n"
        "agents: []\n"
    )


@pytest.fixture(scope="session")
def sandbox():
    return pathlib.Path(SANDBOX)


@pytest.fixture(scope="session")
def wsroot():
    """Allowlist root for workspace_path validation (see tasks._validate_workspace_path)."""
    return pathlib.Path(os.environ["AGENTOS_WORKSPACE_ROOTS"])


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient

    from backend.main import app

    return TestClient(app)


@pytest.fixture(scope="session")
def users():
    """Real users in the sandbox auth DB. create_user hashes the password
    internally — pass the raw password, never a precomputed hash."""
    auth.create_user("zz_admin", "pw-admin-" + "x" * 12, "admin")
    auth.create_user("zz_viewer", "pw-viewer-" + "x" * 12, "viewer")
    return {
        "admin": auth.get_user_by_username("zz_admin"),
        "viewer": auth.get_user_by_username("zz_viewer"),
    }


def _headers(user) -> dict:
    token = auth.create_access_token(user["id"], user["role"])
    return {"Authorization": "Bearer " + token, "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def admin_headers(users):
    return _headers(users["admin"])


@pytest.fixture(scope="session")
def viewer_headers(users):
    return _headers(users["viewer"])


@pytest.fixture()
def make_task(client, admin_headers, wsroot):
    """Factory: create a kanban task whose workspace lives inside the
    allowlist root, with the given files written to it. Cleans the DB row up
    afterwards (the API has no DELETE for tasks)."""
    import shutil
    import sqlite3

    created = []

    def _make(files: dict | None = None, title: str = "zz-suite-task") -> dict:
        import uuid

        ws = wsroot / f"ws-{uuid.uuid4().hex[:8]}"
        ws.mkdir(parents=True, exist_ok=True)
        for name, content in (files or {}).items():
            (ws / name).write_text(content)
        r = client.post(
            "/api/tasks",
            json={"title": title, "workspace_path": str(ws)},
            headers=admin_headers,
        )
        assert r.status_code in (200, 201), r.text
        task = r.json()
        created.append((task["id"], ws))
        return task

    yield _make

    conn = sqlite3.connect(os.path.join(SANDBOX, "kanban.db"))
    for task_id, ws in created:
        conn.execute("DELETE FROM tasks WHERE id=?", (task_id,))
        shutil.rmtree(ws, ignore_errors=True)
    conn.commit()
    conn.close()
