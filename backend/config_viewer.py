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
    for pattern in NEVER_EDITABLE:
        if pattern in key_lower:
            return False
    return True


def _apply_patch(config: dict, path: list[str], value: Any) -> dict:
    """Apply a patch at a dot-notation path in the config dict.

    path: list of keys, e.g. ["model", "default"]
    value: the new value
    """
    current = config
    for key in path[:-1]:
        if key not in current or not isinstance(current[key], dict):
            current[key] = {}
        current = current[key]
    current[path[-1]] = value
    return config


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

        # Preserve permissions from original file
        shutil.copymode(CONFIG_PATH, tmp_path)

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
