"""Status-change coherence + audit (07/10/26 incident chain).

- M30-b: unarchive/queue-target with a LIVE claim must not return the card
  as 'ready' — the worker is still running (the user's incident: card came
  back from unarchive as 'ready' while pid 536932 was generating video).
- M30-05: leaving 'done' must clear completed_at (orphan timestamps).
- M30-a (minimal): every status change must emit a 'status' task_event with
  from/to/actor — without it the archive actor was unrecoverable.
"""

import asyncio
import json
import sqlite3
import time


def _set_claim(task_id, fresh=True):
    """Give the task an active claim (or an expired one)."""
    db = sqlite3.connect(__import__("backend.tasks", fromlist=["DB_PATH"]).DB_PATH)
    exp = int(time.time()) + (1800 if fresh else -1800)
    db.execute(
        "UPDATE tasks SET claim_lock=?, claim_expires=?, worker_pid=? WHERE id=?",
        ("f2515f7c0b54:1", exp, 424242, task_id),
    )
    db.commit()
    db.close()


def _events(task_id):
    from backend.tasks import DB_PATH

    db = sqlite3.connect(DB_PATH)
    rows = db.execute(
        "SELECT kind, payload FROM task_events WHERE task_id=? AND kind='status' ORDER BY id",
        (task_id,),
    ).fetchall()
    db.close()
    return [(k, json.loads(p) if p else {}) for k, p in rows]


def test_unarchive_with_live_claim_returns_running_m30b(client, admin_headers, make_task):
    task = make_task({})
    tid = task["id"]
    # arquivar sem claim → vira archived normalmente
    r = client.patch(f"/api/tasks/{tid}", json={"status": "archived"}, headers=admin_headers)
    assert r.status_code == 200 and r.json()["status"] == "archived"
    # worker AINDA VIVO (claim fresco) — o usuário clica unarchive
    _set_claim(tid, fresh=True)
    r = client.patch(f"/api/tasks/{tid}", json={"status": "ready"}, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "running", (
        "M30-b regression: unarchive com claim vivo devolveu %r" % r.json()["status"]
    )


def test_expired_claim_allows_queue_target(client, admin_headers, make_task):
    task = make_task({})
    _set_claim(task["id"], fresh=False)  # claim expirado não trava nada
    r = client.patch(
        f"/api/tasks/{task['id']}", json={"status": "ready"}, headers=admin_headers
    )
    assert r.json()["status"] == "ready"


def test_non_queue_target_never_coerced(client, admin_headers, make_task):
    task = make_task({})
    _set_claim(task["id"], fresh=True)
    r = client.patch(
        f"/api/tasks/{task['id']}", json={"status": "blocked"}, headers=admin_headers
    )
    assert r.json()["status"] == "blocked"  # blocked é intencional, não coage


def test_leaving_done_clears_completed_at_m305(client, admin_headers, make_task):
    task = make_task({})
    tid = task["id"]
    r = client.patch(f"/api/tasks/{tid}", json={"status": "done"}, headers=admin_headers)
    assert r.json()["completed_at"] is not None
    r = client.patch(f"/api/tasks/{tid}", json={"status": "todo"}, headers=admin_headers)
    body = r.json()
    assert body["status"] == "todo"
    assert body["completed_at"] is None, "M30-05 regression: completed_at órfão ao reabrir"


def test_status_change_emits_audit_event_m30a(client, admin_headers, make_task):
    task = make_task({})
    tid = task["id"]
    client.patch(f"/api/tasks/{tid}", json={"status": "running"}, headers=admin_headers)
    client.patch(f"/api/tasks/{tid}", json={"status": "done"}, headers=admin_headers)
    evs = _events(tid)
    assert len(evs) >= 2, f"M30-a regression: status mudou sem evento de auditoria ({evs})"
    tos = [p.get("to") for _, p in evs]
    assert "running" in tos and "done" in tos
    for _, p in evs:
        assert "actor" in p and "from" in p


def test_done_to_archived_keeps_completed_at_m3104(client, admin_headers, make_task):
    task = make_task({})
    tid = task["id"]
    client.patch(f"/api/tasks/{tid}", json={"status": "done"}, headers=admin_headers)
    r = client.patch(f"/api/tasks/{tid}", json={"status": "archived"}, headers=admin_headers)
    body = r.json()
    assert body["status"] == "archived"
    assert body["completed_at"] is not None, (
        "M31-04 regression: done→archived apagou completed_at (histórico perdido)"
    )


def test_coerced_request_emits_event_even_when_status_unchanged_m3106(client, admin_headers, make_task):
    """M31-06: o REQUEST coagido audita — é o shape exato do incidente
    (usuário pede 'ready', worker vivo, status continua 'running')."""
    task = make_task({})
    tid = task["id"]
    _set_claim(tid, fresh=True)
    client.patch(f"/api/tasks/{tid}", json={"status": "running"}, headers=admin_headers)
    r = client.patch(f"/api/tasks/{tid}", json={"status": "ready"}, headers=admin_headers)
    assert r.json()["status"] == "running"
    evs = _events(tid)
    coerced = [p for _, p in evs if p.get("coerced") and p.get("requested") == "ready"]
    assert coerced, f"M31-06 regression: request coagido sem evento ({evs})"
    assert coerced[0]["to"] == "running"
    assert coerced[0]["actor"]  # quem pediu fica registrado


def test_millisecond_claim_normalized_m3103(client, admin_headers, make_task):
    """M31-03: claim em milissegundos (writer legado corrompido) não pode
    parecer fresco pra sempre."""
    import sqlite3
    from backend.tasks import DB_PATH

    task = make_task({})
    tid = task["id"]
    db = sqlite3.connect(DB_PATH)
    db.execute(
        "UPDATE tasks SET claim_lock=?, claim_expires=?, worker_pid=? WHERE id=?",
        ("l", (int(time.time()) - 1800) * 1000, 1, tid),  # ms EXPIRADO
    )
    db.commit()
    db.close()
    r = client.patch(f"/api/tasks/{tid}", json={"status": "ready"}, headers=admin_headers)
    assert r.json()["status"] == "ready", (
        "M31-03 regression: claim em ms expirado foi tratado como fresco"
    )
