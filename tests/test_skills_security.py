"""WI-10 (M7) security batch — M7-04 path containment + M7-09 role gates."""

import os

import backend.skills_hub as skills_hub
from backend.config import settings


def _skills_dir():
    return os.path.join(settings.AGENTOS_DATA_DIR, "skills")


def _mk_skill(slug: str, content: str = "# T\nname: t\ndescription: d\n") -> None:
    d = os.path.join(_skills_dir(), slug)
    os.makedirs(d, exist_ok=True)
    with open(os.path.join(d, "SKILL.md"), "w") as f:
        f.write(content)
    skills_hub._index_cache = None


def test_slug_traversal_is_contained(client, admin_headers):
    """M7-04: `..` no slug não alcança fora de SKILLS_DIR."""
    _mk_skill("legit")
    # arquivo-alvo FORA do skills dir (na raiz do data dir)
    outside = os.path.join(settings.AGENTOS_DATA_DIR, "outside_secret.md")
    with open(outside, "w") as f:
        f.write("SECRET-CONTENT-DO-NOT-READ")

    for slug in ("../outside_secret", "..%2Foutside_secret", "..%2F..%2Fetc%2Fpasswd",
                 "legit%2F..%2F..%2Foutside_secret"):
        r = client.get(f"/api/skills/{slug}", headers=admin_headers)
        assert r.status_code in (404, 422), f"traversal passou: {slug} → {r.status_code}"
        if r.status_code == 200:  # pragma: no cover — defensivo
            assert "SECRET-CONTENT" not in r.text

    # URLs com `/` literal são normalizadas pelo CLIENTE (.. colapsa antes do
    # request e cai no SPA fallback) — o que chega ao resolver vem encoded;
    # o guard de vocabulário cobre os dois. Só garantimos que nada vaza:
    r = client.get("/api/skills/../../etc/passwd", headers=admin_headers)
    assert "SECRET-CONTENT" not in r.text

    # controle positivo: skill legítima segue legível pra admin
    r = client.get("/api/skills/legit", headers=admin_headers)
    assert r.status_code == 200


def test_skill_detail_is_admin_only(client, viewer_headers, admin_headers):
    """M7-09: SKILL.md completo + inventário não são pra viewer."""
    _mk_skill("privada")
    r = client.get("/api/skills/privada", headers=viewer_headers)
    assert r.status_code == 403, f"M7-09: viewer leu detail ({r.status_code})"
    r = client.get("/api/skills/privada", headers=admin_headers)
    assert r.status_code == 200


def test_config_reads_are_admin_only(client, viewer_headers, admin_headers):
    """M7-09: config.yaml tem campos secret-shaped (ex: `secret:`) —
    leitura é superfície de segredo, mesmo privilégio do PATCH."""
    for ep in ("/api/config", "/api/config/raw"):
        r = client.get(ep, headers=viewer_headers)
        assert r.status_code == 403, f"viewer leu {ep} ({r.status_code})"
        r = client.get(ep, headers=admin_headers)
        assert r.status_code == 200
