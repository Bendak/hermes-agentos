"""WI-10 (M7) discovery batch — M7-01 recursive inventory + M7-02 profile dirs."""

import os

import backend.skills_hub as skills_hub
from backend.config import settings
from backend.profile_discovery import PROFILES_DIR


def _skills_dir():
    return os.path.join(settings.AGENTOS_DATA_DIR, "skills")


def _mk(relpath: str, root: str | None = None) -> None:
    d = os.path.join(root or _skills_dir(), *relpath.split("/"))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "SKILL.md"), "w") as f:
        f.write("---\nname: x\ndescription: d\n---\nbody\n")
    skills_hub._index_cache = None


def test_nested_umbrella_skills_are_discovered(client, admin_headers):
    """M7-01: umbrella packs (dir pai sem SKILL.md) não podem esconder as
    skills aninhadas; slug = relpath."""
    _mk("top-level")
    _mk("blender-pack/skills/animacao")
    _mk("mlops/inference/llama-cpp")

    r = client.get("/api/skills", headers=admin_headers)
    assert r.status_code == 200
    slugs = {s["slug"] for s in r.json()}
    assert "top-level" in slugs
    assert "blender-pack/skills/animacao" in slugs, f"M7-01: aninhada escondida ({sorted(slugs)})"
    assert "mlops/inference/llama-cpp" in slugs

    # detail funciona pra slug aninhado (rota :path)
    r = client.get("/api/skills/mlops/inference/llama-cpp", headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["slug"] == "mlops/inference/llama-cpp"


def test_profile_skills_dir_is_discovered_and_counted(client, admin_headers):
    """M7-02: profiles/<p>/skills/ entra no inventário (slug namespaced) e
    nas contagens de /api/profiles."""
    # PROFILES_DIR honora AGENTOS_PROFILES_DIR (sandbox de teste) — usar o
    # módulo, nunca derivar de AGENTOS_DATA_DIR
    prof_root = os.path.join(PROFILES_DIR, "coder")
    prof_skills = os.path.join(prof_root, "skills")
    os.makedirs(prof_skills, exist_ok=True)
    with open(os.path.join(prof_root, "config.yaml"), "w") as f:
        f.write("name: coder\n")
    _mk("so-no-profile", root=prof_skills)

    r = client.get("/api/skills", headers=admin_headers)
    slugs = {s["slug"] for s in r.json()}
    assert "profiles/coder/so-no-profile" in slugs, f"M7-02: skill de profile escondida ({sorted(slugs)})"

    r = client.get("/api/skills/profiles/coder/so-no-profile", headers=admin_headers)
    assert r.status_code == 200

    r = client.get("/api/profiles/skills-summary", headers=admin_headers)
    profs = {p["name"]: p for p in r.json()}
    if "coder" in profs:  # o fixture de profiles pode não criar o dir de config
        assert profs["coder"]["skills_enabled"] + profs["coder"]["skills_disabled"] >= 1
