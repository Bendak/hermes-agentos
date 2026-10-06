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


def _validated_graph(data: dict) -> tuple[list, list]:
    """M8-04 + M8-06: reject broken graphs at the door (400, not a dead run).

    nodes: list of mappings with unique non-empty string ids.
    edges: list of mappings with id/source/target non-empty strings pointing
    at existing nodes. None/non-lists are rejected (never persisted verbatim).
    """
    nodes = data.get("nodes")
    edges = data.get("edges")
    # presence-based: an ABSENT key is a legitimate default; an explicit
    # null/non-list is exactly the M8-04 payload that used to persist verbatim
    if "nodes" in data and not isinstance(nodes, list):
        raise ValueError("'nodes' must be a list")
    if "edges" in data and not isinstance(edges, list):
        raise ValueError("'edges' must be a list")
    nodes = nodes or []
    edges = edges or []
    ids: set[str] = set()
    for i, n in enumerate(nodes):
        if not isinstance(n, dict) or not isinstance(n.get("id"), str) or not n["id"]:
            raise ValueError(f"nodes[{i}].id must be a non-empty string")
        if n["id"] in ids:
            raise ValueError(f"duplicate node id: '{n['id']}'")
        ids.add(n["id"])
    for i, ev in enumerate(edges):
        if not isinstance(ev, dict):
            raise ValueError(f"edges[{i}] must be a mapping")
        for k in ("id", "source", "target"):
            if not isinstance(ev.get(k), str) or not ev[k]:
                raise ValueError(f"edges[{i}].{k} must be a non-empty string")
        for k in ("source", "target"):
            if ev[k] not in ids:
                raise ValueError(f"edges[{i}].{k} references unknown node '{ev[k]}'")
    return nodes, edges


async def create_workflow(data: dict) -> dict:
    nodes, edges = _validated_graph(data)
    now = datetime.now(timezone.utc).isoformat()
    wf_id = f"wf_{uuid.uuid4().hex[:8]}"
    conn = _get_db()
    conn.execute(
        "INSERT INTO workflows (id, name, description, nodes, edges, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        (wf_id, data.get("name", "Untitled"), data.get("description", ""),
         json.dumps(nodes), json.dumps(edges), now, now)
    )
    conn.commit()
    row = conn.execute("SELECT * FROM workflows WHERE id = ?", (wf_id,)).fetchone()
    conn.close()
    return dict(row)


async def update_workflow(workflow_id: str, data: dict) -> dict | None:
    # M8-04: validate BEFORE touching the DB — a bad payload must not persist
    nodes = data.get("nodes")
    edges = data.get("edges")
    if "nodes" in data or "edges" in data:
        _validated_graph(data)
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
            json.dumps(nodes if nodes is not None else json.loads(existing["nodes"])),
            json.dumps(edges if edges is not None else json.loads(existing["edges"])),
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
