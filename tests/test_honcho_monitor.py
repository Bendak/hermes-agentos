"""SPEC honcho-monitor.md — lote 1 backend regressions (6 tests).

Mocks the HTTP layer (``_get_json``/``_post_json``) so no network or real Honcho
is touched; config + agentos DB are sandboxed.
"""

import asyncio
import json
import sqlite3

import pytest

import backend.honcho as honcho


@pytest.fixture()
def env(tmp_path, monkeypatch):
    cfg = tmp_path / "honcho.json"
    cfg.write_text(json.dumps({
        "baseUrl": "http://fake:8000",
        "hosts": {"h": {"workspace": "hermes", "enabled": True}},
    }))
    monkeypatch.setattr(honcho, "CONFIG_PATH", str(cfg))
    monkeypatch.setattr(honcho, "AGENTOS_DB", str(tmp_path / "agentos.db"))
    honcho._cache = None
    return tmp_path


def _fake_http(monkeypatch, health_ok=True, card=None):
    async def _get(client, path):
        if path == "/health":
            if not health_ok:
                raise RuntimeError("honcho down")
            return {"status": "ok"}
        if path.endswith("/card"):
            return {"peer_card": card}
        if path.endswith("/queue/status"):
            return {"total_work_units": 10, "completed_work_units": 9,
                    "pending_work_units": 1, "in_progress_work_units": 0}
        raise AssertionError(f"GET inesperado: {path}")

    async def _post(client, path, body=None):
        if path == "/v3/workspaces/list":
            return {"items": [{"id": "hermes", "created_at": "2026-06-09"}]}
        if path.endswith("/peers/list"):
            return {"items": [{"id": "user_a"}, {"id": "hermes"}]}
        if path.endswith("/sessions/list"):
            return {"items": [], "total": 10}
        if path.endswith("/conclusions/list"):
            return {"items": [], "total": 20}
        if path.endswith("/representation"):
            return {"representation": "## Explicit Observations\n\n"
                                       "[2026-06-16 22:27:33] a\n"
                                       "[2026-10-21 05:45:24] b\n"}
        raise AssertionError(f"POST inesperado: {path}")

    monkeypatch.setattr(honcho, "_get_json", _get)
    monkeypatch.setattr(honcho, "_post_json", _post)


def test_summary_happy_path(env, monkeypatch):
    _fake_http(monkeypatch)
    data = asyncio.run(honcho.collect())
    assert data["status"] == "ok"
    assert data["health"] == {"status": "ok"}
    ws = data["workspaces"][0]
    assert ws["id"] == "hermes"
    assert ws["sessions"] == 10 and ws["conclusions"] == 20 and ws["peers"] == 2
    assert ws["queue"]["pending"] == 1
    human = {h["id"]: h for h in ws["humans"]}
    assert human["user_a"]["representation"]["observations"] == 2
    assert human["user_a"]["representation"]["latest_observation"] == "2026-10-21"
    assert data["series"]["hermes"][0]["sessions"] == 10


def test_card_null_is_not_generated_not_alarm(env, monkeypatch):
    _fake_http(monkeypatch, card=None)
    data = asyncio.run(honcho.collect())
    human = {h["id"]: h for h in data["workspaces"][0]["humans"]}
    assert human["user_a"]["card"] == "not_generated"
    assert data["status"] == "ok"  # card null NÃO é degradação

    _fake_http(monkeypatch, card=["fato 1"])
    honcho._cache = None
    data = asyncio.run(honcho.collect())
    human = {h["id"]: h for h in data["workspaces"][0]["humans"]}
    assert human["user_a"]["card"] == "populated"


def test_unreachable_never_raises(env, monkeypatch):
    _fake_http(monkeypatch, health_ok=False)
    data = asyncio.run(honcho.collect())
    assert data["status"] == "unreachable"
    assert any("health" in e for e in data["errors"])


def test_not_configured(tmp_path, monkeypatch):
    monkeypatch.setattr(honcho, "CONFIG_PATH", str(tmp_path / "nope.json"))
    monkeypatch.setattr(honcho, "AGENTOS_DB", str(tmp_path / "a.db"))
    honcho._cache = None
    data = asyncio.run(honcho.collect())
    assert data["status"] == "not_configured"


def test_snapshot_rate_limit(env, monkeypatch):
    _fake_http(monkeypatch)
    asyncio.run(honcho.collect())
    asyncio.run(honcho.collect())  # <1h → não duplica
    db = sqlite3.connect(str(env / "agentos.db"))
    n = db.execute("SELECT COUNT(*) FROM honcho_snapshots").fetchone()[0]
    assert n == 1, n
    # envelhece o snapshot → o próximo coletor grava outro
    db.execute("UPDATE honcho_snapshots SET ts = ts - 4000")
    db.commit()
    db.close()
    asyncio.run(honcho.collect())
    db = sqlite3.connect(str(env / "agentos.db"))
    n = db.execute("SELECT COUNT(*) FROM honcho_snapshots").fetchone()[0]
    db.close()
    assert n == 2, n


def test_endpoint_gate_and_shape(env, monkeypatch, client, admin_headers, viewer_headers):
    _fake_http(monkeypatch)
    honcho._cache = None
    r = client.get("/api/honcho/summary", headers=viewer_headers)
    assert r.status_code == 403, f"viewer leu memória ({r.status_code})"
    r = client.get("/api/honcho/summary", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["workspaces"][0]["id"] == "hermes"
