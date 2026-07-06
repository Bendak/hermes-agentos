import os

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
