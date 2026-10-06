"""WI-5 lote 1 — M8-01 skip semantics + M8-04/M8-06 graph validation.

M8-01: gated nodes must NEVER execute (side effects included), must not get a
second entry, and the gate is transitive (grandchildren too). Counts close.
M8-04/M8-06: broken graphs are 400s at the API, never persisted verbatim.
"""

import asyncio

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
