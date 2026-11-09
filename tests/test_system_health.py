"""Dependency health snapshot (dashboard + /system-health page)."""

from backend import auth, health


def _fake_probe(status: str, detail: str = "teste"):
    async def probe(client, service_id, label, url):
        return {
            "id": service_id,
            "label": label,
            "status": status,
            "detail": detail,
            "latency_ms": 1,
        }

    return probe


def _fake_local(service_id: str, label: str, path: str, writable: bool = False):
    return {
        "id": service_id,
        "label": label,
        "status": "ok",
        "detail": "acessível",
    }


def test_health_status_requires_auth(client):
    assert client.get("/api/health/status").status_code == 401


def test_health_status_reports_all_dependencies(client, admin_headers, monkeypatch):
    monkeypatch.setenv("AGENTOS_CHANNEL", "plugin")
    monkeypatch.setattr(health, "_probe", _fake_probe("ok"))
    monkeypatch.setattr(health, "_local_check", _fake_local)

    response = client.get("/api/health/status", headers=admin_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["checked_at"]
    assert [service["id"] for service in body["services"]] == [
        "agentos",
        "hermes",
        "channel",
        "database",
        "uploads",
    ]
    assert all(service["status"] == "ok" for service in body["services"])


def test_health_status_checks_canonical_auth_database(client, admin_headers, monkeypatch):
    monkeypatch.setenv("AGENTOS_CHANNEL", "plugin")
    monkeypatch.setattr(health, "_probe", _fake_probe("ok"))
    checked: dict[str, str] = {}

    def record_local(service_id: str, label: str, path: str, writable: bool = False):
        checked[service_id] = path
        return {"id": service_id, "label": label, "status": "ok", "detail": "acessível"}

    monkeypatch.setattr(health, "_local_check", record_local)

    client.get("/api/health/status", headers=admin_headers)

    assert checked["database"] == auth.DB_PATH


def test_health_status_degrades_on_down_dependency(client, admin_headers, monkeypatch):
    monkeypatch.setenv("AGENTOS_CHANNEL", "plugin")
    monkeypatch.setattr(health, "_probe", _fake_probe("down", "sem conexão"))
    monkeypatch.setattr(health, "_local_check", _fake_local)

    body = client.get("/api/health/status", headers=admin_headers).json()

    assert body["status"] == "degraded"
    assert {service["status"] for service in body["services"] if service["id"] in {"hermes", "channel"}} == {"down"}


def test_health_status_marks_legacy_http_channel_unknown(client, admin_headers, monkeypatch):
    monkeypatch.setenv("AGENTOS_CHANNEL", "http")
    monkeypatch.setattr(health, "_probe", _fake_probe("ok"))
    monkeypatch.setattr(health, "_local_check", _fake_local)

    body = client.get("/api/health/status", headers=admin_headers).json()

    channel = next(service for service in body["services"] if service["id"] == "channel")
    assert channel["status"] == "unknown"
    assert channel["detail"] == "modo HTTP legado"
