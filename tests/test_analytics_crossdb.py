"""WI-9 (M5) analytics regressions.

Covers the batch's fixes:
- M5-01: cross-db aggregation (root + profiles/*/state.db) with profile labels
- F-M5-09: archived sessions excluded from every session-scoped metric
- M5-05: missing state.db is skipped (no phantom file created) and a db with
  no tables is skipped without 500ing the endpoint
- M5-02/03: trend buckets by last_seen in BRT — the same day source as the
  heatmap
"""

import os
import sqlite3
import time

import pytest

import backend.state_dbs as state_dbs


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    """Isolated AGENTOS_DATA_DIR-equivalent: repoints the shared state-db
    helper at a throwaway root so these tests never touch the conftest
    sandbox state.db other test files rely on."""
    root = tmp_path / "data"
    root.mkdir()
    monkeypatch.setattr(state_dbs, "STATE_DB", str(root / "state.db"))
    return str(root)


def _make_db(path: str, sessions: list[tuple], usage: list[tuple]) -> None:
    """sessions: (id, display_name, model, started_at, archived)
    usage: (session_id, model, in, out, cache_r, cache_w, reason, calls, cost, first_seen, last_seen)"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    db = sqlite3.connect(path)
    db.execute("DROP TABLE IF EXISTS sessions")
    db.execute("DROP TABLE IF EXISTS session_model_usage")
    db.execute(
        "CREATE TABLE sessions (id TEXT PRIMARY KEY, display_name TEXT, model TEXT,"
        " started_at INTEGER, archived INTEGER DEFAULT 0)"
    )
    db.execute(
        "CREATE TABLE session_model_usage (session_id TEXT, model TEXT,"
        " input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,"
        " cache_read_tokens INTEGER DEFAULT 0, cache_write_tokens INTEGER DEFAULT 0,"
        " reasoning_tokens INTEGER DEFAULT 0, api_call_count INTEGER DEFAULT 0,"
        " estimated_cost_usd REAL DEFAULT 0, first_seen INTEGER, last_seen INTEGER)"
    )
    db.executemany("INSERT INTO sessions VALUES (?,?,?,?,?)", sessions)
    db.executemany("INSERT INTO session_model_usage VALUES (?,?,?,?,?,?,?,?,?,?,?)", usage)
    db.commit()
    db.close()


def _state_db(base: str):
    return os.path.join(base, "state.db")


def _profile_db(base: str, pid: str):
    root = os.path.join(base, "profiles", pid)
    os.makedirs(root, exist_ok=True)
    with open(os.path.join(root, "config.yaml"), "w") as f:
        f.write("name: test\n")
    return os.path.join(root, "state.db")


def test_cross_db_aggregation_and_profile_label(client, admin_headers, data_dir):
    """M5-01: usage in a sub-profile db must appear in the totals."""
    now = int(time.time())
    _make_db(_state_db(data_dir), [("s-root", "root sess", "m1", now, 0)],
             [("s-root", "m1", 100, 10, 0, 0, 0, 1, 0.5, now, now)])
    _make_db(_profile_db(data_dir, "prof_a"),
             [("s-sub", "sub sess", "m2", now, 0)],
             [("s-sub", "m2", 700, 70, 5, 1, 2, 3, 1.5, now, now)])

    r = client.get("/api/analytics/tokens", headers=admin_headers)
    assert r.status_code == 200
    body = r.json()
    totals = body["totals"]
    assert totals["input_tokens"] == 800, f"M5-01: sub-profile invisível ({totals})"
    models = {m["model"]: m for m in body["by_model"]}
    assert models["m2"]["input_tokens"] == 700

    top = body["top_sessions"]
    assert len(top) == 2
    assert {t["profile"] for t in top} == {"default", "prof_a"}, (
        "M5-01: top_sessions sem coluna de profile"
    )

    r = client.get("/api/analytics/tokens/by-model", headers=admin_headers)
    models = {m["model"]: m for m in r.json()["models"]}
    assert models["m2"]["cache_write_tokens"] == 1
    assert models["m2"]["estimated_cost_usd"] == 1.5


def test_archived_sessions_excluded(client, admin_headers, data_dir):
    """F-M5-09: sessões arquivadas não contam em nenhum metric."""
    now = int(time.time())
    _make_db(
        _state_db(data_dir),
        [
            ("s-act", "active", "m1", now, 0),
            ("s-arc", "archived", "m1", now, 1),
        ],
        [
            ("s-act", "m1", 100, 1, 0, 0, 0, 1, 0.1, now, now),
            ("s-arc", "m1", 9999, 999, 0, 0, 0, 1, 9.9, now, now),
        ],
    )
    r = client.get("/api/analytics/tokens", headers=admin_headers)
    body = r.json()
    assert body["totals"]["input_tokens"] == 100, (
        f"F-M5-09: arquivada vazou no totals ({body['totals']})"
    )
    assert all(t["session_id"] == "s-act" for t in body["top_sessions"])

    r = client.get("/api/analytics/activity", headers=admin_headers)
    assert r.json()["total_sessions"] == 1, (
        "F-M5-09: heatmap contou sessão arquivada"
    )


def test_missing_db_and_schema_drift_do_not_500(client, admin_headers, data_dir):
    """M5-05: sem state.db não há db fantasma; db sem tabelas é pulado."""
    # state.db NÃO existe neste teste — o endpoint precisa responder 200 vazio
    if os.path.exists(_state_db(data_dir)):
        os.remove(_state_db(data_dir))
    before = set(os.listdir(data_dir))

    r = client.get("/api/analytics/tokens", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["totals"]["input_tokens"] == 0
    assert not os.path.exists(_state_db(data_dir)), (
        "M5-05: endpoint criou state.db fantasma"
    )
    assert set(os.listdir(data_dir)) == before

    # db com schema errado → pulado com warning, sem 500
    _make_db(_profile_db(data_dir, "broken"), [], [])  # tabelas criadas…
    db = sqlite3.connect(_profile_db(data_dir, "broken"))
    db.execute("DROP TABLE session_model_usage")  # …e uma removida
    db.commit()
    db.close()
    r = client.get("/api/analytics/tokens", headers=admin_headers)
    assert r.status_code == 200


def test_trend_buckets_by_last_seen_brt(client, admin_headers, data_dir):
    """M5-02/03: bucket por last_seen no offset BRT do heatmap."""
    # first_seen 04:30 UTC de ontem (= 01:30 BRT ontem), last_seen 02:00 UTC
    # de hoje (= 23:00 BRT de ONTEM). Bucket por first_seen em UTC cairia em
    # 'ontem-UTC'; por last_seen em BRT cai em 'ontem-BRT' — o mesmo dia do
    # heatmap para uma sessão iniciada às 23h30 BRT.
    now = int(time.time())
    first = now - 20 * 3600
    last = now - 2 * 3600
    _make_db(_state_db(data_dir), [("s1", "s1", "m1", first, 0)],
             [("s1", "m1", 50, 5, 0, 0, 0, 1, 0.0, first, last)])

    r = client.get("/api/analytics/tokens", headers=admin_headers)
    trend = r.json()["trend"]
    assert len(trend) == 1
    import datetime
    expected_day = datetime.datetime.utcfromtimestamp(last - 3 * 3600).strftime("%Y-%m-%d")
    assert trend[0]["day"] == expected_day, (
        f"M5-02/03: bucket errado ({trend[0]['day']} != {expected_day})"
    )
    assert trend[0]["input_tokens"] == 50
