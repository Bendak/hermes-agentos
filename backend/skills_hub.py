import os
import re
from pathlib import Path

import yaml

from backend.config import settings

SKILLS_DIR = os.path.join(settings.AGENTOS_DATA_DIR, "skills")
from backend.profile_discovery import (  # noqa: E402  (M10-16)
    MAIN_CONFIG,
    PROFILES_DIR,
    iter_sub_profile_ids,
)

# ── Category derivation from directory name prefix ──────────────────

_CATEGORY_RULES: list[tuple[str, str]] = [
    ("anthropic-", "Anthropic"),
    ("hermes-", "Hermes"),
    ("autonomous-", "Autonomous"),
    ("creative", "Creative"),
    ("diagramming-", "Creative"),
    ("data-", "Data Science"),
    ("devops", "DevOps"),
    ("debugging-", "Debugging"),
    ("document-", "Documents"),
    ("gaming", "Gaming"),
    ("github", "GitHub"),
    ("kanban", "Kanban"),
    ("llm-", "MLOps"),
    ("mcp", "MCP"),
    ("media", "Media"),
    ("ascii-", "Media"),
    ("baoyu-", "Creative"),
    ("mlops", "MLOps"),
    ("planning-", "Planning"),
    ("productivity", "Productivity"),
    ("red-", "Red Team"),
    ("research", "Research"),
    ("smart-", "Smart Home"),
    ("social", "Social"),
    ("software-", "Software"),
    ("ui-", "UI/UX"),
    ("web-", "Web"),
]


def _derive_category(dir_name: str) -> str:
    """Derive a human-readable category from a skill directory name."""
    lower = dir_name.lower()
    for prefix, category in _CATEGORY_RULES:
        if lower.startswith(prefix):
            return category
    return "Other"


# ── Profile / skill usage map ───────────────────────────────────────


def _read_yaml(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    except Exception:
        return {}


def _profile_names() -> list[str]:
    """Perfis vivos: 'default' (main config) + sub-perfis com config.yaml."""
    names: list[str] = []
    if os.path.exists(MAIN_CONFIG):
        names.append("default")
    names.extend(
        entry for entry in iter_sub_profile_ids()
        if os.path.isfile(os.path.join(PROFILES_DIR, entry, "config.yaml"))
    )
    return names


def _skill_roots() -> list[tuple[str, str]]:
    """(slug_prefix, root_dir) — M7-02: inclui profiles/<p>/skills/, nunca
    escaneados antes (27 SKILL.md viviam lá, 5 únicos)."""
    roots: list[tuple[str, str]] = [("", SKILLS_DIR)]
    for pname in _profile_names():
        if pname == "default":
            continue
        d = os.path.join(PROFILES_DIR, pname, "skills")
        if os.path.isdir(d):
            roots.append((f"profiles/{pname}", d))
    return roots


def _walk_skill_dirs(root: str) -> dict[str, str]:
    """{relpath: dir} recursivo (M7-01): qualquer dir com SKILL.md conta —
    umbrella packs (blender-pack/skills/<name>/, mlops/<area>/<name>/…) eram
    invisíveis num scan de um nível (inventário errado em ~6x). Poda dirs
    ocultos/node_modules/__pycache__/venv (F-M7-13)."""
    found: dict[str, str] = {}
    if not os.path.isdir(root):
        return found
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(
            d for d in dirnames
            if not d.startswith(".") and d not in ("node_modules", "__pycache__", "venv")
        )
        if "SKILL.md" in filenames:
            rel = os.path.relpath(dirpath, root)
            if rel != ".":
                found[rel.replace(os.sep, "/")] = dirpath
    return found


def discover_skills() -> dict[str, str]:
    """{slug: skill_dir} — slug = relpath (shared) ou profiles/<p>/<relpath>
    (skills de profile). ÚNICO ponto que transforma nomes em paths: o
    resolver do detail consulta ESTE mapa, nunca faz join com input do
    usuário (M7-04 — contenção estrutural, não por blacklist)."""
    out: dict[str, str] = {}
    for prefix, root in _skill_roots():
        for rel, d in _walk_skill_dirs(root).items():
            slug = f"{prefix}/{rel}" if prefix else rel
            out[slug] = d
    return out


def get_profile_skills_map() -> dict[str, list[str]]:
    """Return {skill_slug: [profile_name, ...]} for every skill."""
    # M7-01: descoberta recursiva (shared + profiles/<p>/skills)
    all_slugs: set[str] = set(discover_skills().keys())

    # Also gather slugs from external dirs referenced by profiles or main config
    def _external_slugs(config: dict) -> set[str]:
        slugs: set[str] = set()
        for d in config.get("skills", {}).get("external_dirs", []) or []:
            # recursivo também: umbrella packs em external_dirs eram invisíveis
            slugs.update(_walk_skill_dirs(d).keys())
        return slugs

    main_cfg = _read_yaml(MAIN_CONFIG)
    all_slugs |= _external_slugs(main_cfg)
    main_disabled: set[str] = set(main_cfg.get("skills", {}).get("disabled", []) or [])

    profile_names = _profile_names()  # M13-1: single source

    # Build map: slug -> list of profile names that have it enabled
    slug_profiles: dict[str, list[str]] = {s: [] for s in all_slugs}

    for pname in profile_names:
        if pname == "default":
            cfg = main_cfg
            # Default profile disabled list is the main config disabled list
            disabled = main_disabled
            extra_slugs = set()
        else:
            cfg_path = os.path.join(PROFILES_DIR, pname, "config.yaml")
            cfg = _read_yaml(cfg_path)
            profile_disabled: set[str] = set(cfg.get("skills", {}).get("disabled", []) or [])
            disabled = main_disabled | profile_disabled
            extra_slugs = _external_slugs(cfg)

        # Merge external-dir slugs into the global set
        for s in extra_slugs:
            if s not in slug_profiles:
                slug_profiles[s] = []

        for slug in slug_profiles:
            if slug not in disabled:
                slug_profiles[slug].append(pname)

    return slug_profiles


# ── Skill parsing ──────────────────────────────────────────────────


def _parse_skill_md(skill_path: str) -> dict | None:
    """Parse a SKILL.md file's YAML frontmatter."""
    try:
        with open(skill_path, "r", encoding="utf-8") as f:
            content = f.read()

        skill_dir = os.path.dirname(skill_path)
        dir_name = os.path.basename(skill_dir)
        category = _derive_category(dir_name)

        # Count files in skill directory
        file_count = sum(1 for _ in Path(skill_dir).rglob("*") if _.is_file())

        if not content.startswith("---"):
            return {
                "name": dir_name,
                "description": content[:200].strip(),
                "category": category,
                "icon": "",
                "file_count": file_count,
                "preview": "",
                "has_references": os.path.isdir(os.path.join(skill_dir, "references")),
                "has_scripts": os.path.isdir(os.path.join(skill_dir, "scripts")),
                "has_templates": os.path.isdir(os.path.join(skill_dir, "templates")),
            }

        match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
        if not match:
            return None

        frontmatter = yaml.safe_load(match.group(1))
        if not isinstance(frontmatter, dict):
            return None

        body = content[match.end():]
        preview = body[:300].strip() if body else ""

        return {
            "name": frontmatter.get("name", dir_name),
            "description": frontmatter.get("description", ""),
            "category": category,
            "icon": frontmatter.get("icon", ""),
            "file_count": file_count,
            "preview": preview,
            "has_references": os.path.isdir(os.path.join(skill_dir, "references")),
            "has_scripts": os.path.isdir(os.path.join(skill_dir, "scripts")),
            "has_templates": os.path.isdir(os.path.join(skill_dir, "templates")),
        }
    except Exception:
        return None


async def list_skills() -> list[dict]:
    """List all installed skills with profile usage info."""
    profile_map = get_profile_skills_map()

    skills = []
    for slug, skill_dir in sorted(discover_skills().items()):
        info = _parse_skill_md(os.path.join(skill_dir, "SKILL.md"))
        if info:
            info["slug"] = slug
            info["profiles"] = profile_map.get(slug, [])
            skills.append(info)

    return skills


# M7-08: teto de leitura de SKILL.md (o detail lia o arquivo inteiro sem
# limite; docs infladas não podem estourar memória do worker).
_SKILL_MD_MAX_BYTES = 512 * 1024


def _safe_skill_dir(slug: str) -> str | None:
    """M7-04: slug → skill_dir, ou None.

    Contenção ESTRUTURAL: o slug só resolve via o mapa de descoberta
    (chaves geradas pelo walk, não pelo usuário) — nunca é concatenado num
    path. `..`, separadores soltos ou qualquer slug fora do inventário
    simplesmente não existem no mapa. Caminhos aninhados (devops/kanban-worker)
    funcionam porque o mapa é recursivo (M7-01).
    """
    if not slug or "\x00" in slug or "\\" in slug:
        return None
    return discover_skills().get(slug)


async def get_skill_detail(slug: str) -> dict | None:
    """Get full detail of a skill including SKILL.md content."""
    skill_dir = _safe_skill_dir(slug)
    if skill_dir is None:
        return None
    skill_path = os.path.join(skill_dir, "SKILL.md")

    if not os.path.isfile(skill_path):
        return None

    info = _parse_skill_md(skill_path)
    if not info:
        return None

    with open(skill_path, "r", encoding="utf-8") as f:
        full_content = f.read(_SKILL_MD_MAX_BYTES)

    files = []
    for root, dirs, filenames in os.walk(skill_dir):
        for filename in filenames:
            filepath = os.path.join(root, filename)
            rel_path = os.path.relpath(filepath, skill_dir)
            files.append({
                "path": rel_path,
                "size": os.path.getsize(filepath),
            })

    profile_map = get_profile_skills_map()

    return {
        **info,
        "slug": slug,
        "profiles": profile_map.get(slug, []),
        "full_content": full_content,
        "files": files,
    }


async def list_profiles_summary() -> list[dict]:
    """Return summary info for each profile for the /api/profiles endpoint."""
    main_cfg = _read_yaml(MAIN_CONFIG)
    main_disabled: set[str] = set(main_cfg.get("skills", {}).get("disabled", []) or [])

    # Count total skills available (shared recursive + main external dirs)
    all_slugs: set[str] = set(discover_skills().keys())
    for d in main_cfg.get("skills", {}).get("external_dirs", []) or []:
        all_slugs.update(_walk_skill_dirs(d).keys())

    profiles: list[dict] = []

    # Default profile
    if os.path.exists(MAIN_CONFIG):
        total = len(all_slugs)
        profiles.append({
            "name": "default",
            "model": (main_cfg.get("model", {}) or {}).get("default", ""),
            "provider": (main_cfg.get("model", {}) or {}).get("provider", ""),
            "skills_enabled": total - len(main_disabled & all_slugs),
            "skills_disabled": len(main_disabled & all_slugs),
            "external_dirs": main_cfg.get("skills", {}).get("external_dirs", []) or [],
        })

    if not os.path.isdir(PROFILES_DIR):
        return profiles

    for entry in iter_sub_profile_ids():  # M13-1: single source
        prof_dir = os.path.join(PROFILES_DIR, entry)
        if not os.path.isfile(os.path.join(prof_dir, "config.yaml")):
            continue  # front-door policy: half-born profiles are not listed

        cfg = _read_yaml(os.path.join(prof_dir, "config.yaml"))
        profile_disabled: set[str] = set(cfg.get("skills", {}).get("disabled", []) or [])
        combined_disabled = (main_disabled | profile_disabled) & all_slugs

        # Also count extra skills from profile's own external dirs AND its
        # own skills/ dir (M7-02: nunca contadas — 27 SKILL.md invisíveis)
        extra = set()
        for d in cfg.get("skills", {}).get("external_dirs", []) or []:
            extra.update(_walk_skill_dirs(d).keys())
        extra.update(
            slug for slug in discover_skills()
            if slug.startswith(f"profiles/{entry}/")
        )

        total = len(all_slugs | extra)

        profiles.append({
            "name": entry,
            "model": (cfg.get("model", {}) or {}).get("default", ""),
            "provider": (cfg.get("model", {}) or {}).get("provider", ""),
            "skills_enabled": total - len(combined_disabled),
            "skills_disabled": len(combined_disabled),
            "external_dirs": cfg.get("skills", {}).get("external_dirs", []) or [],
        })

    return profiles
