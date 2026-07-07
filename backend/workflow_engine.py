import os
import json
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.config import settings


DB_PATH = os.path.join(settings.AGENTOS_DATA_DIR, "agentos.db")


def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_runs_table():
    conn = _get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS workflow_runs (
            id TEXT PRIMARY KEY,
            workflow_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            started_at TEXT NOT NULL,
            finished_at TEXT,
            result TEXT DEFAULT '{}',
            error TEXT,
            FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()


_init_runs_table()


def _build_graph(nodes: list[dict], edges: list[dict]) -> dict:
    """Build adjacency list and in-degree map from nodes and edges."""
    adj: dict[str, list[str]] = {n["id"]: [] for n in nodes}
    in_degree: dict[str, int] = {n["id"]: 0 for n in nodes}
    edge_map: dict[str, dict] = {}

    for e in edges:
        src = e.get("source", "")
        tgt = e.get("target", "")
        if src in adj and tgt in adj:
            adj[src].append(tgt)
            in_degree[tgt] += 1
            edge_map[e["id"]] = e

    return {"adj": adj, "in_degree": in_degree, "edge_map": edge_map}


def _topological_sort(nodes: list[dict], graph: dict) -> list[str]:
    """Topological sort of nodes — returns ordered list of node IDs."""
    in_degree = dict(graph["in_degree"])
    queue = [nid for nid, deg in in_degree.items() if deg == 0]
    order = []

    while queue:
        nid = queue.pop(0)
        order.append(nid)
        for neighbor in graph["adj"].get(nid, []):
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(order) != len(nodes):
        raise ValueError("Workflow contains a cycle")

    return order


def _execute_node(node: dict, context: dict) -> dict:
    """Execute a single node and return result."""
    data = node.get("data", {})
    node_type = data.get("nodeType", "action")
    label = data.get("label", "Unnamed")
    config = data.get("config", {})

    result = {
        "node_id": node["id"],
        "label": label,
        "node_type": node_type,
        "status": "completed",
        "output": {},
    }

    if node_type == "trigger":
        result["output"] = {"triggered": True, "trigger_type": config.get("type", "manual")}

    elif node_type == "condition":
        field = config.get("field", "")
        operator = config.get("operator", "equals")
        value = config.get("value", "")

        context_value = context.get(field, "")

        if operator == "equals":
            passed = str(context_value) == str(value)
        elif operator == "not_equals":
            passed = str(context_value) != str(value)
        elif operator == "contains":
            passed = str(value) in str(context_value)
        elif operator == "greater_than":
            try:
                passed = float(context_value) > float(value)
            except (ValueError, TypeError):
                passed = False
        elif operator == "less_than":
            try:
                passed = float(context_value) < float(value)
            except (ValueError, TypeError):
                passed = False
        else:
            passed = True

        result["output"] = {"condition": f"{field} {operator} {value}", "passed": passed}
        result["status"] = "completed" if passed else "skipped"

    elif node_type == "action":
        action_type = config.get("action_type", "log")

        if action_type == "log":
            message = config.get("message", f"Action '{label}' executed")
            result["output"] = {"action": "log", "message": message}

        elif action_type == "set_variable":
            var_name = config.get("variable", "")
            var_value = config.get("value", "")
            context[var_name] = var_value
            result["output"] = {"action": "set_variable", "variable": var_name, "value": var_value}

        elif action_type == "create_task":
            result["output"] = {
                "action": "create_task",
                "title": config.get("title", f"Task from {label}"),
                "assignee": config.get("assignee", "coder"),
                "status": "pending",
                "note": "Task creation requires kanban integration (Phase 12+)"
            }

        elif action_type == "http_request":
            result["output"] = {
                "action": "http_request",
                "url": config.get("url", ""),
                "method": config.get("method", "GET"),
                "note": "HTTP requests will be enabled in a future phase"
            }

        else:
            result["output"] = {"action": action_type, "note": "Unknown action type"}

    return result


async def run_workflow(workflow_id: str) -> dict:
    """Execute a workflow by walking its node graph."""
    conn = _get_db()

    row = conn.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
    if not row:
        conn.close()
        raise ValueError("Workflow not found")

    nodes = json.loads(row["nodes"])
    edges = json.loads(row["edges"])

    run_id = f"run_{uuid.uuid4().hex[:8]}"
    now = datetime.now(timezone.utc).isoformat()

    conn.execute(
        "INSERT INTO workflow_runs (id, workflow_id, status, started_at) VALUES (?, ?, ?, ?)",
        (run_id, workflow_id, "running", now)
    )
    conn.commit()
    conn.close()

    try:
        graph = _build_graph(nodes, edges)
        order = _topological_sort(nodes, graph)

        node_map = {n["id"]: n for n in nodes}

        context: dict[str, Any] = {}
        node_results: list[dict] = []
        skipped_set: set[str] = set()

        for node_id in order:
            node = node_map[node_id]
            result = _execute_node(node, context)
            node_results.append(result)

            if result["status"] == "skipped":
                skipped_set.add(node_id)
                for downstream_id in graph["adj"].get(node_id, []):
                    if downstream_id in node_map and downstream_id not in skipped_set:
                        skipped_set.add(downstream_id)
                        node_results.append({
                            "node_id": downstream_id,
                            "label": node_map[downstream_id].get("data", {}).get("label", ""),
                            "node_type": node_map[downstream_id].get("data", {}).get("nodeType", ""),
                            "status": "skipped",
                            "output": {"reason": "upstream condition failed"},
                        })

        finished_at = datetime.now(timezone.utc).isoformat()
        result_json = json.dumps({
            "node_results": node_results,
            "context": context,
            "total_nodes": len(nodes),
            "executed_nodes": len([r for r in node_results if r["status"] == "completed"]),
            "skipped_nodes": len([r for r in node_results if r["status"] == "skipped"]),
        })

        conn = _get_db()
        conn.execute(
            "UPDATE workflow_runs SET status=?, finished_at=?, result=? WHERE id=?",
            ("completed", finished_at, result_json, run_id)
        )
        conn.commit()
        conn.close()

        return {
            "run_id": run_id,
            "workflow_id": workflow_id,
            "status": "completed",
            "started_at": now,
            "finished_at": finished_at,
            "result": json.loads(result_json),
        }

    except Exception as e:
        finished_at = datetime.now(timezone.utc).isoformat()
        conn = _get_db()
        conn.execute(
            "UPDATE workflow_runs SET status=?, finished_at=?, error=? WHERE id=?",
            ("failed", finished_at, str(e), run_id)
        )
        conn.commit()
        conn.close()

        return {
            "run_id": run_id,
            "workflow_id": workflow_id,
            "status": "failed",
            "started_at": now,
            "finished_at": finished_at,
            "error": str(e),
        }


async def get_workflow_runs(workflow_id: str) -> list[dict]:
    """Get run history for a workflow."""
    conn = _get_db()
    rows = conn.execute(
        "SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50",
        (workflow_id,)
    ).fetchall()
    conn.close()

    results = []
    for row in rows:
        d = dict(row)
        if d.get("result"):
            d["result"] = json.loads(d["result"])
        results.append(d)

    return results


async def get_run_detail(run_id: str) -> dict | None:
    """Get detailed run result."""
    conn = _get_db()
    row = conn.execute("SELECT * FROM workflow_runs WHERE id = ?", (run_id,)).fetchone()
    conn.close()

    if not row:
        return None

    d = dict(row)
    if d.get("result"):
        d["result"] = json.loads(d["result"])
    return d
