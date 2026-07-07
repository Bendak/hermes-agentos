import os
import re
from pathlib import Path

import yaml

from backend.config import settings


SKILLS_DIR = os.path.join(settings.AGENTOS_DATA_DIR, "skills")


def _parse_skill_md(skill_path: str) -> dict | None:
    """Parse a SKILL.md file's YAML frontmatter."""
    try:
        with open(skill_path, "r", encoding="utf-8") as f:
            content = f.read()

        # Extract YAML frontmatter (between --- markers)
        if not content.startswith("---"):
            # Some skills might not have frontmatter — extract from first heading/description
            return {
                "name": os.path.basename(os.path.dirname(skill_path)),
                "description": content[:200].strip(),
                "category": "uncategorized",
            }

        # Find the closing ---
        match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
        if not match:
            return None

        frontmatter = yaml.safe_load(match.group(1))
        if not isinstance(frontmatter, dict):
            return None

        # Count files in skill directory
        skill_dir = os.path.dirname(skill_path)
        file_count = sum(1 for _ in Path(skill_dir).rglob("*") if _.is_file())

        # Get body (content after frontmatter) for a preview
        body = content[match.end():]
        preview = body[:300].strip() if body else ""

        return {
            "name": frontmatter.get("name", os.path.basename(skill_dir)),
            "description": frontmatter.get("description", ""),
            "category": frontmatter.get("category", "uncategorized"),
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
    """List all installed skills."""
    if not os.path.isdir(SKILLS_DIR):
        return []

    skills = []
    for entry in sorted(os.listdir(SKILLS_DIR)):
        # Skip hidden directories and files
        if entry.startswith("."):
            continue

        skill_path = os.path.join(SKILLS_DIR, entry, "SKILL.md")
        if not os.path.isfile(skill_path):
            continue

        info = _parse_skill_md(skill_path)
        if info:
            info["slug"] = entry
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

    # Read full SKILL.md
    with open(skill_path, "r", encoding="utf-8") as f:
        full_content = f.read()

    # List all files in the skill directory
    files = []
    for root, dirs, filenames in os.walk(skill_dir):
        for filename in filenames:
            filepath = os.path.join(root, filename)
            rel_path = os.path.relpath(filepath, skill_dir)
            files.append({
                "path": rel_path,
                "size": os.path.getsize(filepath),
            })

    return {
        **info,
        "slug": slug,
        "full_content": full_content,
        "files": files,
    }
