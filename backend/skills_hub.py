import os
import re
from pathlib import Path

import yaml

from backend.config import settings

SKILLS_DIR = os.path.join(settings.AGENTOS_DATA_DIR, "skills")
PROFILES_DIR = os.path.join(settings.AGENTOS_DATA_DIR, "profiles")
MAIN_CONFIG = os.path.join(settings.AGENTOS_DATA_DIR, "config.yaml")

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


def get_profile_skills_map() -> dict[str, list[str]]:
    """Return {skill_slug: [profile_name, ...]} for every skill."""
    # Gather all skill slugs from the skills directory
    all_slugs: set[str] = set()
    if os.path.isdir(SKILLS_DIR):
        for entry in os.listdir(SKILLS_DIR):
            if not entry.startswith(".") and os.path.isfile(
                os.path.join(SKILLS_DIR, entry, "SKILL.md")
            ):
                all_slugs.add(entry)

    # Also gather slugs from external dirs referenced by profiles or main config
    def _external_slugs(config: dict) -> set[str]:
        slugs: set[str] = set()
        for d in config.get("skills", {}).get("external_dirs", []) or []:
            if os.path.isdir(d):
                for entry in os.listdir(d):
                    if not entry.startswith(".") and os.path.isfile(
                        os.path.join(d, entry, "SKILL.md")
                    ):
                        slugs.add(entry)
        return slugs

    main_cfg = _read_yaml(MAIN_CONFIG)
    all_slugs |= _external_slugs(main_cfg)
    main_disabled: set[str] = set(main_cfg.get("skills", {}).get("disabled", []) or [])

    # Discover profiles
    profile_names: list[str] = []
    # Default profile
    if os.path.exists(MAIN_CONFIG):
        profile_names.append("default")
    if os.path.isdir(PROFILES_DIR):
        for entry in sorted(os.listdir(PROFILES_DIR)):
            if os.path.isdir(os.path.join(PROFILES_DIR, entry)) and not entry.startswith("."):
                profile_names.append(entry)

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
    if not os.path.isdir(SKILLS_DIR):
        return []

    profile_map = get_profile_skills_map()

    skills = []
    for entry in sorted(os.listdir(SKILLS_DIR)):
        if entry.startswith("."):
            continue

        skill_path = os.path.join(SKILLS_DIR, entry, "SKILL.md")
        if not os.path.isfile(skill_path):
            continue

        info = _parse_skill_md(skill_path)
        if info:
            info["slug"] = entry
            info["profiles"] = profile_map.get(entry, [])
            skills.append(info)

    return skills


async def get_skill_detail(slug: str) -> dict | None:
    """Get full detail of a skill including SKILL.md content."""
    skill_dir = os.path.join(SKILLS_DIR, slug)
    skill_path = os.path.join(skill_dir, "SKILL.md")

    if not os.path.isfile(skill_path):
        return None

    info = _parse_skill_md(skill_path)
    if not info:
        return None

    with open(skill_path, "r", encoding="utf-8") as f:
        full_content = f.read()

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

    # Count total skills available (default dir + main external dirs)
    all_slugs: set[str] = set()
    if os.path.isdir(SKILLS_DIR):
        for entry in os.listdir(SKILLS_DIR):
            if not entry.startswith(".") and os.path.isfile(
                os.path.join(SKILLS_DIR, entry, "SKILL.md")
            ):
                all_slugs.add(entry)
    for d in main_cfg.get("skills", {}).get("external_dirs", []) or []:
        if os.path.isdir(d):
            for entry in os.listdir(d):
                if not entry.startswith(".") and os.path.isfile(
                    os.path.join(d, entry, "SKILL.md")
                ):
                    all_slugs.add(entry)

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

    for entry in sorted(os.listdir(PROFILES_DIR)):
        prof_dir = os.path.join(PROFILES_DIR, entry)
        if not os.path.isdir(prof_dir) or entry.startswith("."):
            continue

        cfg = _read_yaml(os.path.join(prof_dir, "config.yaml"))
        profile_disabled: set[str] = set(cfg.get("skills", {}).get("disabled", []) or [])
        combined_disabled = (main_disabled | profile_disabled) & all_slugs

        # Also count extra skills from profile's own external dirs
        extra = set()
        for d in cfg.get("skills", {}).get("external_dirs", []) or []:
            if os.path.isdir(d):
                for e in os.listdir(d):
                    if not e.startswith(".") and os.path.isfile(
                        os.path.join(d, e, "SKILL.md")
                    ):
                        extra.add(e)

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
