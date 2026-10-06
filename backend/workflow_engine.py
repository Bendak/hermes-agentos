import os
import json
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from backend.config import settings


DB_PATH = os.path.join(settings.AGENTOS_DATA_DIR, "agentos.db")


class WorkflowNotFound(ValueError):
    """M16-3: not-found must be distinguishable from bad-graph by TYPE, not by
    comparing error strings (a rename silently flipped 404s into 400s)."""


def _timeout_int(raw: str | None, default: int = 1800) -> int:
    """M18-5: a garbage HERMES_AGENT_TIMEOUT must NOT make this module
    unimportable — a typo'd .env used to take the whole API down at import."""
    try:
        return int(raw) if raw else default
    except ValueError:
        import logging
        logging.getLogger(__name__).warning(
            "HERMES_AGENT_TIMEOUT=%r is not an integer — using %s", raw, default
        )
        return default


# M8-08: a 'running' row older than this is a ghost. M17-4: derive the gate
# from the REAL run timeout instead of a hardcoded constant justified by a
# comment — 4x HERMES_AGENT_TIMEOUT (default 1800s), floor 2h.
_STALE_RUN_SECONDS = max(2 * 3600, 4 * _timeout_int(os.environ.get("HERMES_AGENT_TIMEOUT")))


def _sweep_stale_runs(conn) -> None:
    """M8-08: runs stuck 'running'/'pending' across a restart are dead — mark
    them 'failed' (interrupted) instead of rendering a phantom forever."""
    cutoff = datetime.fromtimestamp(
        time.time() - _STALE_RUN_SECONDS, tz=timezone.utc
    ).isoformat()
    conn.execute(
        "UPDATE workflow_runs SET status='failed', finished_at=?, "
        "error='interrupted (stale running row)' "
        "WHERE status IN ('running', 'pending') AND started_at < ?",
        (datetime.now(timezone.utc).isoformat(), cutoff),
    )
    conn.commit()


def _get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")  # M8-09: cascade needs enforcement
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
            # M8-07: a stub no-op must not paint the run green
            result["status"] = "stub"
            result["output"] = {
                "action": "create_task",
                "title": config.get("title", f"Task from {label}"),
                "assignee": config.get("assignee", "coder"),
                "status": "pending",
                "note": "Task creation requires kanban integration (Phase 12+)"
            }

        elif action_type == "http_request":
            # M8-07: stub
            result["status"] = "stub"
            result["output"] = {
                "action": "http_request",
                "url": config.get("url", ""),
                "method": config.get("method", "GET"),
                "note": "HTTP requests will be enabled in a future phase"
            }

        else:
            # M8-07: unknown action = stub, not "completed"
            result["status"] = "stub"
            result["output"] = {"action": action_type, "note": "Unknown action type"}

    return result


async def run_workflow(workflow_id: str) -> dict:
    """Execute a workflow by walking its node graph."""
    conn = _get_db()

    row = conn.execute("SELECT * FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
    if not row:
        conn.close()
        raise WorkflowNotFound("Workflow not found")

    # M15-1: legacy NULL graphs normalize to [] (row is runnable again);
    # corrupt JSON raises ValueError naming the field, before any run row.
    from backend.workflows import parse_graph_field
    nodes = parse_graph_field(row["nodes"], "nodes")
    edges = parse_graph_field(row["edges"], "edges")

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
            # M8-01: a gated node must NEVER execute (side effects included) —
            # checking after execution let children run AND get a second entry.
            if node_id in skipped_set:
                continue
            node = node_map[node_id]
            result = _execute_node(node, context)
            node_results.append(result)

            if result["status"] == "skipped":
                skipped_set.add(node_id)
                # Q4-1: no true/false branch wiring exists in the editor yet, so
                # a failed condition gates its ENTIRE transitive downstream.
                # Each gated node gets exactly one 'skipped' entry (counts close).
                stack = list(graph["adj"].get(node_id, []))
                while stack:
                    down = stack.pop()
                    if down in node_map and down not in skipped_set:
                        skipped_set.add(down)
                        node_results.append({
                            "node_id": down,
                            "label": node_map[down].get("data", {}).get("label", ""),
                            "node_type": node_map[down].get("data", {}).get("nodeType", ""),
                            "status": "skipped",
                            "output": {"reason": "upstream condition failed"},
                        })
                        stack.extend(graph["adj"].get(down, []))

        finished_at = datetime.now(timezone.utc).isoformat()
        result_json = json.dumps({
            "node_results": node_results,
            "context": context,
            "total_nodes": len(node_results),
            "executed_nodes": sum(1 for r in node_results if r["status"] == "completed"),
            "skipped_nodes": sum(1 for r in node_results if r["status"] == "skipped"),
            "stub_nodes": sum(1 for r in node_results if r["status"] == "stub"),
            # M17-5: completed triggers are not 'work done' — the run-level
            # icon subtracts them (a trigger+stubs run must not read green)
            "trigger_nodes": sum(
                1 for r in node_results
                if r["status"] == "completed" and r.get("node_type") == "trigger"
            ),
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


def _parse_result(d: dict) -> None:
    """M19-2: corrupt run-result JSON is flagged, never a 500 (the M16-1
    sibling that survived batches 1-5 on the runs endpoints)."""
    raw = d.get("result")
    if not raw:
        return
    try:
        parsed = json.loads(raw)
    except (TypeError, ValueError):
        d["result"] = None
        d["result_corrupt"] = True
        return
    d["result"] = parsed
    _backfill_trigger_nodes(parsed)


def _backfill_trigger_nodes(result) -> None:
    """M18-1: legacy run rows predate the trigger_nodes counter — without it
    the front's ||0 fallback repaints old trigger+skip runs as green ✅."""
    if isinstance(result, dict) and "trigger_nodes" not in result:
        nrs = result.get("node_results")
        if isinstance(nrs, list):
            result["trigger_nodes"] = sum(
                1 for nr in nrs
                # M19-1: malformed entries (ints/None/strings) must not crash
                # the read — skip anything that is not a mapping
                if isinstance(nr, dict)
                and nr.get("status") == "completed"
                and nr.get("node_type") == "trigger"
            )


async def get_workflow_runs(workflow_id: str) -> list[dict]:
    """Get run history for a workflow."""
    conn = _get_db()
    try:
        # M17-3: a collection of a thing that does not exist is a 404, not []
        wf = conn.execute("SELECT 1 FROM workflows WHERE id = ?", (workflow_id,)).fetchone()
        if not wf:
            raise WorkflowNotFound("Workflow not found")
        _sweep_stale_runs(conn)  # M8-08: ghost runs die on sight
        rows = conn.execute(
            "SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 50",
            (workflow_id,)
        ).fetchall()
    finally:
        conn.close()

    results = []
    for row in rows:
        d = dict(row)
        _parse_result(d)  # M19-2: one corrupt result must not kill the listing
        results.append(d)

    return results


async def get_run_detail(run_id: str) -> dict | None:
    """Get detailed run result."""
    conn = _get_db()
    try:
        _sweep_stale_runs(conn)  # M8-08: ghost runs die on sight
        row = conn.execute("SELECT * FROM workflow_runs WHERE id = ?", (run_id,)).fetchone()
    finally:
        conn.close()

    if not row:
        return None

    d = dict(row)
    _parse_result(d)  # M19-2: same guard on the detail path
    return d
