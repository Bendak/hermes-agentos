"""SPEC honcho-monitor.md — lote 1 backend regressions.

Mocks the HTTP layer (``_get_json``/``_post_json``) — no network, no real
Honcho. HONCHO É DADO REAL: testes nunca injetam nada na API; fixtures vivem
em memória e os snapshots vão para um agentos.db de sandbox.
"""

import asyncio
import json
import sqlite3
import time

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


def _fake_http(monkeypatch, health_ok=True, card=None, workspaces=None,
               peers_total=None, conclusions_total=20):
    workspaces = workspaces or [{"id": "hermes", "created_at": "2026-06-09"}]
    calls = {"n": 0}

    async def _get(client, path):
        calls["n"] += 1
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
        calls["n"] += 1
        if path == "/v3/workspaces/list":
            return {"items": workspaces}
        if path.endswith("/peers/list"):
            items = [{"id": "user_a"}, {"id": "hermes"}]
            return {"items": items, "total": peers_total or len(items)}
        if path.endswith("/conclusions/list"):
            if body and body.get("size") == 1:
                return {"items": [{"created_at": "2026-10-26T12:00:00Z"}],
                        "total": conclusions_total}
            if body and body.get("size") == 10:
                return {"items": [
                    {"id": "c1", "content": "fato A", "created_at": "2026-10-26T12:00:00Z"},
                    {"id": "c2", "content": "fato B", "created_at": "2026-10-24T09:00:00Z"},
                ], "total": conclusions_total}
            return {"items": [], "total": conclusions_total}
        if path.endswith("/sessions/list"):
            return {"items": [], "total": 10}
        if path.endswith("/representation"):
            return {"representation": "## Explicit Observations\n\n"
                                       "[2026-06-16 22:27:33] a\n"
                                       "[2026-10-21 05:45:24] b\n"}
        raise AssertionError(f"POST inesperado: {path}")

    monkeypatch.setattr(honcho, "_get_json", _get)
    monkeypatch.setattr(honcho, "_post_json", _post)
    return calls


def test_summary_happy_path(env, monkeypatch):
    _fake_http(monkeypatch)
    data = asyncio.run(honcho.collect())
    assert data["status"] == "ok"
    assert data["base_url"] == "http://fake:8000"  # F-H10: só host
    ws = data["workspaces"][0]
    assert ws["id"] == "hermes"
    assert ws["sessions"] == 10 and ws["conclusions"] == 20 and ws["peers"] == 2
    assert ws["queue"]["pending"] == 1
    assert ws["latest_conclusion_at"] == "2026-10-26T12:00:00Z"  # F-H3
    # Q3: últimas conclusões com CONTEÚDO (auditoria de fatos, admin-only)
    assert [c["id"] for c in ws["recent_conclusions"]] == ["c1", "c2"]
    assert ws["recent_conclusions"][0]["content"] == "fato A"
    human = {h["id"]: h for h in ws["humans"]}
    assert human["user_a"]["representation"]["observations"] == 2
    assert human["user_a"]["representation"]["latest_observation"] == "2026-10-21"
    assert data["series"]["hermes"][0]["pending"] == 1  # F-H4


def test_card_states_distinguish_null_empty_populated(env, monkeypatch):
    _fake_http(monkeypatch, card=None)
    d = asyncio.run(honcho.collect())
    assert {h["id"]: h for h in d["workspaces"][0]["humans"]}["user_a"]["card"] == "not_generated"

    honcho._cache = None
    _fake_http(monkeypatch, card=[])
    d = asyncio.run(honcho.collect())
    hum = {h["id"]: h for h in d["workspaces"][0]["humans"]}
    assert hum["user_a"]["card"] == "empty"  # F-H5

    honcho._cache = None
    _fake_http(monkeypatch, card=["fato"])
    d = asyncio.run(honcho.collect())
    hum = {h["id"]: h for h in d["workspaces"][0]["humans"]}
    assert hum["user_a"]["card"] == "populated"


def test_union_of_workspaces_fh2(env, monkeypatch):
    """Config mapeia só 'hermes'; a API tem 2 → os DOIS aparecem (nada escondido)."""
    _fake_http(monkeypatch, workspaces=[
        {"id": "hermes", "created_at": "2026-06-09"},
        {"id": "hermes_seguranca", "created_at": "2026-10-10"},
    ])
    d = asyncio.run(honcho.collect())
    ids = [w["id"] for w in d["workspaces"]]
    assert ids == ["hermes", "hermes_seguranca"], ids
    assert all(w["sessions"] == 10 for w in d["workspaces"])


def test_unreachable_never_raises(env, monkeypatch):
    _fake_http(monkeypatch, health_ok=False)
    data = asyncio.run(honcho.collect())
    assert data["status"] == "unreachable"
    assert any("health" in e for e in data["errors"])


def test_malformed_configs_never_500(env, monkeypatch, client, admin_headers):
    """F-H1: JSON válido com tipo errado não pode virar 500."""
    _fake_http(monkeypatch)  # base válida não vira timeout de rede real
    for bad in ('[1,2,3]', '"texto"', '{"baseUrl": 123, "hosts": {}}',
                '{"baseUrl": "http://x:8000", "hosts": "nope"}',
                '{"baseUrl": "http://x:8000", "hosts": {"h": 42}}'):
        (env / "honcho.json").write_text(bad)
        honcho._cache = None
        d = asyncio.run(honcho.collect())
        assert d["status"] in ("ok", "not_configured", "degraded"), (bad, d["status"])
        honcho._cache = None
        r = client.get("/api/honcho/summary", headers=admin_headers)
        assert r.status_code == 200, (bad, r.status_code)


def test_peers_total_not_page_len_fh8(env, monkeypatch):
    _fake_http(monkeypatch, peers_total=120)
    d = asyncio.run(honcho.collect())
    assert d["workspaces"][0]["peers"] == 120


def test_snapshot_rate_and_drop_detection(env, monkeypatch):
    _fake_http(monkeypatch)
    asyncio.run(honcho.collect())
    asyncio.run(honcho.collect())  # <1h → não duplica
    db = sqlite3.connect(str(env / "agentos.db"))
    n = db.execute("SELECT COUNT(*) FROM honcho_snapshots").fetchone()[0]
    assert n == 1, n
    # último snapshot armazenado com contadores MAIORES → queda detectada já no read
    db.execute("DELETE FROM honcho_snapshots")
    db.execute(
        "INSERT INTO honcho_snapshots VALUES (?, 'hermes', 50, 99, 9, 0, 7000)",
        (int(time.time()) - 10,),
    )
    db.commit()
    db.close()
    d = asyncio.run(honcho.collect())
    assert any("queda de" in w for w in d["warnings"]), d["warnings"]


def test_invalid_url_never_raises_n01(env, monkeypatch):
    """N-01: baseUrl sintaticamente inválida não pode explodir em collect()."""
    for bad_url in ("http://host:abc", "http://[bad", "http://host:99999999"):
        (env / "honcho.json").write_text(
            json.dumps({"baseUrl": bad_url, "hosts": {"h": {"workspace": "hermes"}}}))
        honcho._cache = None
        d = asyncio.run(honcho.collect())  # não pode levantar
        assert d["status"] == "not_configured", (bad_url, d["status"])


def test_snapshot_unique_n02(env, monkeypatch):
    """N-02: dois snapshots no mesmo segundo (race) → 1 linha só."""
    _fake_http(monkeypatch)
    asyncio.run(honcho.collect())
    db = sqlite3.connect(str(env / "agentos.db"))
    now = int(time.time())
    db.execute("DELETE FROM honcho_snapshots")
    db.execute("INSERT OR IGNORE INTO honcho_snapshots VALUES (?, 'hermes', 1, 1, 1, 0, 1)", (now,))
    db.execute("INSERT OR IGNORE INTO honcho_snapshots VALUES (?, 'hermes', 2, 2, 2, 0, 2)", (now,))
    db.commit()
    n = db.execute("SELECT COUNT(*) FROM honcho_snapshots").fetchone()[0]
    db.close()
    assert n == 1, f"UNIQUE não segurou a race ({n} linhas)"


def test_ttl_cache_prevents_http(env, monkeypatch):
    calls = _fake_http(monkeypatch)
    asyncio.run(honcho.summary())
    first = calls["n"]
    asyncio.run(honcho.summary())  # dentro do TTL → sem HTTP
    assert calls["n"] == first, f"TTL não segurou ({first} → {calls['n']})"


def test_endpoint_gate(env, monkeypatch, client, admin_headers, viewer_headers):
    _fake_http(monkeypatch)
    honcho._cache = None
    assert client.get("/api/honcho/summary", headers=viewer_headers).status_code == 403
    r = client.get("/api/honcho/summary", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_not_configured_keeps_generated_at_f1(tmp_path, monkeypatch):
    """F-1 (adversarial lote 2): o payload not_configured PRECISA de generated_at.

    A UI formata esse campo no cabeçalho; sem ele a página inteira morria com
    RangeError e o aviso "honcho.json ausente" nunca aparecia.
    """
    monkeypatch.setattr(honcho, "CONFIG_PATH", str(tmp_path / "nope.json"))
    monkeypatch.setattr(honcho, "AGENTOS_DB", str(tmp_path / "agentos.db"))
    honcho._cache = None
    d = asyncio.run(honcho.collect())
    assert d["status"] == "not_configured"
    assert isinstance(d.get("generated_at"), int), d
    assert d["workspaces"] == [] and d["series"] == {}


def test_conclusion_truncation_is_explicit_f5():
    """F-5: corte em 1000 chars vem com marcador e flag, nunca silencioso."""
    short = honcho._conclusion_item({"id": "a", "content": "fato curto"})
    assert short["truncated"] is False and short["content"] == "fato curto"

    long_raw = "x" * 1600
    long_item = honcho._conclusion_item({"id": "b", "content": long_raw})
    assert long_item["truncated"] is True
    assert long_item["content"].endswith("…")
    assert len(long_item["content"]) <= honcho._CONCLUSION_MAX + 1


def test_deriver_lag_warning_f4(env, monkeypatch):
    """F-4: pending > 50 sustentado por > 1h vira warning; recente não."""
    _fake_http(monkeypatch)
    db_path = env / "agentos.db"
    now = int(time.time())
    db = sqlite3.connect(str(db_path))
    db.execute(honcho._SCHEMA)
    db.execute(
        "INSERT INTO honcho_snapshots VALUES (?, 'hermes', 10, 10, 2, 80, 1000)",
        (now - 7200,),
    )
    db.execute(
        "INSERT INTO honcho_snapshots VALUES (?, 'hermes', 11, 11, 2, 80, 1000)",
        (now - 1800,),
    )
    db.commit()
    db.close()

    async def _post(client, path, body=None):
        if path == "/v3/workspaces/list":
            return {"items": [{"id": "hermes", "created_at": "2026-06-09"}]}
        if path.endswith("/peers/list"):
            return {"items": [{"id": "user_a"}], "total": 1}
        if path.endswith("/conclusions/list"):
            if body and body.get("size") == 1:
                return {"items": [{"created_at": "2026-10-26T12:00:00Z"}], "total": 3}
            return {"items": [], "total": 3}
        if path.endswith("/sessions/list"):
            return {"items": [], "total": 10}
        raise AssertionError(f"POST inesperado: {path}")

    async def _get(client, path):
        if path == "/health":
            return {"status": "ok"}
        if path.endswith("/card"):
            return {"peer_card": None}
        if path.endswith("/queue/status"):
            return {"total_work_units": 90, "completed_work_units": 10,
                    "pending_work_units": 80, "in_progress_work_units": 0}
        if path.endswith("/representation"):
            return {"representation": ""}
        raise AssertionError(f"GET inesperado: {path}")

    monkeypatch.setattr(honcho, "_get_json", _get)
    monkeypatch.setattr(honcho, "_post_json", _post)
    honcho._cache = None
    d = asyncio.run(honcho.collect())
    assert any("deriver lento" in w for w in d["warnings"]), d["warnings"]

    # pending baixo → sem alerta
    assert not any("deriver lento" in w for w in honcho._lag_warnings(
        {"queue": {"pending": 3}}, [{"ts": now - 7200, "pending": 3}]))
