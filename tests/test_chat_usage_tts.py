"""Chat usage line + text-to-speech endpoints.

No network: the state.db is a throwaway sqlite file and both TTS engines are
replaced. What is tested is ownership, the thread→gateway-session mapping,
honest cost reporting and the speech text cleanup.
"""

import json
import sqlite3

import pytest

import backend.chat as chat
import backend.chat_sessions as cs
import backend.chat_usage as chat_usage
import backend.tts as tts

_SCHEMA = """
CREATE TABLE sessions (
    id TEXT PRIMARY KEY, source TEXT, model TEXT, model_config TEXT,
    billing_provider TEXT, billing_base_url TEXT,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
    cache_write_tokens INTEGER, reasoning_tokens INTEGER, api_call_count INTEGER,
    estimated_cost_usd REAL, actual_cost_usd REAL, cost_status TEXT,
    started_at REAL, chat_id TEXT, title TEXT, title_source TEXT
);
CREATE TABLE session_model_usage (
    session_id TEXT, model TEXT, task TEXT, api_call_count INTEGER,
    input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER
);
"""


@pytest.fixture(autouse=True)
def _sandbox(monkeypatch, tmp_path):
    monkeypatch.setenv("AGENTOS_CHAT_PROFILES",
                       json.dumps({"zz_admin": "default", "zz_viewer": "default"}))
    monkeypatch.setenv("AGENTOS_PROFILES_DIR", str(tmp_path / "profiles"))
    monkeypatch.setenv("API_SERVER_KEY", "test-gateway-key-" + "x" * 20)
    monkeypatch.setenv("AGENTOS_CONTEXT_WINDOW", "1000000")
    cs.reset_initialized_for_tests()

    async def fake_create(profile, session_id, title):
        return None

    monkeypatch.setattr(chat, "_create_remote_session", fake_create)
    cs.init_db()
    db = tmp_path / "state.db"
    conn = sqlite3.connect(db)
    conn.executescript(_SCHEMA)
    conn.commit()
    conn.close()
    monkeypatch.setattr(chat_usage, "state_db_for", lambda profile: str(db))
    tts._cache.clear()
    yield db


def _session(client, headers):
    r = client.post("/api/chat/sessions", json={}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json(), cs.get(r.json()["id"])


def _insert(db, **row):
    base = dict(source="agentos", model="m1", model_config=None, billing_provider="p",
                billing_base_url="https://x", input_tokens=0, output_tokens=0,
                cache_read_tokens=0, cache_write_tokens=0, reasoning_tokens=0,
                api_call_count=0, estimated_cost_usd=0.0, actual_cost_usd=0.0,
                cost_status="unknown", started_at=1.0, chat_id=None, title=None,
                title_source=None)
    base.update(row)
    conn = sqlite3.connect(db)
    cols = ",".join(base)
    conn.execute(f"INSERT INTO sessions ({cols}) VALUES ({','.join('?' * len(base))})",
                 list(base.values()))
    conn.commit()
    conn.close()


def test_usage_aggregates_thread_and_reads_context(client, admin_headers, _sandbox):
    pub, row = _session(client, admin_headers)
    hid = row["hermes_id"]
    _insert(_sandbox, id="s1", chat_id=hid, input_tokens=100, output_tokens=10,
            cache_read_tokens=1000, api_call_count=2, started_at=1.0,
            model_config=json.dumps({"_usage_anchor": {"prompt_tokens": 50}}))
    # compression split: a newer gateway session for the same thread
    _insert(_sandbox, id="s2", chat_id=hid, input_tokens=200, output_tokens=20,
            cache_read_tokens=2000, api_call_count=3, started_at=2.0, model="m2",
            model_config=json.dumps({"_usage_anchor": {"prompt_tokens": 1234}}))
    _insert(_sandbox, id="other", chat_id="agentos_someone_else", input_tokens=999,
            api_call_count=9)
    conn = sqlite3.connect(_sandbox)
    conn.execute("INSERT INTO session_model_usage VALUES ('s2','m3','title_generation',1,5,2,0)")
    conn.execute("INSERT INTO session_model_usage VALUES ('s2','m2','',3,200,20,2000)")
    conn.commit()
    conn.close()

    r = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers)
    assert r.status_code == 200, r.text
    u = r.json()
    assert u["available"] is True
    assert u["model"] == "m2"
    assert u["totals"]["input_tokens"] == 300
    assert u["totals"]["output_tokens"] == 30
    assert u["totals"]["cache_read_tokens"] == 3000
    assert u["totals"]["api_calls"] == 5
    assert u["context"] == {"tokens": 1234, "window": 1000000}
    assert u["cost"] is None  # unknown pricing must never render as $0.00
    assert u["auxiliary"] == [{"task": "title_generation", "model": "m3", "input_tokens": 5,
                               "output_tokens": 2, "cache_read_tokens": 0, "api_calls": 1}]


def test_usage_legacy_mode_matches_session_id(client, admin_headers, _sandbox):
    pub, row = _session(client, admin_headers)
    _insert(_sandbox, id=row["hermes_id"], input_tokens=7, api_call_count=1,
            cost_status="estimated", estimated_cost_usd=0.25)
    u = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers).json()
    assert u["totals"]["input_tokens"] == 7
    assert u["cost"] == {"usd": 0.25, "status": "estimated"}
    assert u["context"] is None


def test_usage_mixed_pricing_is_not_reported(client, admin_headers, _sandbox):
    pub, row = _session(client, admin_headers)
    hid = row["hermes_id"]
    _insert(_sandbox, id="a", chat_id=hid, api_call_count=1, cost_status="estimated",
            estimated_cost_usd=1.0)
    _insert(_sandbox, id="b", chat_id=hid, api_call_count=1, cost_status="unknown",
            started_at=2.0)
    u = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers).json()
    assert u["cost"] is None


def test_usage_without_data_is_unavailable(client, admin_headers):
    pub, _ = _session(client, admin_headers)
    u = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers).json()
    assert u == {"available": False}


def test_usage_missing_state_db_degrades(client, admin_headers, monkeypatch):
    pub, _ = _session(client, admin_headers)
    monkeypatch.setattr(chat_usage, "state_db_for", lambda profile: None)
    u = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers).json()
    assert u == {"available": False}


def test_usage_is_owner_only(client, admin_headers, viewer_headers):
    pub, _ = _session(client, admin_headers)
    assert client.get(f"/api/chat/sessions/{pub['id']}/usage",
                      headers=viewer_headers).status_code == 404
    assert client.get(f"/api/chat/sessions/{pub['id']}/usage").status_code in (401, 403)


def test_anchor_parsing_is_defensive():
    assert chat_usage._anchor_tokens(None) is None
    assert chat_usage._anchor_tokens("not json") is None
    assert chat_usage._anchor_tokens(json.dumps({"_usage_anchor": "x"})) is None
    assert chat_usage._anchor_tokens(json.dumps({"_usage_anchor": {"prompt_tokens": 0}})) is None
    assert chat_usage._anchor_tokens(json.dumps({"_usage_anchor": {"prompt_tokens": 9}})) == 9


# ── TTS ─────────────────────────────────────────────────────────────────────

def test_speakable_text_strips_markdown_noise():
    md = ("## Título\nTexto **forte** e _leve_ 🎉 com [um link](https://x.y/z) e https://a.b/c\n"
          "```python\nprint('segredo')\n```\n- item um\n1. item dois\n"
          "| a | b |\n|---|---|\n| 1 | 2 |\n> citação")
    out = tts.speakable_text(md)
    assert "print" not in out and "segredo" not in out
    assert "(trecho de código omitido)" in out
    assert "https" not in out and "um link" in out
    assert "**" not in out and "#" not in out and "|" not in out and "🎉" not in out
    assert "Título." in out and "item um." in out and "a, b." in out and "citação." in out


def test_tts_requires_auth(client):
    assert client.post("/api/tts", json={"text": "oi"}).status_code in (401, 403)


def test_tts_validates_input(client, viewer_headers):
    assert client.post("/api/tts", json={"text": 3}, headers=viewer_headers).status_code == 400
    assert client.post("/api/tts", json={"text": "🎉"},
                       headers=viewer_headers).status_code == 400
    big = "palavra " * 1000
    assert client.post("/api/tts", json={"text": big}, headers=viewer_headers).status_code == 413


def test_tts_edge_default(client, viewer_headers, monkeypatch):
    monkeypatch.delenv("AGENTOS_TTS_PROVIDER", raising=False)
    monkeypatch.setattr(tts, "_dotenv_value", lambda name: "")
    seen = {}

    async def fake_edge(text, voice):
        seen["text"], seen["voice"] = text, voice
        return b"ID3audio", "audio/mpeg"

    monkeypatch.setattr(tts, "_edge", fake_edge)
    r = client.post("/api/tts", json={"text": "Olá **mundo**"}, headers=viewer_headers)
    assert r.status_code == 200
    assert r.content == b"ID3audio"
    assert r.headers["content-type"].startswith("audio/mpeg")
    assert r.headers["x-tts-engine"] == "edge"
    assert seen == {"text": "Olá mundo.", "voice": tts.DEFAULT_EDGE_VOICE}


def test_tts_kokoro_falls_back_to_edge(client, viewer_headers, monkeypatch):
    monkeypatch.setenv("AGENTOS_TTS_PROVIDER", "kokoro")

    async def broken_kokoro(text, voice, lang):
        raise tts.TTSError("kokoro: boom")

    async def fake_edge(text, voice):
        return b"ID3", "audio/mpeg"

    monkeypatch.setattr(tts, "_kokoro", broken_kokoro)
    monkeypatch.setattr(tts, "_edge", fake_edge)
    r = client.post("/api/tts", json={"text": "oi"}, headers=viewer_headers)
    assert r.status_code == 200
    assert r.headers["x-tts-engine"] == "edge"


def test_tts_kokoro_when_available(client, viewer_headers, monkeypatch):
    monkeypatch.setenv("AGENTOS_TTS_PROVIDER", "kokoro")
    monkeypatch.setenv("AGENTOS_KOKORO_VOICE", "pm_alex")

    async def fake_kokoro(text, voice, lang):
        assert (voice, lang) == ("pm_alex", "p")
        return b"RIFF", "audio/wav"

    monkeypatch.setattr(tts, "_kokoro", fake_kokoro)
    r = client.post("/api/tts", json={"text": "oi"}, headers=viewer_headers)
    assert r.status_code == 200
    assert r.headers["x-tts-engine"] == "kokoro"
    assert r.headers["content-type"].startswith("audio/wav")


def test_tts_rejects_bad_voice_config(client, viewer_headers, monkeypatch):
    monkeypatch.setenv("AGENTOS_TTS_VOICE", "x; rm -rf /")

    async def fake_edge(text, voice):
        assert voice == tts.DEFAULT_EDGE_VOICE
        return b"ID3", "audio/mpeg"

    monkeypatch.setattr(tts, "_edge", fake_edge)
    assert client.post("/api/tts", json={"text": "oi"}, headers=viewer_headers).status_code == 200


def test_tts_engine_failure_is_502(client, viewer_headers, monkeypatch):
    monkeypatch.delenv("AGENTOS_TTS_PROVIDER", raising=False)
    monkeypatch.setattr(tts, "_dotenv_value", lambda name: "")

    async def down(text, voice):
        raise tts.TTSError("edge: ConnectError")

    monkeypatch.setattr(tts, "_edge", down)
    r = client.post("/api/tts", json={"text": "oi"}, headers=viewer_headers)
    assert r.status_code == 502


def test_usage_mixed_actual_and_estimated_sums_per_row(client, admin_headers, _sandbox):
    pub, row = _session(client, admin_headers)
    hid = row["hermes_id"]
    _insert(_sandbox, id="a", chat_id=hid, api_call_count=1, cost_status="estimated",
            estimated_cost_usd=1.0, actual_cost_usd=0.0)
    _insert(_sandbox, id="b", chat_id=hid, api_call_count=1, cost_status="actual",
            estimated_cost_usd=1.5, actual_cost_usd=2.0, started_at=2.0)
    u = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers).json()
    assert u["cost"] == {"usd": 3.0, "status": "estimated"}


def test_usage_all_actual_is_labelled_actual(client, admin_headers, _sandbox):
    pub, row = _session(client, admin_headers)
    _insert(_sandbox, id="a", chat_id=row["hermes_id"], api_call_count=1, cost_status="actual",
            estimated_cost_usd=9.0, actual_cost_usd=0.5)
    u = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers).json()
    assert u["cost"] == {"usd": 0.5, "status": "actual"}


def test_tts_edge_timeout_is_502(client, viewer_headers, monkeypatch):
    import asyncio as _asyncio
    import sys
    import types
    monkeypatch.delenv("AGENTOS_TTS_PROVIDER", raising=False)
    monkeypatch.setattr(tts, "_dotenv_value", lambda name: "")
    monkeypatch.setattr(tts, "EDGE_TIMEOUT", 0.05)

    class Hang:
        def __init__(self, text, voice):
            pass

        async def stream(self):
            await _asyncio.sleep(5)
            yield {"type": "audio", "data": b"x"}

    monkeypatch.setitem(sys.modules, "edge_tts", types.SimpleNamespace(Communicate=Hang))
    r = client.post("/api/tts", json={"text": "trava"}, headers=viewer_headers)
    assert r.status_code == 502
    assert "timeout" in r.json()["detail"]


def test_usage_cost_ignores_zero_call_rows_consistently(client, admin_headers, _sandbox):
    pub, row = _session(client, admin_headers)
    hid = row["hermes_id"]
    _insert(_sandbox, id="z", chat_id=hid, api_call_count=0, cost_status="estimated",
            estimated_cost_usd=5.0)
    _insert(_sandbox, id="a", chat_id=hid, api_call_count=1, cost_status="actual",
            actual_cost_usd=2.0, started_at=2.0)
    u = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers).json()
    assert u["cost"] == {"usd": 2.0, "status": "actual"}


def test_usage_included_plan_is_labelled_included(client, admin_headers, _sandbox):
    pub, row = _session(client, admin_headers)
    _insert(_sandbox, id="a", chat_id=row["hermes_id"], api_call_count=3, cost_status="included")
    u = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers).json()
    assert u["cost"] == {"usd": 0.0, "status": "included"}


def test_usage_actual_zero_is_not_replaced_by_estimate(client, admin_headers, _sandbox):
    pub, row = _session(client, admin_headers)
    _insert(_sandbox, id="a", chat_id=row["hermes_id"], api_call_count=1, cost_status="actual",
            estimated_cost_usd=4.0, actual_cost_usd=0.0)
    u = client.get(f"/api/chat/sessions/{pub['id']}/usage", headers=admin_headers).json()
    assert u["cost"] == {"usd": 0.0, "status": "actual"}
