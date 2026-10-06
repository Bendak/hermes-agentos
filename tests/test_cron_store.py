"""Cron store integrity suite (WI-1): no lost updates, honest dispatch.

Covers backend/cron.py against a throwaway cron home (AGENTOS_CRON_HOME,
pinned in conftest):
- lost-update protection under concurrency (threads AND processes);
- schedule update normalization, pause/resume/delete;
- run dispatches a detached Popen (fire-and-forget — never kills the child);
- validation (bad expr, bad profile path);
- legacy job records without id don't break the listing;
- top-level bookkeeping (updated_at) preserved.

The concurrency tests need the Hermes cron store (use_cron_store + flock);
they are skipped when AGENTOS_HERMES_SRC is not importable (e.g. CI).

Auth note: this suite uses dependency_overrides to isolate store behavior —
the auth gate itself is covered end-to-end by test_authz_matrix.py and
test_token_lifecycle.py with real tokens.
"""

import json
import multiprocessing as mp
import pathlib
import threading

import pytest

import backend.cron as c
from backend.auth import require_admin, require_auth
from backend.main import app

pytestmark = pytest.mark.skipif(
    not c.HAVE_STORE,
    reason="Hermes cron store not importable here (AGENTOS_HERMES_SRC) — endpoints answer 503",
)


@pytest.fixture()
def cron_client(client, sandbox):
    fake = {"id": 99, "username": "zz_cron", "role": "admin"}
    app.dependency_overrides[require_auth] = lambda: fake
    app.dependency_overrides[require_admin] = lambda: fake
    yield client
    app.dependency_overrides.pop(require_auth, None)
    app.dependency_overrides.pop(require_admin, None)


def _jobs_file(sandbox: pathlib.Path) -> pathlib.Path:
    return sandbox / "cron" / "jobs.json"


def test_lost_update_threads(cron_client):
    results = []

    def create(i):
        r = cron_client.post("/api/cron", json={"name": f"t1-{i}", "prompt": "x", "schedule": "0 8 * * *"})
        results.append(r.status_code)

    threads = [threading.Thread(target=create, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    jobs = cron_client.get("/api/cron").json()["jobs"]
    t1 = [j for j in jobs if j["name"].startswith("t1-")]
    assert len(t1) == 20, f"criados={len(t1)}/20 codes={set(results)}"


def _proc_worker(args):
    tag, repo_root = args
    import sys as _s

    _s.path.insert(0, repo_root)
    import backend.cron as _c  # noqa: F401
    from fastapi.testclient import TestClient as TC

    from backend.auth import require_admin as _rm
    from backend.auth import require_auth as _ra
    from backend.main import app as _app

    u = {"id": 99, "username": "zz", "role": "admin"}
    _app.dependency_overrides[_ra] = lambda: u
    _app.dependency_overrides[_rm] = lambda: u
    cl = TC(_app)
    for i in range(5):
        cl.post("/api/cron", json={"name": f"t2-{tag}-{i}", "prompt": "x", "schedule": "0 9 * * *"})


def test_lost_update_processes(cron_client, sandbox):
    import sys

    repo_root = str(pathlib.Path(__file__).resolve().parents[1])
    procs = [mp.Process(target=_proc_worker, args=((t, repo_root),)) for t in ("a", "b")]
    for p in procs:
        p.start()
    for p in procs:
        p.join(timeout=60)

    jobs = cron_client.get("/api/cron").json()["jobs"]
    t2 = [j for j in jobs if j["name"].startswith("t2-")]
    assert len(t2) == 10, f"criados={len(t2)}/10"


def test_update_schedule_normalization(cron_client):
    cron_client.post("/api/cron", json={"name": "t3", "prompt": "x", "schedule": "0 8 * * *"})
    jobs = cron_client.get("/api/cron").json()["jobs"]
    jid = next(j["id"] for j in jobs if j["name"] == "t3")
    r = cron_client.put(f"/api/cron/{jid}", json={"schedule": "30 21 * * 2"})
    assert r.status_code == 200
    assert r.json()["schedule"]["expr"] == "30 21 * * 2"


def test_pause_resume_delete(cron_client):
    cron_client.post("/api/cron", json={"name": "t4", "prompt": "x", "schedule": "0 8 * * *"})
    jid = next(j["id"] for j in cron_client.get("/api/cron").json()["jobs"] if j["name"] == "t4")

    assert cron_client.post(f"/api/cron/{jid}/pause").status_code == 200
    assert cron_client.get(f"/api/cron/{jid}").json()["state"] == "paused"
    assert cron_client.post(f"/api/cron/{jid}/resume").status_code == 200
    assert cron_client.get(f"/api/cron/{jid}").json()["state"] == "scheduled"
    assert cron_client.delete(f"/api/cron/{jid}").status_code == 200
    assert cron_client.delete(f"/api/cron/{jid}").status_code == 404


def test_run_dispatch_is_fire_and_forget(cron_client):
    cron_client.post("/api/cron", json={"name": "t5", "prompt": "x", "schedule": "0 8 * * *"})
    jid = next(j["id"] for j in cron_client.get("/api/cron").json()["jobs"] if j["name"] == "t5")

    class FakeProc:
        pid = 1234

    captured = {}

    def fake_popen(*a, **k):
        captured["args"] = a[0]
        captured["k"] = k
        return FakeProc()

    orig = c.subprocess.Popen
    c.subprocess.Popen = fake_popen
    try:
        r = cron_client.post(f"/api/cron/{jid}/run")
        assert r.status_code == 200
        assert r.json()["status"] == "dispatched"
        # honest dispatch: detached child, never a timeout/kill waiting on it
        assert "timeout" not in captured["k"]
        assert captured["k"].get("start_new_session") is True
    finally:
        c.subprocess.Popen = orig

    assert cron_client.post("/api/cron/naoexiste/run").status_code == 404


def test_validation_rejects_bad_expr_and_profile(cron_client):
    r = cron_client.post("/api/cron", json={"name": "bad", "prompt": "x", "schedule": "asdf"})
    assert r.status_code == 422
    r = cron_client.post(
        "/api/cron", json={"name": "bad", "prompt": "x", "schedule": "0 8 * * *", "profile": "../etc"}
    )
    assert r.status_code == 422


def test_legacy_record_without_id_and_bookkeeping(cron_client, sandbox):
    cron_client.post("/api/cron", json={"name": "t7", "prompt": "x", "schedule": "0 8 * * *"})
    jobs_file = _jobs_file(sandbox)
    data = json.loads(jobs_file.read_text())
    data["jobs"].append({"name": "legacy-no-id", "prompt": "x"})
    jobs_file.write_text(json.dumps(data))

    r = cron_client.get("/api/cron")
    assert r.status_code == 200
    assert any(j.get("name") == "legacy-no-id" for j in r.json()["jobs"])

    data = json.loads(jobs_file.read_text())
    assert "updated_at" in data
