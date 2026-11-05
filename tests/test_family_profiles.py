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
    (root / "familia_anna").mkdir(parents=True)
    (root / "coder").mkdir(parents=True)
    for name in ("familia_anna", "coder"):
        (root / name / "config.yaml").write_text(
            "model:\n  default: test-model\n  provider: ollama-cloud\n"
        )
    monkeypatch.setenv("AGENTOS_PROFILES_DIR", str(root))
    # profiles.py resolves PROFILES_DIR at import; reload is not needed because
    # the module reads it at import time — patch the module attribute instead.
    import backend.profile_discovery as discovery
    import backend.profiles as profiles
    monkeypatch.setattr(profiles, "PROFILES_DIR", str(root))
    monkeypatch.setattr(discovery, "PROFILES_DIR", str(root))
    return root


def test_selectable_list_hides_family_profiles(client, admin_headers, family_profiles):
    all_profiles = client.get("/api/profiles", headers=admin_headers).json()
    ids = {p["id"] for p in all_profiles}
    assert "familia_anna" in ids  # admin grid still sees it
    anna = next(p for p in all_profiles if p["id"] == "familia_anna")
    assert anna["selectable"] is False

    pickable = client.get("/api/profiles?selectable=1", headers=admin_headers).json()
    pids = {p["id"] for p in pickable}
    assert "familia_anna" not in pids
    assert "coder" in pids


def test_family_profile_cannot_be_a_kanban_assignee(client, admin_headers, family_profiles):
    for assignee in ("familia_anna", "Familia_Anna", "  FAMILIA_ANNA  "):
        r = client.post("/api/tasks", json={"title": "t1", "assignee": assignee}, headers=admin_headers)
        assert r.status_code == 400, (assignee, r.text)
    assert "não pode receber tarefas" in r.text

    ok = client.post("/api/tasks", json={"title": "t2", "assignee": "coder"}, headers=admin_headers)
    assert ok.status_code in (200, 201), ok.text

    # edição também bloqueia
    task_id = ok.json()["id"]
    bad = client.patch(f"/api/tasks/{task_id}", json={"assignee": "familia_anna"}, headers=admin_headers)
    assert bad.status_code == 400, bad.text
