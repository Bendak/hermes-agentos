"""Agent Profile Editor backend — CRUD for profile config.yaml files.

Reads/writes YAML config files under /opt/data/profiles/{name}/config.yaml.
Uses yaml.safe_load / yaml.safe_dump exclusively.
Atomic writes via temp file + os.rename.
Never exposes api_key / token fields to the API.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.auth import require_auth, require_admin

logger = logging.getLogger(__name__)

from backend.profile_discovery import (  # noqa: E402  (M10-16 single source)
    DEFAULT_PROFILE_ID,
    PROFILES_DIR,
    iter_sub_profile_ids,
)


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
    if profile_id.lower() == DEFAULT_PROFILE_ID:  # M12-1b: case-insensitive
        raise HTTPException(status_code=400,
                            detail="'default' is reserved for the root config profile")
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
        logger.warning("_profiles_owner() unavailable — %s keeps its current owner", path)
        return
    try:
        os.chown(path, owner[0], owner[1], follow_symlinks=False)
    except (OSError, NotImplementedError):
        # never follow a symlink target; but never stay silent either — a
        # swallowed chown failure reproduces the original bug class unseen
        # (adversarial M1). On rewrite the dir owner is stamped by design:
        # a third-uid owner is deliberately reassigned.
        logger.warning("Could not restore canonical owner on %s", path, exc_info=True)


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
        "max_turns": agent.get("max_turns", _AGENT_DEFAULTS["max_turns"]),
        "gateway_timeout": agent.get("gateway_timeout", _AGENT_DEFAULTS["gateway_timeout"]),
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
            "api_mode": model.get("api_mode", ""),
        },
        "fallback_providers": safe.get("fallback_providers", []) or [],
        "toolsets": safe.get("toolsets", []) or [],
        # Effective values with GATEWAY defaults (never invented ones) —
        # create persists every key so the round-trip cannot lie (M10-07).
        "agent": {k: agent.get(k, d) for k, d in _AGENT_DEFAULTS.items()},
        "description": safe.get("description", ""),
    }


# ── Validation layer (M10-07 / M10-12 / M11-1 / M11-2) ───────────────────
# Everything below lands in the config.yaml the gateway loads: unknown keys
# and wrong types must be rejected at the door, never persisted — and junk
# already sitting in the file must not survive an API rewrite (prune).

# Value tuples use EXACT types (type(v) is t) — bool/int confusion and numeric
# subclasses are rejected (WT-2); negatives are rejected everywhere (WT-3).
_MODEL_KEYS: dict[str, tuple] = {
    "default": (str,),
    "provider": (str,),
    "base_url": (str,),
    "api_mode": (str,),  # honored by the gateway runtime (M11-2b)
}

# Full gateway agent schema (hermes_cli.config_defaults, 46 keys) PLUS the 4
# keys present in every production config (personalities, reasoning_effort,
# verbose, inherit_mcp_toolsets) — whitelist = schema ∪ observed (M11-2).
_AGENT_SCHEMA: dict[str, tuple] = {
    "agent_cache": (dict,),
    "api_max_retries": (int,),
    "auto_recovery_cycles": (int,),
    "bot_mode_protocol": (bool,),
    "budget_warning_ratio": (type(None), int, float),
    "build_wait_timeout": (int,),
    "clarify_timeout": (int,),
    "coding_context": (str,),
    "coding_instructions": (str,),
    "cron_drain_timeout": (int,),
    "disabled_toolsets": (list,),
    "empty_response_guard": (dict,),
    "environment_hint": (str,),
    "environment_probe": (bool,),
    "execution_guidance": (str,),
    "fast_auto_seconds": (int,),
    "gateway_auto_continue_freshness": (int,),
    "gateway_notify_interval": (int,),
    "gateway_startup_restore_drain_timeout": (int,),
    "gateway_startup_warmup_timeout": (int,),
    "gateway_timeout": (int,),
    "gateway_timeout_warning": (int,),
    "gateway_turn_lease_timeout": (int,),
    "image_input_mode": (str,),
    "intent_ack_continuation": (str,),
    "local_stream_stale_timeout": (int,),
    "max_turns": (type(None), int),
    "max_verify_nudges": (int,),
    "parallel_tool_call_guidance": (bool,),
    "reasoning_echo": (bool,),
    "reasoning_overrides": (dict,),
    "reconnect_attention_after": (int,),
    "restart_after_turn_timeout": (int,),
    "restart_drain_timeout": (int,),
    "run_budget_seconds": (type(None), int, float),
    "sanitizer_heal_escalation_threshold": (int,),
    "service_tier": (str,),
    "session_stall_timeout": (int,),
    "stall_guards": (bool,),
    "stream_drain_timeout": (int, float),
    "task_completion_guidance": (bool,),
    "text_verbosity": (str,),
    "tool_use_enforcement": (str,),
    "turn_liveness": (dict,),
    "verify_guidance": (bool,),
    "verify_on_stop": (bool,),
    # observed in every production config (schema-adjacent, gateway-honored)
    "personalities": (dict,),
    "reasoning_effort": (str,),
    "verbose": (bool,),
    "inherit_mcp_toolsets": (bool,),
}

# UI-editable subset — create persists these (over the gateway defaults).
_AGENT_UI_KEYS: tuple = (
    "max_turns",
    "gateway_timeout",
    "restart_drain_timeout",
    "api_max_retries",
    "clarify_timeout",
    "tool_use_enforcement",
    "task_completion_guidance",
    "parallel_tool_call_guidance",
    "verify_on_stop",
)

# Gateway defaults taken VERBATIM from hermes_cli.config_defaults (M11-2 note:
# the old hardcoded values diverged from the gateway on 4 of 9 keys).
_AGENT_DEFAULTS: dict[str, Any] = {
    "max_turns": None,
    "gateway_timeout": 1800,
    "restart_drain_timeout": 0,
    "api_max_retries": 3,
    "clarify_timeout": 3600,
    "tool_use_enforcement": "auto",
    "task_completion_guidance": True,
    "parallel_tool_call_guidance": True,
    "verify_on_stop": False,
}


def _checked_kv(section: str, data: Any, spec: dict[str, tuple]) -> dict[str, Any]:
    """Whitelist + exact-type-check a model/agent patch; reject unknown keys."""
    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail=f"'{section}' must be a mapping")
    out: dict[str, Any] = {}
    for k, v in data.items():
        allowed = spec.get(k)
        if allowed is None:
            raise HTTPException(status_code=400, detail=f"Unknown {section} key: '{k}'")
        if not any(type(v) is t for t in allowed):
            names = "/".join(t.__name__ for t in allowed)
            raise HTTPException(status_code=400, detail=f"{section}.{k} must be {names}")
        if isinstance(v, (int, float)) and not (0 <= v <= 10**7):
            raise HTTPException(status_code=400,
                                detail=f"{section}.{k} must be between 0 and 10000000")
        out[k] = v
    return out


def _prune_section(section: str, data: Any, spec: dict[str, tuple]) -> dict[str, Any]:
    """Drop sub-keys outside the whitelist (M11-1) — pre-existing junk must not
    survive an update/duplicate rewrite of the config the gateway loads."""
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if k in spec}


def _checked_str_list(field: str, value: Any) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
        raise HTTPException(status_code=400, detail=f"'{field}' must be a list of strings")
    return value


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
    for entry in iter_sub_profile_ids():  # M10-16 single source (M12-1)
        dir_path = os.path.join(PROFILES_DIR, entry)
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


@router.get("/skills-summary")
async def profile_skills_summary() -> list[dict[str, Any]]:
    """Skills-enabled/disabled counts per profile (skills-hub knowledge).

    Lived at GET /api/profiles in main.py but the router shadowed it —
    unreachable dead code (M10-05). Registered BEFORE /{profile_id} so the
    static path wins the Starlette match. Feeds the future skills-per-profile UI.
    """
    from backend.skills_hub import list_profiles_summary
    return await list_profiles_summary()


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

    # Merge updates into existing config (preserving all other keys).
    # Whitelist + type-check everything (M10-12): this dict is the config the
    # gateway loads — arbitrary keys/values must never reach it.
    if body.model is not None:
        existing_model = cfg.get("model", {}) or {}
        existing_model.update(_checked_kv("model", body.model, _MODEL_KEYS))
        cfg["model"] = existing_model

    if body.fallback_providers is not None:
        cfg["fallback_providers"] = _checked_str_list("fallback_providers", body.fallback_providers)

    if body.toolsets is not None:
        cfg["toolsets"] = _checked_str_list("toolsets", body.toolsets)

    if body.agent is not None:
        existing_agent = cfg.get("agent", {}) or {}
        existing_agent.update(_checked_kv("agent", body.agent, _AGENT_SCHEMA))
        cfg["agent"] = existing_agent

    if body.description is not None:
        if not isinstance(body.description, str):
            raise HTTPException(status_code=400, detail="'description' must be a string")
        cfg["description"] = body.description

    # M11-1: junk already in the file must not survive the rewrite — prune the
    # model/agent sections to the whitelist (top-level keys are user territory).
    cfg["model"] = _prune_section("model", cfg.get("model", {}), _MODEL_KEYS)
    cfg["agent"] = _prune_section("agent", cfg.get("agent", {}), _AGENT_SCHEMA)

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

    # Persist EVERY whitelisted setting — the dialog sends them and _to_detail
    # reports them; dropping any is silent content loss (M10-07).
    model_patch = _checked_kv("model", body.model or {}, _MODEL_KEYS)
    agent_patch = _checked_kv("agent", body.agent or {}, _AGENT_SCHEMA)
    model_cfg: dict[str, Any] = {k: model_patch.get(k, "") for k in ("default", "provider", "base_url")}
    if "api_mode" in model_patch:
        # only when sent — an empty string would confuse mode detection (M11-2b)
        model_cfg["api_mode"] = model_patch["api_mode"]
    cfg: dict[str, Any] = {
        "model": model_cfg,
        "providers": {},
        "fallback_providers": _checked_str_list("fallback_providers", body.fallback_providers or []),
        "toolsets": (_checked_str_list("toolsets", body.toolsets)
                     if body.toolsets is not None else ["hermes-cli"]),
        "agent": {k: agent_patch.get(k, d) for k, d in _AGENT_DEFAULTS.items()},
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
    # M11-1: a duplicate must not clone junk the whitelist rejects
    cfg["model"] = _prune_section("model", cfg.get("model", {}), _MODEL_KEYS)
    cfg["agent"] = _prune_section("agent", cfg.get("agent", {}), _AGENT_SCHEMA)
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