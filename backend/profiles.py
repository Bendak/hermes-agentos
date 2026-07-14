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

from backend.auth import require_auth

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


def _read_config(profile_id: str) -> dict[str, Any]:
    path = _config_path(profile_id)
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Config not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _atomic_write(path: str, data: str) -> None:
    """Write data atomically: temp file in same dir, then rename."""
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(data)
        os.chmod(tmp, 0o644)
        os.rename(tmp, path)
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
    model = cfg.get("model", {}) or {}
    agent = cfg.get("agent", {}) or {}
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
    model = safe.get("model", {}) or {}
    agent = safe.get("agent", {}) or {}
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
    model: dict[str, Any] | None = None
    fallback_providers: list[str] | None = None
    toolsets: list[str] | None = None
    agent: dict[str, Any] | None = None
    description: str | None = None


class ProfileCreate(BaseModel):
    name: str
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
        except Exception:
            continue
    return results


@router.get("/{profile_id}")
async def get_profile(profile_id: str) -> dict[str, Any]:
    """Get full profile detail (editable fields only, sensitive stripped)."""
    pid = _sanitize_id(profile_id)
    try:
        cfg = _read_config(pid)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Profile not found")
    return _to_detail(pid, cfg)


@router.put("/{profile_id}")
async def update_profile(profile_id: str, body: ProfileUpdate) -> dict[str, Any]:
    """Update an existing profile's editable fields."""
    pid = _sanitize_id(profile_id)
    try:
        cfg = _read_config(pid)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Profile not found")

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


@router.post("")
async def create_profile(body: ProfileCreate) -> dict[str, Any]:
    """Create a new profile directory with config.yaml."""
    pid = _sanitize_id(body.name)
    dir_path = _profile_dir(pid)
    if os.path.exists(dir_path):
        raise HTTPException(status_code=409, detail=f"Profile '{pid}' already exists")

    os.makedirs(dir_path, exist_ok=True)

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


@router.delete("/{profile_id}")
async def delete_profile(profile_id: str) -> dict[str, Any]:
    """Delete a profile directory and its contents."""
    pid = _sanitize_id(profile_id)
    dir_path = _profile_dir(pid)
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=404, detail="Profile not found")

    # Recursively remove the profile directory
    import shutil
    shutil.rmtree(dir_path)
    return {"deleted": pid}


@router.post("/{profile_id}/duplicate")
async def duplicate_profile(profile_id: str, body: dict | None = None) -> dict[str, Any]:
    """Duplicate a profile. Optional 'name' in body for the new profile ID."""
    pid = _sanitize_id(profile_id)
    try:
        cfg = _read_config(pid)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Profile not found")

    new_name = (body or {}).get("name", f"{pid}-copy") if body else f"{pid}-copy"
    new_pid = _sanitize_id(new_name)
    new_dir = _profile_dir(new_pid)
    if os.path.exists(new_dir):
        raise HTTPException(status_code=409, detail=f"Profile '{new_pid}' already exists")

    os.makedirs(new_dir, exist_ok=True)
    yaml_text = yaml.safe_dump(cfg, default_flow_style=False, sort_keys=False, allow_unicode=True)
    _atomic_write(_config_path(new_pid), yaml_text)
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


@router.put("/{profile_id}/soul")
async def update_soul(profile_id: str, body: SoulUpdate) -> dict[str, Any]:
    """Write the SOUL.md content for a profile."""
    pid = _sanitize_id(profile_id)
    dir_path = _profile_dir(pid)
    if not os.path.isdir(dir_path):
        raise HTTPException(status_code=404, detail="Profile not found")
    soul_path = os.path.join(dir_path, "SOUL.md")
    _atomic_write(soul_path, body.content)
    return {"ok": True}