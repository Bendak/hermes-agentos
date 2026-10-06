"""Agent Profile Editor backend — CRUD for profile config.yaml files.

Reads/writes YAML config files under /opt/data/profiles/{name}/config.yaml.
Uses yaml.safe_load / yaml.safe_dump exclusively.
Atomic writes via temp file + os.rename.
Never exposes api_key / token fields to the API.
"""

from __future__ import annotations

import os
import re
import tempfile
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth import require_auth, require_admin

PROFILES_DIR = os.environ.get("AGENTOS_PROFILES_DIR", "/opt/data/profiles")

# Fields that must NEVER be returned or edited via the API
_SENSITIVE_KEY_PATTERNS = re.compile(r"(api_key|token|secret|password)", re.IGNORECASE)

# Router — all endpoints use require_auth
router = APIRouter(prefix="/api/profiles", tags=["profiles"], dependencies=[Depends(require_auth)])


# ── Helpers ──────────────────────────────────────────────────────────

def _profile_dir(profile_id: str) -> str:
    return os.path.join(PROFILES_DIR, profile_id)


def _config_path(profile_id: str) -> str:
    return os.path.join(_profile_dir(profile_id), "config.yaml")


def _sanitize_id(profile_id: str) -> str:
    """Validate profile_id is a safe directory name (no path traversal)."""
    if not re.match(r"^[a-zA-Z0-9_-]+$", profile_id):
        raise HTTPException(status_code=400, detail="Profile ID must contain only letters, numbers, hyphens, or underscores")
    return profile_id


class ConfigParseError(Exception):
    """config.yaml exists but is not valid YAML (M10-08)."""
    def __init__(self, profile_id: str, message: str):
        self.profile_id = profile_id
        self.message = message
        super().__init__(f"Invalid config.yaml: {message}")


def _read_config(profile_id: str) -> dict[str, Any]:
    path = _config_path(profile_id)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Config not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    try:
        data = yaml.safe_load(text) or {}
    except yaml.YAMLError as e:
        raise ConfigParseError(profile_id, str(e)) from e
    # Wrong-shape configs PARSE but crash the API consumers (fixes2-verdict N1:
    # scalar `model:`, list root, ...). Treat them exactly like unparseable ones
    # so the 400 + replace:true repair machinery covers this class too.
    if not isinstance(data, dict):
        raise ConfigParseError(profile_id, f"top-level must be a mapping, got {type(data).__name__}")
    for key, typ in (("model", dict), ("agent", dict), ("fallback_providers", list), ("toolsets", list)):
        if key in data and data[key] is not None and not isinstance(data[key], typ):
            raise ConfigParseError(profile_id, f"'{key}' must be a {typ.__name__}, got {type(data[key]).__name__}")
    return data


def _profiles_owner() -> tuple[int, int] | None:
    """Canonical owner of profile files = owner of PROFILES_DIR (the gateway uid)."""
    try:
        st = os.stat(PROFILES_DIR)
        return st.st_uid, st.st_gid
    except OSError:
        return None


def _fix_owner(path: str) -> None:
    """Hand created/rewritten profile files to the profiles-dir owner.

    The API may run as root (container uvicorn) while every other profile
    consumer (Hermes gateway, dashboard describer) runs as the gateway uid.
    Root-owned files then break those writers with EACCES — even on REWRITE,
    where the atomic rename would silently change ownership of a gateway-owned
    file. Never follow symlinks (a symlinked config must not re-own its target).
    """
    owner = _profiles_owner()
    if owner is None:
        return
    try:
        os.chown(path, owner[0], owner[1], follow_symlinks=False)
    except (OSError, NotImplementedError):
        pass


def _atomic_write(path: str, data: str) -> None:
    """Write data atomically: temp file in same dir, then rename."""
    d = os.path.dirname(path)
    os.makedirs(d, mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
        # M10-15: preserve existing perms on rewrite; 0600 by default
        # (profile configs can carry provider api_keys).
        try:
            mode = os.stat(path).st_mode & 0o777
        except OSError:
            mode = 0o600
        os.chmod(tmp, mode)
        os.rename(tmp, path)
        _fix_owner(path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _strip_sensitive(d: dict[str, Any]) -> dict[str, Any]:
    """Recursively remove keys matching api_key/token/secret/password."""
    if not isinstance(d, dict):
        return d
    result = {}
    for k, v in d.items():
        if _SENSITIVE_KEY_PATTERNS.search(k):
            continue
        if isinstance(v, dict):
            result[k] = _strip_sensitive(v)
        elif isinstance(v, list):
            result[k] = [_strip_sensitive(item) if isinstance(item, dict) else item for item in v]
        else:
            result[k] = v
    return result


def _to_summary(profile_id: str, cfg: dict[str, Any]) -> dict[str, Any]:
    """Extract summary fields for grid display."""
    model = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}
    agent = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}
    return {
        "id": profile_id,
        "name": profile_id,
        "model": model.get("default", ""),
        "provider": model.get("provider", ""),
        "base_url": model.get("base_url", ""),
        "fallback_providers": cfg.get("fallback_providers", []) or [],
        "toolsets": cfg.get("toolsets", []) or [],
        "toolsets_count": len(cfg.get("toolsets", []) or []),
        "max_turns": agent.get("max_turns", 150),
        "gateway_timeout": agent.get("gateway_timeout", 1800),
    }


def _to_detail(profile_id: str, cfg: dict[str, Any]) -> dict[str, Any]:
    """Full editable detail (sensitive fields stripped)."""
    safe = _strip_sensitive(cfg)
    model = safe.get("model") if isinstance(safe.get("model"), dict) else {}
    agent = safe.get("agent") if isinstance(safe.get("agent"), dict) else {}
    return {
        "id": profile_id,
        "name": profile_id,
        "model": {
            "default": model.get("default", ""),
            "provider": model.get("provider", ""),
            "base_url": model.get("base_url", ""),
        },
        "fallback_providers": safe.get("fallback_providers", []) or [],
        "toolsets": safe.get("toolsets", []) or [],
        "agent": {
            "max_turns": agent.get("max_turns", 150),
            "gateway_timeout": agent.get("gateway_timeout", 1800),
            "restart_drain_timeout": agent.get("restart_drain_timeout", 180),
            "api_max_retries": agent.get("api_max_retries", 3),
            "tool_use_enforcement": agent.get("tool_use_enforcement", "auto"),
            "task_completion_guidance": agent.get("task_completion_guidance", True),
            "parallel_tool_call_guidance": agent.get("parallel_tool_call_guidance", True),
            "verify_on_stop": agent.get("verify_on_stop", True),
            "clarify_timeout": agent.get("clarify_timeout", 600),
        },
        "description": safe.get("description", ""),
    }


# ── Pydantic models ──────────────────────────────────────────────────

class ProfileUpdate(BaseModel):
    # replace=True rebuilds a fresh config when the existing one is unparseable
    # (repair path for broken profiles, M10-08).
    replace: bool = False
    model: dict[str, Any] | None = None
    fallback_providers: list[str] | None = None
    toolsets: list[str] | None = None
    agent: dict[str, Any] | None = None
    description: str | None = None


class ProfileCreate(BaseModel):
    # Frontend historically sent 'id'; accept either (M10-01).
    name: str | None = None
    id: str | None = None
    model: dict[str, Any] | None = None
    fallback_providers: list[str] | None = None
    toolsets: list[str] | None = None
    agent: dict[str, Any] | None = None
    description: str | None = None


# ── Endpoints ────────────────────────────────────────────────────────

@router.get("")
async def list_profiles() -> list[dict[str, Any]]:
    """List all profiles in a summary format for grid display."""
    if not os.path.isdir(PROFILES_DIR):
        return []
    results = []
    for entry in sorted(os.listdir(PROFILES_DIR)):
        dir_path = os.path.join(PROFILES_DIR, entry)
        if not os.path.isdir(dir_path):
            continue
        cfg_path = os.path.join(dir_path, "config.yaml")
        if not os.path.isfile(cfg_path):
            continue
        try:
            cfg = _read_config(entry)
            results.append(_to_summary(entry, cfg))
        except Exception as e:
            # Broken config must NOT vanish from the list (M10-08) — surface
            # a degraded entry with the error so the UI can offer a repair.
            results.append({
                "id": entry,
                "name": entry,
                "model": "",
                "provider": "",
                "base_url": "",
                "fallback_providers": [],
                "toolsets": [],
                "toolsets_count": 0,
                "max_turns": 0,
                "gateway_timeout": 0,
                "error": f"Invalid config.yaml: {getattr(e, 'message', str(e))}",
            })
    return results


@router.get("/{profile_id}")
async def get_profile(profile_id: str) -> dict[str, Any]:
    """Get full profile detail (editable fields only, sensitive stripped)."""
    pid = _sanitize_id(profile_id)
    try:
        cfg = _read_config(pid)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Profile not found")
    except ConfigParseError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _to_detail(pid, cfg)


@router.put("/{profile_id}", dependencies=[Depends(require_admin)])
async def update_profile(profile_id: str, body: ProfileUpdate) -> dict[str, Any]:
    """Update an existing profile's editable fields."""
    pid = _sanitize_id(profile_id)
    if not os.path.isdir(_profile_dir(pid)):
        raise HTTPException(status_code=404, detail="Profile not found")
    try:
        cfg = _read_config(pid)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Profile not found")
    except ConfigParseError as e:
        if not body.replace:
            raise HTTPException(status_code=400, detail=str(e))
        # Repair path: rebuild a fresh config from the submitted fields.
        cfg = {}

    # Merge updates into existing config (preserving all other keys)
    if body.model is not None:
        existing_model = cfg.get("model", {}) or {}
        for k, v in body.model.items():
            existing_model[k] = v
        cfg["model"] = existing_model

    if body.fallback_providers is not None:
        cfg["fallback_providers"] = body.fallback_providers

    if body.toolsets is not None:
        cfg["toolsets"] = body.toolsets

    if body.agent is not None:
        existing_agent = cfg.get("agent", {}) or {}
        for k, v in body.agent.items():
            existing_agent[k] = v
        cfg["agent"] = existing_agent

    if body.description is not None:
        cfg["description"] = body.description

    yaml_text = yaml.safe_dump(cfg, default_flow_style=False, sort_keys=False, allow_unicode=True)
    _atomic_write(_config_path(pid), yaml_text)
    return _to_detail(pid, cfg)


@router.post("", dependencies=[Depends(require_admin)])
async def create_profile(body: ProfileCreate) -> dict[str, Any]:
    """Create a new profile directory with config.yaml."""
    raw = (body.name or body.id or "").strip()
    if not raw:
        raise HTTPException(status_code=400, detail="'name' is required")
    pid = _sanitize_id(raw)
    dir_path = _profile_dir(pid)
    if os.path.exists(dir_path):
        raise HTTPException(status_code=409, detail=f"Profile '{pid}' already exists")

    os.makedirs(dir_path, mode=0o700, exist_ok=True)
    _fix_owner(dir_path)

    cfg: dict[str, Any] = {
        "model": {
            "base_url": (body.model or {}).get("base_url", ""),
            "default": (body.model or {}).get("default", ""),
            "provider": (body.model or {}).get("provider", ""),
        },
        "providers": {},
        "fallback_providers": body.fallback_providers or [],
        "toolsets": body.toolsets or ["hermes-cli"],
        "agent": {
            "max_turns": (body.agent or {}).get("max_turns", 150),
            "gateway_timeout": (body.agent or {}).get("gateway_timeout", 1800),
            "restart_drain_timeout": 180,
            "api_max_retries": 3,
            "tool_use_enforcement": "auto",
            "verify_on_stop": True,
        },
    }

    if body.description:
        cfg["description"] = body.description

    yaml_text = yaml.safe_dump(cfg, default_flow_style=False, sort_keys=False, allow_unicode=True)
    _atomic_write(_config_path(pid), yaml_text)
    return _to_detail(pid, cfg)


@router.delete("/{profile_id}", dependencies=[Depends(require_admin)])
async def delete_profile(profile_id: str, purge: bool = False) -> dict[str, Any]:
    """Delete a profile's configuration (config.yaml + SOUL.md).

    Durable data (state.db, memories/, auth.json, skills/, backups/) is
    PRESERVED by default — a full rmtree is destructive and must be explicitly
    requested with ?purge=true (M10-03).
    """
    pid = _sanitize_id(profile_id)
    dir_path = _profile_dir(pid)
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=404, detail="Profile not found")

    import shutil
    if purge:
        shutil.rmtree(dir_path)
        return {"deleted": pid, "purged": True}

    removed = []
    for name in ("config.yaml", "SOUL.md"):
        f = os.path.join(dir_path, name)
        if os.path.isfile(f):
            os.unlink(f)
            removed.append(name)
    # clean up the directory only if nothing durable is left
    try:
        if not os.listdir(dir_path):
            os.rmdir(dir_path)
    except OSError:
        pass
    return {"deleted": pid, "purged": False, "removed": removed}


@router.post("/{profile_id}/duplicate", dependencies=[Depends(require_admin)])
async def duplicate_profile(profile_id: str, body: dict | None = None) -> dict[str, Any]:
    """Duplicate a profile. Optional 'name' in body for the new profile ID."""
    pid = _sanitize_id(profile_id)
    try:
        cfg = _read_config(pid)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Profile not found")
    except ConfigParseError as e:
        raise HTTPException(status_code=400, detail=str(e))

    new_name = (body or {}).get("name", f"{pid}-copy") if body else f"{pid}-copy"
    new_pid = _sanitize_id(new_name)
    new_dir = _profile_dir(new_pid)
    if os.path.exists(new_dir):
        raise HTTPException(status_code=409, detail=f"Profile '{new_pid}' already exists")

    os.makedirs(new_dir, mode=0o700, exist_ok=True)
    yaml_text = yaml.safe_dump(cfg, default_flow_style=False, sort_keys=False, allow_unicode=True)
    _atomic_write(_config_path(new_pid), yaml_text)

    # Copy identity + capability files (M10-06): SOUL.md, skills/, plugins/,
    # cron/. Runtime DATA (state.db, memories/, auth.json, backups/) is not
    # duplicated.
    import shutil
    src_soul = os.path.join(_profile_dir(pid), "SOUL.md")
    if os.path.isfile(src_soul):
        shutil.copy2(src_soul, os.path.join(new_dir, "SOUL.md"))
    for cap_dir in ("skills", "plugins", "cron"):
        src_cap = os.path.join(_profile_dir(pid), cap_dir)
        if os.path.isdir(src_cap):
            shutil.copytree(src_cap, os.path.join(new_dir, cap_dir), dirs_exist_ok=True, symlinks=True)

    # everything in the copy belongs to the canonical owner (root-safe)
    _fix_owner(new_dir)
    for root, dirs, files in os.walk(new_dir):
        for name in dirs + files:
            _fix_owner(os.path.join(root, name))

    return _to_detail(new_pid, cfg)


# ── SOUL.md endpoints ───────────────────────────────────────────────

class SoulUpdate(BaseModel):
    content: str


@router.get("/{profile_id}/soul")
async def get_soul(profile_id: str) -> dict[str, Any]:
    """Return the SOUL.md content for a profile."""
    pid = _sanitize_id(profile_id)
    dir_path = _profile_dir(pid)
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=404, detail="Profile not found")
    soul_path = os.path.join(dir_path, "SOUL.md")
    if not os.path.isfile(soul_path):
        return {"content": ""}
    with open(soul_path, "r", encoding="utf-8") as f:
        return {"content": f.read()}


@router.put("/{profile_id}/soul", dependencies=[Depends(require_admin)])
async def update_soul(profile_id: str, body: SoulUpdate) -> dict[str, Any]:
    """Write the SOUL.md content for a profile."""
    pid = _sanitize_id(profile_id)
    dir_path = _profile_dir(pid)
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=404, detail="Profile not found")
    soul_path = os.path.join(dir_path, "SOUL.md")
    _atomic_write(soul_path, body.content)
    return {"ok": True}