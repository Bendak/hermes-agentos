"""WI-10 (M7) lotes 3+4 — attribution semantics + parser resilience.

M7-03 (reachable⇒attributed), M7-07 (same-universe counts), F-M7-10/11
(disabled key semantics: slug/basename/frontmatter name), M7-05 (broken
frontmatter never hides a skill), M7-06 (type coercion), F-M7-12 (single read).
"""

import os

import yaml

import backend.skills_hub as skills_hub
from backend.config import settings
from backend.profile_discovery import PROFILES_DIR


def _invalidate_index() -> None:
    """O índice tem TTL de 5s — fixture criou/arquivou skill ⇒ zerar."""
    skills_hub._index_cache = None


def _skills_dir():
    return os.path.join(settings.AGENTOS_DATA_DIR, "skills")


def _mk_skill(where: str, relpath: str, frontmatter: str) -> None:
    d = os.path.join(where, *relpath.split("/"))
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "SKILL.md"), "w") as f:
        f.write(frontmatter)
    _invalidate_index()


def _fm(name: str, desc: str = "d") -> str:
    return f"---\nname: {name}\ndescription: {desc}\n---\ncorpo\n"


def _setup_profile(pname: str, config: dict) -> str:
    root = os.path.join(PROFILES_DIR, pname)
    os.makedirs(root, exist_ok=True)
    with open(os.path.join(root, "config.yaml"), "w") as f:
        yaml.safe_dump(config, f)
    _invalidate_index()
    return root


def test_disabled_matches_basename_and_frontmatter_name(client, admin_headers):
    """F-M7-11: disabled por frontmatter name (vocabulário Hermes) E por
    basename de slug aninhado (o drift que o nested universo expôs)."""
    _mk_skill(_skills_dir(), "anthropic-frontend-design", _fm("frontend-design"))
    _mk_skill(_skills_dir(), "autonomous-ai-agents/claude-code", _fm("claude-code"))

    # disabled por NAME de frontmatter + por BASENAME do slug aninhado
    _setup_profile("prof_dis", {
        "name": "prof_dis",
        "skills": {"disabled": ["frontend-design", "claude-code"]},
    })

    r = client.get("/api/profiles/skills-summary", headers=admin_headers)
    profs = {p["name"]: p for p in r.json()}
    p = profs.get("prof_dis")
    assert p, f"profile não listado: {sorted(profs)}"
    assert p["skills_disabled"] >= 2, (
        f"F-M7-11: disabled por name/basename não casou ({p})"
    )


def test_used_by_is_reachability_scoped(client, admin_headers):
    """M7-03: slug de external_dir de um profile só é atribuído a ELE
    (F-M7-10: default não herda); skills/ do próprio só a ele."""
    ext = os.path.join(settings.AGENTOS_DATA_DIR, "ext_prof_a")
    _mk_skill(ext, "so-no-external", _fm("so-no-external"))
    _setup_profile("prof_a", {
        "name": "prof_a",
        "skills": {"external_dirs": [ext]},
    })
    _setup_profile("prof_b", {"name": "prof_b"})
    root = os.path.join(PROFILES_DIR, "prof_b", "skills")
    _mk_skill(root, "so-no-prof-b", _fm("so-no-prof-b"))

    # skills de external_dirs não entram no LISTING (comportamento pré-existente)
    # — a atribuição é observável no mapa de Used by / contagens.
    from backend.skills_hub import get_profile_skills_map
    m = get_profile_skills_map()
    ext_slug = next(s for s in m if s.endswith("so-no-external"))
    assert m[ext_slug] == ["prof_a"], (
        f"M7-03/F-M7-10: external atribuído errado ({m[ext_slug]})"
    )

    # skill do prórpio profile é listada e atribuída só a ele
    r = client.get("/api/skills", headers=admin_headers)
    by_slug = {s["slug"]: s for s in r.json()}
    own_slug = "profiles/prof_b/so-no-prof-b"
    assert by_slug[own_slug]["profiles"] == ["prof_b"], (
        f"M7-03: skill própria atribuída errado ({by_slug[own_slug]['profiles']})"
    )


def test_broken_frontmatter_never_hides_skill(client, admin_headers):
    """M7-05: YAML ruim / fechamento sem newline final → skill visível com
    parse_error; detail responde 200 (sem 404 fantasma)."""
    _mk_skill(_skills_dir(), "yaml-quebrado", "---\nname: x\n  description: [1,2\n---\nfim")
    _mk_skill(_skills_dir(), "sem-newline", "---\nname: y\ndescription: d\n---")  # EOF direto

    r = client.get("/api/skills", headers=admin_headers)
    by_slug = {s["slug"]: s for s in r.json()}
    assert "yaml-quebrado" in by_slug, "M7-05: skill com YAML ruim sumiu da lista"
    assert by_slug["yaml-quebrado"]["parse_error"] is True
    assert "sem-newline" in by_slug, "M7-05: fechamento sem newline final escondeu skill"
    assert by_slug["sem-newline"]["parse_error"] is False

    for slug in ("yaml-quebrado", "sem-newline"):
        r = client.get(f"/api/skills/{slug}", headers=admin_headers)
        assert r.status_code == 200, f"M7-05: 404 fantasma em {slug}"


def test_types_are_coerced_to_strings(client, admin_headers):
    """M7-06: description null/int não vira None/list pra o front."""
    _mk_skill(_skills_dir(), "desc-nula", "---\nname: n\ndescription:\n---\nfim\n")
    _mk_skill(_skills_dir(), "desc-int", "---\nname: i\ndescription: 42\n---\nfim\n")

    r = client.get("/api/skills", headers=admin_headers)
    by_slug = {s["slug"]: s for s in r.json()}
    for slug in ("desc-nula", "desc-int"):
        d = by_slug[slug]["description"]
        assert isinstance(d, str), f"M7-06: {slug} description={d!r}"
