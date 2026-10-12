import logging
import os
import re
import time
from pathlib import Path

import yaml

from backend.config import settings

logger = logging.getLogger(__name__)

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


# ── Índice de skills (TTL) ──────────────────────────────────────────
# O adversarial mediu list ~850ms com walks redundantes por request; o índice
# faz UM walk + extração de frontmatter name por janela de TTL. É também a
# base da semântica de disabled (F-M7-11: Hermes keya por frontmatter name,
# AgentOS por dir name — o matcher aceita os DOIS).
_INDEX_TTL_SECONDS = 5.0
_index_cache: tuple[float, dict[str, dict]] | None = None

_FM_NAME_RE = re.compile(r"^---\s*\r?\n(.*?)(?:\r?\n)---", re.DOTALL)
_NAME_RE = re.compile(r"^name:\s*(.+?)\s*$", re.MULTILINE)


def _frontmatter_name(skill_dir: str) -> str:
    """Extrai só o `name:` do frontmatter (lê no máx 2KB — F-M7-12 em espírito:
    nada de ler o arquivo inteiro pra uma chave)."""
    try:
        with open(os.path.join(skill_dir, "SKILL.md"), "r", encoding="utf-8", errors="replace") as f:
            head = f.read(2048)
    except OSError:
        return ""
    m = _FM_NAME_RE.match(head)
    if not m:
        return ""
    n = _NAME_RE.search(m.group(1))
    return n.group(1).strip().strip("'\"") if n else ""


def _skill_index() -> dict[str, dict]:
    """{slug: {dir, basename, name}} — TTL-cached (5s)."""
    global _index_cache
    now = time.monotonic()
    if _index_cache is not None and now - _index_cache[0] < _INDEX_TTL_SECONDS:
        return _index_cache[1]
    idx: dict[str, dict] = {}
    for prefix, root in _skill_roots():
        for rel, d in _walk_skill_dirs(root).items():
            slug = f"{prefix}/{rel}" if prefix else rel
            idx[slug] = {
                "dir": d,
                "basename": os.path.basename(d),
                "name": _frontmatter_name(d),
            }
    _index_cache = (now, idx)
    return idx


def discover_skills() -> dict[str, str]:
    """{slug: skill_dir} — slug = relpath (shared) ou profiles/<p>/<relpath>
    (skills de profile). ÚNICO ponto que transforma nomes em paths: o
    resolver do detail consulta ESTE mapa, nunca faz join com input do
    usuário (M7-04 — contenção estrutural, não por blacklist)."""
    return {slug: e["dir"] for slug, e in _skill_index().items()}


def _disabled_keys(slug: str, entry: dict) -> set[str]:
    """Chaves que podem significar 'disabled' pra uma skill (F-M7-11):
    slug completo (vocabulário AgentOS), basename/dir name e frontmatter
    name (vocabulário do Hermes). Nos dois sentidos o drift existia."""
    keys = {slug, entry["basename"]}
    if entry["name"]:
        keys.add(entry["name"])
    return keys


def _is_disabled(slug: str, entry: dict, disabled: set[str]) -> bool:
    return bool(disabled) and bool(_disabled_keys(slug, entry) & disabled)


def _external_entries(config: dict) -> dict[str, dict]:
    """{slug: {dir, basename, name}} das external_dirs de um config
    (recursivo — umbrella packs eram invisíveis)."""
    out: dict[str, dict] = {}
    for d in config.get("skills", {}).get("external_dirs", []) or []:
        for rel, sd in _walk_skill_dirs(d).items():
            out[rel] = {
                "dir": sd,
                "basename": os.path.basename(sd),
                "name": _frontmatter_name(sd),
            }
    return out


def get_profile_skills_map() -> dict[str, list[str]]:
    """Return {skill_slug: [profile_name, ...]} for every skill.

    M7-03: atribuição por REACHABILITY (reachable ⇒ attributed) — um slug só
    ganha o profile se for alcançável pra ele (shared root menos disabled,
    skills/ do próprio profile, ou external_dirs DELE). O padrão antigo
    creditava todo slug não-disabled a todo profile (ex.: slugs de
    external_dirs de atlas/coder apareciam pra default/pipeline).
    F-M7-10 resolve junto (default só recebe os external do main config).
    F-M7-11: disabled casa por slug, basename/dir name OU frontmatter name
    (Hermes keya por name, o AgentOS keyava por dir — drift nos dois sentidos).
    """
    index = dict(_skill_index())
    shared_slugs = {s for s in index if not s.startswith("profiles/")}

    main_cfg = _read_yaml(MAIN_CONFIG)
    main_entries = _external_entries(main_cfg)
    main_disabled: set[str] = set(main_cfg.get("skills", {}).get("disabled", []) or [])

    all_slugs: set[str] = set(index) | set(main_entries)

    profile_names = _profile_names()  # M13-1: single source

    # entries conhecidos (shared + profiles + externals do main) p/ o matcher
    entries: dict[str, dict] = dict(index)
    entries.update(main_entries)

    slug_profiles: dict[str, list[str]] = {}

    for pname in profile_names:
        if pname == "default":
            cfg = main_cfg
            disabled = main_disabled
            own_slugs: set[str] = set()
            extra_entries = main_entries
        else:
            cfg_path = os.path.join(PROFILES_DIR, pname, "config.yaml")
            cfg = _read_yaml(cfg_path)
            profile_disabled: set[str] = set(cfg.get("skills", {}).get("disabled", []) or [])
            disabled = main_disabled | profile_disabled
            own_slugs = {s for s in index if s.startswith(f"profiles/{pname}/")}
            extra_entries = _external_entries(cfg)
            entries.update(extra_entries)

        reachable = shared_slugs | own_slugs | set(extra_entries)

        for slug in reachable:
            entry = entries.get(slug, {"basename": os.path.basename(slug), "name": ""})
            if _is_disabled(slug, entry, disabled):
                continue
            slug_profiles.setdefault(slug, []).append(pname)

    # todo slug descoberto existe no mapa (mesmo sem profile — "Unused")
    for slug in all_slugs:
        slug_profiles.setdefault(slug, [])

    return slug_profiles


# ── Skill parsing ──────────────────────────────────────────────────


# M7-08: cap de conteúdo (1MB) — preview derivado do MESMO texto (F-M7-12:
# o detail lia o arquivo 2x e o parse 1x; agora é uma leitura por request).
_SKILL_MD_PARSE_MAX_BYTES = 1024 * 1024

# M7-05: regex tolerante — BOM, \r\n e fechamento '---' no EOF sem newline
# derrubavam o parse e a skill sumia (404 errado pra skill instalada).
_FM_RE = re.compile(r"^---\s*\r?\n(.*?)\r?\n---\s*(?:\r?\n|$)", re.DOTALL)


def _parse_skill_md(skill_path: str, content: str | None = None) -> dict | None:
    """Parse a SKILL.md file's YAML frontmatter.

    M7-05: retorna shape de fallback (com parse_error) em vez de None quando o
    frontmatter é ruim — None agora significa 'arquivo não existe' (404
    honesto); parse ruim nunca mais esconde skill instalada.
    """
    try:
        if content is None:
            with open(skill_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(_SKILL_MD_PARSE_MAX_BYTES)
    except OSError:
        return None

    skill_dir = os.path.dirname(skill_path)
    dir_name = os.path.basename(skill_dir)
    category = _derive_category(dir_name)

    # Count files in skill directory
    file_count = sum(1 for _ in Path(skill_dir).rglob("*") if _.is_file())

    def _fallback(parse_error: bool = False) -> dict:
        return {
            "name": dir_name,
            "description": (content[:200] or "").strip(),
            "category": category,
            "icon": "",
            "file_count": file_count,
            "preview": "",
            "has_references": os.path.isdir(os.path.join(skill_dir, "references")),
            "has_scripts": os.path.isdir(os.path.join(skill_dir, "scripts")),
            "has_templates": os.path.isdir(os.path.join(skill_dir, "templates")),
            "parse_error": parse_error,
        }

    text = content.lstrip("\ufeff")  # BOM
    if not text.startswith("---"):
        return _fallback()

    match = _FM_RE.match(text)
    if not match:
        return _fallback(parse_error=True)

    try:
        frontmatter = yaml.safe_load(match.group(1))
    except Exception as e:  # M7-05: YAML ruim loga, não engole
        logger.warning("skills: frontmatter YAML inválido em %s: %s", skill_path, e)
        return _fallback(parse_error=True)

    if not isinstance(frontmatter, dict):
        return _fallback(parse_error=True)

    body = text[match.end():]
    preview = body[:300].strip() if body else ""

    # M7-06: coerção de tipos — yaml.safe_load devolve None/list/int pra
    # chaves mal preenchidas e o front derrubava a página em .toLowerCase()
    def _s(v) -> str:
        return v if isinstance(v, str) else ("" if v is None else str(v))

    return {
        "name": _s(frontmatter.get("name")) or dir_name,
        "description": _s(frontmatter.get("description")),
        "category": category,
        "icon": _s(frontmatter.get("icon")),
        "file_count": file_count,
        "preview": preview,
        "has_references": os.path.isdir(os.path.join(skill_dir, "references")),
        "has_scripts": os.path.isdir(os.path.join(skill_dir, "scripts")),
        "has_templates": os.path.isdir(os.path.join(skill_dir, "templates")),
        "parse_error": False,
    }


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

    # F-M7-12: UMA leitura — parse e full_content derivam do mesmo texto
    try:
        with open(skill_path, "r", encoding="utf-8", errors="replace") as f:
            full_content = f.read(_SKILL_MD_MAX_BYTES)
    except OSError:
        return None

    info = _parse_skill_md(skill_path, content=full_content)
    if not info:
        return None

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
    index = _skill_index()
    main_entries = _external_entries(main_cfg)
    entries: dict[str, dict] = dict(index)
    entries.update(main_entries)
    all_slugs: set[str] = set(index) | set(main_entries)

    def _count_universe(universe: set[str], disabled: set[str]) -> tuple[int, int]:
        """(enabled, disabled) — M7-07: MESMO universo dos dois lados (disabled
        de external_dirs/own skills nunca era subtraído) + F-M7-11: matcher."""
        n_dis = 0
        for slug in universe:
            entry = entries.get(slug, {"basename": os.path.basename(slug), "name": ""})
            if _is_disabled(slug, entry, disabled):
                n_dis += 1
        return len(universe) - n_dis, n_dis

    profiles: list[dict] = []

    # Default profile
    if os.path.exists(MAIN_CONFIG):
        enabled, dis = _count_universe(all_slugs, main_disabled)
        profiles.append({
            "name": "default",
            "model": (main_cfg.get("model", {}) or {}).get("default", ""),
            "provider": (main_cfg.get("model", {}) or {}).get("provider", ""),
            "skills_enabled": enabled,
            "skills_disabled": dis,
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

        # extra = external_dirs do profile + skills/ do próprio (M7-02)
        prof_entries = _external_entries(cfg)
        entries.update(prof_entries)
        extra = set(prof_entries) | {
            slug for slug in index
            if slug.startswith(f"profiles/{entry}/")
        }

        enabled, dis = _count_universe(all_slugs | extra, main_disabled | profile_disabled)

        profiles.append({
            "name": entry,
            "model": (cfg.get("model", {}) or {}).get("default", ""),
            "provider": (cfg.get("model", {}) or {}).get("provider", ""),
            "skills_enabled": enabled,
            "skills_disabled": dis,
            "external_dirs": cfg.get("skills", {}).get("external_dirs", []) or [],
        })

    return profiles
