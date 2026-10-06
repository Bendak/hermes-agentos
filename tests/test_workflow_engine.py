"""WI-5 lote 1 — M8-01 skip semantics + M8-04/M8-06 graph validation.

M8-01: gated nodes must NEVER execute (side effects included), must not get a
second entry, and the gate is transitive (grandchildren too). Counts close.
M8-04/M8-06: broken graphs are 400s at the API, never persisted verbatim.
"""

import asyncio
import json

import backend.workflow_engine as engine_mod
import backend.workflows as workflows_mod


def _sandbox_db(tmp_path, monkeypatch):
    db = str(tmp_path / "agentos.db")
    monkeypatch.setattr(workflows_mod, "DB_PATH", db)
    monkeypatch.setattr(engine_mod, "DB_PATH", db)
    workflows_mod._init_db()
    engine_mod._init_runs_table()


def test_failed_condition_gates_transitively_without_executing(tmp_path, monkeypatch):
    _sandbox_db(tmp_path, monkeypatch)
    nodes = [
        {"id": "trg", "data": {"label": "t", "nodeType": "trigger", "config": {}}},
        {"id": "cond", "data": {"label": "c", "nodeType": "condition",
                                "config": {"field": "x", "operator": "equals", "value": "1"}}},
        {"id": "child", "data": {"label": "ch", "nodeType": "action",
                                 "config": {"action_type": "set_variable",
                                            "variable": "leak", "value": "v"}}},
        {"id": "grand", "data": {"label": "g", "nodeType": "action",
                                 "config": {"action_type": "log", "message": "hi"}}},
    ]
    edges = [
        {"id": "e1", "source": "trg", "target": "cond"},
        {"id": "e2", "source": "cond", "target": "child"},
        {"id": "e3", "source": "child", "target": "grand"},
    ]
    wf = asyncio.run(workflows_mod.create_workflow({"name": "wf", "nodes": nodes, "edges": edges}))
    run = asyncio.run(engine_mod.run_workflow(wf["id"]))
    assert run["status"] == "completed", run
    res = run["result"]

    entries: dict[str, list[str]] = {}
    for nr in res["node_results"]:
        entries.setdefault(nr["node_id"], []).append(nr["status"])
    for nid, statuses in entries.items():
        assert len(statuses) == 1, (nid, statuses)  # never a 2nd entry
    assert entries["child"] == ["skipped"], entries
    assert entries["grand"] == ["skipped"], entries  # transitive gate
    assert "leak" not in res["context"], res["context"]  # side effect never ran
    assert res["executed_nodes"] + res["skipped_nodes"] == res["total_nodes"] == 4


def test_passed_condition_runs_downstream(tmp_path, monkeypatch):
    _sandbox_db(tmp_path, monkeypatch)
    nodes = [
        {"id": "cond", "data": {"label": "c", "nodeType": "condition",
                                "config": {"field": "x", "operator": "equals", "value": ""}}},
        {"id": "child", "data": {"label": "ch", "nodeType": "action",
                                 "config": {"action_type": "set_variable",
                                            "variable": "ok", "value": "v"}}},
    ]
    edges = [{"id": "e1", "source": "cond", "target": "child"}]
    wf = asyncio.run(workflows_mod.create_workflow({"name": "wf", "nodes": nodes, "edges": edges}))
    run = asyncio.run(engine_mod.run_workflow(wf["id"]))
    res = run["result"]
    assert res["context"].get("ok") == "v"  # executed
    statuses = {nr["node_id"]: nr["status"] for nr in res["node_results"]}
    assert statuses == {"cond": "completed", "child": "completed"}, statuses


def test_graph_validation_rejects_broken_payloads(client, admin_headers, tmp_path, monkeypatch):
    _sandbox_db(tmp_path, monkeypatch)
    cases = [
        {"nodes": None, "edges": []},                                  # M8-04 verbatim null
        {"nodes": "nope", "edges": []},                                # non-list
        {"nodes": [{"id": "a", "data": {}}, {"id": "a", "data": {}}], "edges": []},  # dup id
        {"nodes": [{"id": "a", "data": {}}], "edges": [{"source": "a", "target": "a"}]},  # no edge id
        {"nodes": [{"id": "a", "data": {}}],
         "edges": [{"id": "e", "source": "a", "target": "ghost"}]},     # dangling
    ]
    for payload in cases:
        r = client.post("/api/workflows", headers=admin_headers,
                        json={"name": "x", **payload})
        assert r.status_code == 400, (payload, r.status_code, r.text)

    # absent keys are fine (create default), valid graph passes
    r = client.post("/api/workflows", headers=admin_headers, json={"name": "ok"})
    assert r.status_code == 200, r.text
    r = client.post("/api/workflows", headers=admin_headers,
                    json={"name": "ok2", "nodes": [{"id": "a", "data": {}}], "edges": []})
    assert r.status_code == 200, r.text


# ── WI-5 batch 2 ─────────────────────────────────────────────────────────────

def test_partial_update_validates_merged_graph(client, admin_headers, tmp_path, monkeypatch):
    """M14-1: a nodes-only update must not leave the old edges dangling (200)."""
    _sandbox_db(tmp_path, monkeypatch)
    nodes = [{"id": "a", "data": {}}, {"id": "b", "data": {}}]
    edges = [{"id": "e1", "source": "a", "target": "b"}]
    r = client.post("/api/workflows", headers=admin_headers,
                    json={"name": "g", "nodes": nodes, "edges": edges})
    assert r.status_code == 200, r.text
    wf_id = r.json()["id"]

    # nodes-only update removing 'b' → old edge a->b would dangle: must 400
    r = client.put(f"/api/workflows/{wf_id}", headers=admin_headers,
                   json={"nodes": [{"id": "a", "data": {}}]})
    assert r.status_code == 400, r.text
    # nothing persisted: graph unchanged
    wf = client.get(f"/api/workflows/{wf_id}", headers=admin_headers).json()
    assert len(json.loads(wf["nodes"])) == 2 and len(json.loads(wf["edges"])) == 1

    # consistent partial update (keeps both nodes) passes
    r = client.put(f"/api/workflows/{wf_id}", headers=admin_headers,
                   json={"nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}]})
    assert r.status_code == 200, r.text


def test_self_loops_and_duplicate_pairs_rejected(client, admin_headers, tmp_path, monkeypatch):
    """M14-2: invalid edge shapes are 400s at the API, not a 'cycle' at run time."""
    _sandbox_db(tmp_path, monkeypatch)
    cases = [
        {"nodes": [{"id": "a", "data": {}}],
         "edges": [{"id": "e1", "source": "a", "target": "a"}]},  # self-loop
        {"nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}],
         "edges": [{"id": "e1", "source": "a", "target": "b"},
                   {"id": "e2", "source": "a", "target": "b"}]},  # dup pair
    ]
    for payload in cases:
        r = client.post("/api/workflows", headers=admin_headers,
                        json={"name": "x", **payload})
        assert r.status_code == 400, (payload, r.status_code, r.text)


def test_delete_cascades_runs(client, admin_headers, tmp_path, monkeypatch):
    """M8-09: FK enforcement — deleting a workflow must delete its runs."""
    _sandbox_db(tmp_path, monkeypatch)
    r = client.post("/api/workflows", headers=admin_headers,
                    json={"name": "cascade", "nodes": [{"id": "t", "data": {"nodeType": "trigger"}}],
                          "edges": []})
    assert r.status_code == 200, r.text
    wf_id = r.json()["id"]
    run = asyncio.run(engine_mod.run_workflow(wf_id))
    assert run["status"] == "completed"

    import sqlite3 as _sq
    conn = _sq.connect(str(tmp_path / "agentos.db"))
    before = conn.execute("SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = ?", (wf_id,)).fetchone()[0]
    assert before >= 1
    conn.close()

    r = client.delete(f"/api/workflows/{wf_id}", headers=admin_headers)
    assert r.status_code == 200, r.text

    conn = _sq.connect(str(tmp_path / "agentos.db"))
    conn.execute("PRAGMA foreign_keys=ON")
    after = conn.execute("SELECT COUNT(*) FROM workflow_runs WHERE workflow_id = ?", (wf_id,)).fetchone()[0]
    conn.close()
    assert after == 0, "cascade did not fire — runs left behind"


def test_stubs_are_not_completed(tmp_path, monkeypatch):
    """M8-07: create_task/http_request no-ops must not count as real work."""
    _sandbox_db(tmp_path, monkeypatch)
    nodes = [
        {"id": "a", "data": {"nodeType": "action",
                             "config": {"action_type": "create_task", "title": "t"}}},
        {"id": "b", "data": {"nodeType": "action",
                             "config": {"action_type": "http_request", "url": "http://x"}}},
        {"id": "c", "data": {"nodeType": "action", "config": {"action_type": "log"}}},
    ]
    wf = asyncio.run(workflows_mod.create_workflow({"name": "s", "nodes": nodes, "edges": []}))
    run = asyncio.run(engine_mod.run_workflow(wf["id"]))
    res = run["result"]
    statuses = {nr["node_id"]: nr["status"] for nr in res["node_results"]}
    assert statuses["a"] == "stub" and statuses["b"] == "stub", statuses
    assert statuses["c"] == "completed", statuses
    assert res["executed_nodes"] == 1
    assert res["stub_nodes"] == 2
    assert res["executed_nodes"] + res["skipped_nodes"] + res["stub_nodes"] == res["total_nodes"]


# ── WI-5 batch 3 ─────────────────────────────────────────────────────────────

def _insert_legacy_row(tmp_path, monkeypatch, wf_id="wf_legacy"):
    """A pre-WI-5 row: nodes/edges persisted verbatim as SQL NULL."""
    import sqlite3 as _sq
    _sandbox_db(tmp_path, monkeypatch)
    conn = _sq.connect(str(tmp_path / "agentos.db"))
    conn.execute(
        "INSERT INTO workflows (id, name, description, nodes, edges, created_at, updated_at)"
        " VALUES (?, 'legacy', '', NULL, NULL, 't', 't')",
        (wf_id,),
    )
    conn.commit()
    conn.close()
    return wf_id


def test_legacy_null_row_is_editable_and_runnable(client, admin_headers, tmp_path, monkeypatch):
    """M15-1: NULL-graph rows recover (no 500 wall on PUT/RUN)."""
    wf_id = _insert_legacy_row(tmp_path, monkeypatch)

    # PUT name-only: normalizes the graph instead of TypeError 500
    r = client.put(f"/api/workflows/{wf_id}", headers=admin_headers, json={"name": "renamed"})
    assert r.status_code == 200, r.text
    # PUT with a graph: also fine
    r = client.put(f"/api/workflows/{wf_id}", headers=admin_headers,
                   json={"nodes": [{"id": "a", "data": {"nodeType": "trigger"}}], "edges": []})
    assert r.status_code == 200, r.text

    # RUN of a legacy NULL row (fresh one): completes as an empty graph
    wf_id2 = _insert_legacy_row(tmp_path, monkeypatch, wf_id="wf_legacy2")
    r = client.post(f"/api/workflows/{wf_id2}/run", headers=admin_headers)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"

    # corrupt JSON (not NULL) is honest: 400 naming the field
    import sqlite3 as _sq
    conn = _sq.connect(str(tmp_path / "agentos.db"))
    conn.execute("INSERT INTO workflows (id, name, description, nodes, edges, created_at, updated_at)"
                 " VALUES ('wf_corrupt', 'c', '', 'garbage{', '[]', 't', 't')")
    conn.commit()
    conn.close()
    r = client.post("/api/workflows/wf_corrupt/run", headers=admin_headers)
    assert r.status_code == 400, (r.status_code, r.text)


def test_two_cycles_rejected_at_validation(client, admin_headers, tmp_path, monkeypatch):
    """M15-2: a->b + b->a is a cycle at the API (400), not an engine error."""
    _sandbox_db(tmp_path, monkeypatch)
    r = client.post("/api/workflows", headers=admin_headers, json={
        "name": "cyc",
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}],
        "edges": [{"id": "e1", "source": "a", "target": "b"},
                  {"id": "e2", "source": "b", "target": "a"}],
    })
    assert r.status_code == 400, (r.status_code, r.text)


def test_duplicate_edge_ids_rejected(client, admin_headers, tmp_path, monkeypatch):
    """M15-3: edge ids must be unique (was: silently overwrote each other)."""
    _sandbox_db(tmp_path, monkeypatch)
    r = client.post("/api/workflows", headers=admin_headers, json={
        "name": "dup",
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}, {"id": "c", "data": {}}],
        "edges": [{"id": "e1", "source": "a", "target": "b"},
                  {"id": "e1", "source": "b", "target": "c"}],
    })
    assert r.status_code == 400, (r.status_code, r.text)


def test_name_null_defaults(client, admin_headers, tmp_path, monkeypatch):
    """M15-4: explicit null name defaults instead of a raw IntegrityError 500."""
    _sandbox_db(tmp_path, monkeypatch)
    r = client.post("/api/workflows", headers=admin_headers, json={"name": None})
    assert r.status_code == 200, (r.status_code, r.text)
    assert r.json()["name"] == "Untitled"
    r = client.put(f"/api/workflows/{r.json()['id']}", headers=admin_headers, json={"name": None})
    assert r.status_code == 200 and r.json()["name"] == "Untitled"


def test_list_returns_counts(client, admin_headers, tmp_path, monkeypatch):
    """M8-15: the list contract carries node/edge counts (no blob parsing)."""
    _sandbox_db(tmp_path, monkeypatch)
    r = client.post("/api/workflows", headers=admin_headers, json={
        "name": "cnt",
        "nodes": [{"id": "a", "data": {}}, {"id": "b", "data": {}}],
        "edges": [{"id": "e1", "source": "a", "target": "b"}],
    })
    assert r.status_code == 200, r.text
    rows = client.get("/api/workflows", headers=admin_headers).json()
    row = next(w for w in rows if w["id"] == r.json()["id"])
    assert row["node_count"] == 2 and row["edge_count"] == 1, row
