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
    # M8-09: FKs must be enforced or ON DELETE CASCADE is decorative — without
    # this a deleted workflow leaves its runs behind.
    conn.execute("PRAGMA foreign_keys=ON")
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
    try:
        rows = conn.execute("SELECT * FROM workflows ORDER BY updated_at DESC").fetchall()
        out = []
        for row in rows:
            d = dict(row)
            # M8-15: counts travel with the row so the list never JSON-parses
            # blobs. M16-1: ONE corrupt row must not take the whole listing
            # down — counts go None and the row is flagged instead.
            try:
                d["node_count"] = len(parse_graph_field(d.get("nodes"), "nodes"))
                d["edge_count"] = len(parse_graph_field(d.get("edges"), "edges"))
                d["graph_corrupt"] = False
            except ValueError:
                d["node_count"] = None
                d["edge_count"] = None
                d["graph_corrupt"] = True
            out.append(d)
        return out
    finally:
        conn.close()  # M8-05: an exception must not leak a connection


async def get_workflow(workflow_id: str) -> dict | None:
    conn = _get_db()
    try:
        row = conn.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def parse_graph_field(raw, field: str) -> list:
    """M15-1: legacy rows hold SQL NULL graphs (pre-WI-5 verbatim writes).

    NULL (or a JSON 'null') normalizes to [] so the row is EDITABLE and
    RUNNABLE again (recovery, not a 500 wall); genuinely corrupt JSON raises
    ValueError (400/honest run failure) naming the field.
    """
    if raw is None:
        return []
    try:
        val = json.loads(raw)
    except (TypeError, ValueError):
        raise ValueError(f"'{field}' is not valid JSON (legacy row)")
    if val is None:
        return []
    if not isinstance(val, list):
        raise ValueError(f"'{field}' must be a list")
    return val


def _validated_graph(data: dict) -> tuple[list, list]:
    """M8-04 + M8-06 + M14-2: reject broken graphs at the door (400, not a dead run).

    nodes: list of mappings with unique non-empty string ids.
    edges: list of mappings with id/source/target non-empty strings pointing
    at existing nodes; no self-loops, no duplicate pairs. None/non-lists are
    rejected (never persisted verbatim).
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
    pairs: set[tuple[str, str]] = set()
    for i, ev in enumerate(edges):
        if not isinstance(ev, dict):
            raise ValueError(f"edges[{i}] must be a mapping")
        for k in ("id", "source", "target"):
            if not isinstance(ev.get(k), str) or not ev[k]:
                raise ValueError(f"edges[{i}].{k} must be a non-empty string")
        for k in ("source", "target"):
            if ev[k] not in ids:
                raise ValueError(f"edges[{i}].{k} references unknown node '{ev[k]}'")
        # M14-2: a self-loop or duplicate pair reaches the run engine and dies
        # as a misleading "cycle" — it is invalid input, so reject it here.
        if ev["source"] == ev["target"]:
            raise ValueError(f"edges[{i}] is a self-loop on '{ev['source']}'")
        if (ev["source"], ev["target"]) in pairs:
            raise ValueError(
                f"edges[{i}] duplicates the pair {ev['source']}->{ev['target']}"
            )
        pairs.add((ev["source"], ev["target"]))
    # M15-3: edge ids must be unique (duplicates silently overwrote each other)
    edge_ids: set[str] = set()
    for i, ev in enumerate(edges):
        if ev["id"] in edge_ids:
            raise ValueError(f"edges[{i}] duplicates edge id '{ev['id']}'")
        edge_ids.add(ev["id"])
    # M15-2: a>=2 cycle (a->b->a) escaped validation and died at run time as a
    # misleading engine error — reject it here (Kahn's algorithm)
    indeg = {n_id: 0 for n_id in ids}
    adj: dict[str, list[str]] = {n_id: [] for n_id in ids}
    for ev in edges:
        adj[ev["source"]].append(ev["target"])
        indeg[ev["target"]] += 1
    queue = [n_id for n_id, d in indeg.items() if d == 0]
    seen = 0
    while queue:
        nid = queue.pop()
        seen += 1
        for nxt in adj[nid]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    if seen != len(ids):
        raise ValueError("edges form a cycle")
    return nodes, edges


async def create_workflow(data: dict) -> dict:
    nodes, edges = _validated_graph(data)
    now = datetime.now(timezone.utc).isoformat()
    wf_id = f"wf_{uuid.uuid4().hex[:8]}"
    conn = _get_db()
    try:
        conn.execute(
            "INSERT INTO workflows (id, name, description, nodes, edges, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (wf_id, data.get("name") or "Untitled", data.get("description") or "",
             json.dumps(nodes), json.dumps(edges), now, now)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM workflows WHERE id = ?", (wf_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


async def update_workflow(workflow_id: str, data: dict) -> dict | None:
    now = datetime.now(timezone.utc).isoformat()
    conn = _get_db()
    try:
        existing = conn.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
        if not existing:
            return None

        nodes = data.get("nodes")
        edges = data.get("edges")
        # M8-04: explicit null/non-list = 400. M14-1: when only ONE side of the
        # graph is sent, validate the MERGED result — a nodes-only update must
        # not silently leave the old edges dangling against the new nodes.
        if "nodes" in data or "edges" in data:
            if "nodes" in data and not isinstance(nodes, list):
                raise ValueError("'nodes' must be a list")
            if "edges" in data and not isinstance(edges, list):
                raise ValueError("'edges' must be a list")
            merged_nodes = nodes if "nodes" in data else parse_graph_field(existing["nodes"], "nodes")
            merged_edges = edges if "edges" in data else parse_graph_field(existing["edges"], "edges")
            _validated_graph({"nodes": merged_nodes, "edges": merged_edges})
        else:
            merged_nodes = parse_graph_field(existing["nodes"], "nodes")
            merged_edges = parse_graph_field(existing["edges"], "edges")

        conn.execute(
            "UPDATE workflows SET name=?, description=?, nodes=?, edges=?, updated_at=? WHERE id=?",
            (
                data.get("name") or existing["name"],
                data.get("description", existing["description"]),
                json.dumps(merged_nodes),
                json.dumps(merged_edges),
                now,
                workflow_id,
            )
        )
        conn.commit()
        row = conn.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


async def delete_workflow(workflow_id: str) -> bool:
    conn = _get_db()
    try:
        result = conn.execute("DELETE FROM workflows WHERE id = ?", (workflow_id,))
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()
