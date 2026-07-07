import os
import json
import sqlite3
import uuid
from datetime import datetime, timezone

from backend.config import settings


DB_PATH = os.path.join(settings.AGENTOS_DATA_DIR, "agentos.db")


def _get_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db():
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS workflows (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            nodes TEXT DEFAULT '[]',
            edges TEXT DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    conn.commit()
    conn.close()


# Initialize on import
_init_db()


async def list_workflows() -> list[dict]:
    conn = _get_db()
    rows = conn.execute("SELECT * FROM workflows ORDER BY updated_at DESC").fetchall()
    conn.close()
    return [dict(row) for row in rows]


async def get_workflow(workflow_id: str) -> dict | None:
    conn = _get_db()
    row = conn.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


async def create_workflow(data: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    wf_id = f"wf_{uuid.uuid4().hex[:8]}"
    conn = _get_db()
    conn.execute(
        "INSERT INTO workflows (id, name, description, nodes, edges, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (wf_id, data.get("name", "Untitled"), data.get("description", ""),
         json.dumps(data.get("nodes", [])), json.dumps(data.get("edges", [])), now, now)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM workflows WHERE id = ?", (wf_id,)).fetchone()
    conn.close()
    return dict(row)


async def update_workflow(workflow_id: str, data: dict) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    existing = conn.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
    if not existing:
        conn.close()
        return None

    conn.execute(
        "UPDATE workflows SET name=?, description=?, nodes=?, edges=?, updated_at=? WHERE id=?",
        (
            data.get("name", existing["name"]),
            data.get("description", existing["description"]),
            json.dumps(data.get("nodes", json.loads(existing["nodes"]))),
            json.dumps(data.get("edges", json.loads(existing["edges"]))),
            now,
            workflow_id,
        )
    )
    conn.commit()
    row = conn.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
    conn.close()
    return dict(row)


async def delete_workflow(workflow_id: str) -> bool:
    conn = _get_db()
    result = conn.execute("DELETE FROM workflows WHERE id = ?", (workflow_id,))
    conn.commit()
    conn.close()
    return result.rowcount > 0
