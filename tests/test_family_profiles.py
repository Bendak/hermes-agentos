"""Lote 2: profiles de família são chat-only (fora do kanban e de pickers).

Cobre: filtro `?selectable=1` na lista de profiles e bloqueio de assignee
reservado na criação/edição de task.
"""

import os
import pathlib

import pytest


@pytest.fixture()
def family_profiles(tmp_path, monkeypatch):
    root = tmp_path / "profiles"
    (root / "private_a").mkdir(parents=True)
    (root / "coder").mkdir(parents=True)
    for name in ("private_a", "coder"):
        (root / name / "config.yaml").write_text(
            "model:\n  default: test-model\n  provider: ollama-cloud\n"
        )
    monkeypatch.setenv("AGENTOS_PROFILES_DIR", str(root))
    # profiles.py resolves PROFILES_DIR at import; reload is not needed because
    # the module reads it at import time — patch the module attribute instead.
    import backend.agents as agents
    import backend.profile_discovery as discovery
    import backend.profiles as profiles
    monkeypatch.setattr(profiles, "PROFILES_DIR", str(root))
    monkeypatch.setattr(discovery, "PROFILES_DIR", str(root))
    monkeypatch.setattr(agents, "PROFILES_DIR", str(root))
    return root


def test_selectable_list_hides_family_profiles(client, admin_headers, family_profiles):
    all_profiles = client.get("/api/profiles", headers=admin_headers).json()
    ids = {p["id"] for p in all_profiles}
    assert "private_a" in ids  # admin grid still sees it
    user_c = next(p for p in all_profiles if p["id"] == "private_a")
    assert user_c["selectable"] is False

    pickable = client.get("/api/profiles?selectable=1", headers=admin_headers).json()
    pids = {p["id"] for p in pickable}
    assert "private_a" not in pids
    assert "coder" in pids


def test_family_profile_cannot_be_a_kanban_assignee(client, admin_headers, family_profiles):
    for assignee in ("private_a", "Private_A", "  PRIVATE_A  "):
        r = client.post("/api/tasks", json={"title": "t1", "assignee": assignee}, headers=admin_headers)
        assert r.status_code == 400, (assignee, r.text)
    assert "não pode receber tarefas" in r.text

    ok = client.post("/api/tasks", json={"title": "t2", "assignee": "coder"}, headers=admin_headers)
    assert ok.status_code in (200, 201), ok.text

    # edição também bloqueia
    task_id = ok.json()["id"]
    bad = client.patch(f"/api/tasks/{task_id}", json={"assignee": "private_a"}, headers=admin_headers)
    assert bad.status_code == 400, bad.text


def test_viewer_cannot_read_hidden_profile_content(client, admin_headers, viewer_headers, family_profiles):
    # viewer não vê nem o nome na lista
    listed = client.get("/api/profiles", headers=viewer_headers).json()
    assert all(p["id"] != "private_a" for p in listed)

    # ...nem o detail nem o SOUL
    # 404 (não 403): não confirma nem a existência do profile escondido
    assert client.get("/api/profiles/private_a", headers=viewer_headers).status_code == 404
    assert client.get("/api/profiles/private_a/soul", headers=viewer_headers).status_code == 404

    # /api/agents* e skills-summary não podem vazar nome/SOUL/profile
    agents = client.get("/api/agents", headers=viewer_headers).json()
    assert all(a["id"] != "private_a" for a in agents)
    assert client.get("/api/agents/private_a", headers=viewer_headers).status_code == 404
    assert client.get("/api/agents/private_a/health", headers=viewer_headers).status_code == 404
    summary = client.get("/api/profiles/skills-summary", headers=viewer_headers).json()
    assert all("private_a" not in str(row) for row in summary)

    # admin vê tudo
    assert any(a["id"] == "private_a" for a in client.get("/api/agents", headers=admin_headers).json())

    # admin lê normalmente
    assert client.get("/api/profiles/private_a", headers=admin_headers).status_code == 200
    assert client.get("/api/profiles/private_a/soul", headers=admin_headers).status_code == 200

    # profile normal continua visível para viewer
    assert client.get("/api/profiles/coder", headers=viewer_headers).status_code == 200


def test_empty_hidden_env_is_fail_closed(client, admin_headers, family_profiles, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "HIDDEN_PROFILES", "   ")
    r = client.post("/api/tasks", json={"title": "t3", "assignee": "private_a"}, headers=admin_headers)
    assert r.status_code == 400, r.text
    ids = {p["id"] for p in client.get("/api/profiles?selectable=1", headers=admin_headers).json()}
    assert "private_a" not in ids


def test_non_string_assignee_is_rejected(client, admin_headers, family_profiles):
    for bad in (1234, 1, {"x": 1}, ["a"]):
        r = client.post("/api/tasks", json={"title": "t4", "assignee": bad}, headers=admin_headers)
        assert r.status_code == 400, (bad, r.text)


def test_bulk_update_with_hidden_assignee_is_400(client, admin_headers, family_profiles):
    ok = client.post("/api/tasks", json={"title": "t5", "assignee": "coder"}, headers=admin_headers)
    tid = ok.json()["id"]
    r = client.post("/api/tasks/bulk", json={"ids": [tid], "updates": {"assignee": "private_a"}},
                    headers=admin_headers)
    assert r.status_code == 400, r.text


def test_viewer_session_and_analytics_are_scoped(client, admin_headers, viewer_headers, family_profiles):
    # viewer não lista sessões de outros profiles (sandbox sem state.db: vazio)
    r = client.get("/api/sessions", headers=viewer_headers)
    assert r.status_code == 200
    assert r.json()["total"] == 0
    assert all(not str(x.get("profile", "")).startswith("familia") for x in r.json()["sessions"])

    # busca também não devolve nada de família
    rs = client.get("/api/sessions/search?q=teste", headers=viewer_headers)
    assert rs.status_code == 200
    assert all(not str(h.get("profile", "")).startswith("familia") for h in rs.json())

    # analytics é operação: admin-only
    assert client.get("/api/analytics/tokens", headers=viewer_headers).status_code == 403
    assert client.get("/api/analytics/tokens", headers=admin_headers).status_code == 200
