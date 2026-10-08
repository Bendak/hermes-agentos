import os
import shutil
import tempfile
from typing import Any

import yaml

from backend.config import settings

CONFIG_PATH = os.path.join(settings.AGENTOS_DATA_DIR, "config.yaml")

# Keys whose values should be redacted (show only last 4 chars)
SECRET_KEY_PATTERNS = [
    "api_key",
    "apikey",
    "token",
    "secret",
    "password",
    "pwd",
    "client_secret",
    "access_token",
    "refresh_token",
    "hermes_api_server_key",
    "oauth_client_id",
]

# Keys that are NEVER editable (even if not caught by secret patterns)
NEVER_EDITABLE = {
    "api_key", "apikey", "token", "secret", "password", "pwd",
    "client_secret", "access_token", "refresh_token",
    "basic_auth", "oauth", "secrets",
}


def _is_editable(key_name: str) -> bool:
    """Check if a config key is safe to edit."""
    key_lower = key_name.lower()
    # Suffix matching: blocks "api_key", "access_token", "client_secret"
    # but allows "max_tokens", "subtitle", "desecretize" etc.
    for pattern in NEVER_EDITABLE:
        if key_lower == pattern or key_lower.endswith("_" + pattern) or key_lower.endswith("." + pattern):
            return False
    return True


def _apply_patch(config: dict, path: list[str], value: Any) -> dict:
    """Apply a patch at a dot-notation path in the config dict.

    Path segments can be dict keys or array indices like "[0]", "[1]".
    Examples:
      ["model", "default"] → config["model"]["default"] = value
      ["fallback_providers", "[0]"] → config["fallback_providers"][0] = value

    Malformed paths (scalar in the middle, dict key inside a list, bad
    index) leave the config untouched — navigation must never clobber
    an existing list or dict to force a path to fit.
    """
    current = config
    for key in path[:-1]:
        if key.startswith('[') and key.endswith(']'):
            # Array index
            try:
                idx = int(key[1:-1])
            except ValueError:
                return config
            if not isinstance(current, list) or idx < 0 or idx >= len(current):
                # Can't navigate — leave config unchanged
                return config
            current = current[idx]
        else:
            if isinstance(current, list):
                # Dict key inside a list — malformed path; never clobber the list
                return config
            if key not in current:
                current[key] = {}
            elif not isinstance(current[key], (dict, list)):
                # Scalar in the middle of the path — malformed; never clobber
                return config
            current = current[key]

    # Set the final value
    final = path[-1]
    if final.startswith('[') and final.endswith(']'):
        try:
            idx = int(final[1:-1])
        except ValueError:
            return config
        if isinstance(current, list) and 0 <= idx < len(current):
            current[idx] = value
    else:
        if isinstance(current, dict):
            current[final] = value
    return config


def _preserve_owner(tmp_path: str, orig: os.stat_result) -> None:
    """Stamp the original file's uid:gid onto the temp file before replace.

    The service runs as root, so mkstemp produces root-owned files; the
    gateway runs as a different user and must keep read/write access to
    its config. If ownership cannot be preserved and the temp file's owner
    differs from the original's, FAIL LOUDLY — never swap in a file the
    gateway cannot read (issue #1).
    """
    try:
        os.chown(tmp_path, orig.st_uid, orig.st_gid)
    except (OSError, NotImplementedError) as e:
        cur = os.stat(tmp_path)
        if (cur.st_uid, cur.st_gid) != (orig.st_uid, orig.st_gid):
            raise RuntimeError(
                f"refusing to replace config: cannot preserve owner "
                f"{orig.st_uid}:{orig.st_gid} on the temp file ({e})"
            ) from e


async def update_config(patches: list[dict]) -> dict | None:
    """Apply patches to config.yaml atomically.

    Each patch: {"path": ["model", "default"], "value": "new-model-name"}

    Validates:
    - Each path's final key is editable (not a secret)
    - The config file exists

    Writes atomically: read -> modify -> temp write -> rename
    """
    if not os.path.exists(CONFIG_PATH):
        return None

    # Read current config (WITHOUT redaction — we need real values for read-modify-write)
    with open(CONFIG_PATH, "r") as f:
        config = yaml.safe_load(f)

    if not isinstance(config, dict):
        return None

    # Apply each patch with validation
    for patch in patches:
        path = patch.get("path", [])
        value = patch.get("value")

        if not path or not isinstance(path, list):
            continue

        # Check the FINAL key in path — if it's a secret, reject
        final_key = path[-1]
        if not _is_editable(final_key):
            raise ValueError(f"Field '{'.'.join(path)}' is not editable (secret/protected)")

        config = _apply_patch(config, path, value)

    # Atomic write: write to temp, then rename
    config_dir = os.path.dirname(CONFIG_PATH)
    fd, tmp_path = tempfile.mkstemp(dir=config_dir, suffix=".yaml.tmp")
    try:
        with os.fdopen(fd, "w") as f:
            yaml.safe_dump(config, f, default_flow_style=False, sort_keys=False, allow_unicode=True, width=1000)

        # Preserve permissions AND ownership from the original file
        # (issue #1: mkstemp creates as the service euid — root — and a
        # root-owned replacement locks the gateway user out of its own
        # config, killing every new agent turn)
        orig_stat = os.stat(CONFIG_PATH)
        shutil.copymode(CONFIG_PATH, tmp_path)
        _preserve_owner(tmp_path, orig_stat)

        # Atomic rename
        os.rename(tmp_path, CONFIG_PATH)
    except Exception:
        # Clean up temp file on error
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise

    # Return redacted config (re-read and redact for safety)
    return await get_config()

def _redact_value(key_name: str, value):
    """Redact secret values, show masked version."""
    if value is None:
        return None
    key_lower = key_name.lower()
    for pattern in SECRET_KEY_PATTERNS:
        if pattern in key_lower:
            if isinstance(value, str) and len(value) > 4:
                return f"***{value[-4:]}"
            return "***"
    return value


def _redact_dict(d: dict, parent_key: str = "") -> dict:
    """Recursively redact secrets in a nested dict."""
    result = {}
    for k, v in d.items():
        full_key = f"{parent_key}.{k}" if parent_key else k
        if isinstance(v, dict):
            result[k] = _redact_dict(v, full_key)
        elif isinstance(v, list):
            result[k] = [
                _redact_dict(item, full_key) if isinstance(item, dict) else _redact_value(full_key, item)
                for item in v
            ]
        else:
            result[k] = _redact_value(full_key, v)
    return result


async def get_config() -> dict | None:
    """Read config.yaml, redact secrets, return structured data."""
    if not os.path.exists(CONFIG_PATH):
        return None
    with open(CONFIG_PATH, "r") as f:
        raw = yaml.safe_load(f)
    if not isinstance(raw, dict):
        return None
    return _redact_dict(raw)
