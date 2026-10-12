"""WI-12: fresh-install schema — the tasks.py CREATE must match the real
Hermes kanban.db schema (a subset CREATE broke fresh installs at runtime),
and old subset DBs must be migrated by ALTER."""

import asyncio
import sqlite3

import backend.tasks as tasks_mod


ALL_TASK_COLS = {
    "id", "title", "body", "assignee", "status", "priority", "created_by",
    "created_at", "started_at", "completed_at", "workspace_kind",
    "workspace_path", "branch_name", "claim_lock", "claim_expires", "tenant",
    "result", "idempotency_key", "consecutive_failures", "worker_pid",
    "last_failure_error", "max_runtime_seconds", "last_heartbeat_at",
    "current_run_id", "workflow_template_id", "current_step_key", "skills",
    "model_override", "max_retries", "session_id", "goal_mode",
    "goal_max_turns", "project_id", "block_kind", "block_recurrences",
    "provider_override", "reasoning_effort", "completion_contract",
    "worker_started_at",
}

ALL_RUN_COLS = {
    "id", "task_id", "profile", "step_key", "status", "claim_lock",
    "claim_expires", "worker_pid", "max_runtime_seconds", "last_heartbeat_at",
    "started_at", "ended_at", "outcome", "summary", "metadata", "error",
    "worker_started_at",
}


def _cols(db_path: str, table: str) -> set[str]:
    db = sqlite3.connect(db_path)
    out = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
    db.close()
    return out


def test_fresh_db_gets_canonical_schema(tmp_path, monkeypatch):
    """WI-12: fresh install → schema canônico (todas as 37 colunas)."""
    db_path = str(tmp_path / "kanban.db")
    monkeypatch.setattr(tasks_mod, "DB_PATH", db_path)

    task = asyncio.run(tasks_mod.create_task(
        title="zz", body="b", assignee="coder", created_by="test",
    ))
    assert task["id"]

    got = _cols(db_path, "tasks")
    missing = ALL_TASK_COLS - got
    assert not missing, f"WI-12: fresh schema ainda é subset — faltando {sorted(missing)}"
    got = _cols(db_path, "task_runs")
    missing = ALL_RUN_COLS - got
    assert not missing, f"WI-12: task_runs subset — faltando {sorted(missing)}"

    # queries que dependem das colunas novas funcionam no db fresh
    r = asyncio.run(tasks_mod.update_task_status(task["id"], "running", actor="t"))
    assert r["status"] == "running"


def test_subset_db_is_migrated_by_alter(tmp_path, monkeypatch):
    """WI-12: db criado pelo schema antigo ganha as colunas faltantes."""
    db_path = str(tmp_path / "old.db")
    db = sqlite3.connect(db_path)
    db.execute(
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT,"
        " assignee TEXT, status TEXT NOT NULL DEFAULT 'todo', priority INTEGER DEFAULT 2,"
        " created_by TEXT, created_at INTEGER, started_at INTEGER, completed_at INTEGER,"
        " workspace_kind TEXT, workspace_path TEXT, session_id TEXT, project_id TEXT)"
    )
    db.execute(
        "CREATE TABLE task_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,"
        " profile TEXT, step_key TEXT, status TEXT, started_at INTEGER, ended_at INTEGER,"
        " outcome TEXT, summary TEXT)"
    )
    db.execute("INSERT INTO tasks (id, title, status) VALUES ('t1', 'velho', 'todo')")
    db.commit()
    db.close()
    monkeypatch.setattr(tasks_mod, "DB_PATH", db_path)

    # o init/migração roda no primeiro create_task (caminho de escrita)
    novo = asyncio.run(tasks_mod.create_task(title="novo", created_by="t"))
    assert novo["id"]
    r = asyncio.run(tasks_mod.update_task_status("t1", "running", actor="t"))
    assert r["status"] == "running"
    got = _cols(db_path, "tasks")
    missing = ALL_TASK_COLS - got
    assert not missing, f"WI-12: migração não completou — faltando {sorted(missing)}"
