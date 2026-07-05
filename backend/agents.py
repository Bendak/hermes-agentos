import json
import os
from typing import Any, Dict, List, Optional

from backend.config import settings
from backend.sessions import count_sessions_by_profile

PROFILES_DIR = os.path.join(settings.AGENTOS_DATA_DIR, "profiles")


def _discover_profile_ids() -> List[str]:
    """Scan for all profile IDs, including the default profile.

    The default profile lives directly in AGENTOS_DATA_DIR (config.yaml,
    SOUL.md, gateway_state.json at the root). Sub-profiles live in the
    profiles/ subdirectory. We return both, sorted alphabetically.
    """
    result: List[str] = []

    # Check for default profile at the data root
    root_config = os.path.join(settings.AGENTOS_DATA_DIR, "config.yaml")
    if os.path.exists(root_config):
        result.append("default")

    # Scan sub-profiles directory
    if os.path.isdir(PROFILES_DIR):
        for entry in sorted(os.listdir(PROFILES_DIR)):
            full_path = os.path.join(PROFILES_DIR, entry)
            if os.path.isdir(full_path) and not entry.startswith(".") and not entry.startswith("_"):
                result.append(entry)

    return sorted(result)


def _parse_yaml_simple(path: str) -> Dict[str, Any]:
    """Minimal line-based parser for the specific nested YAML used in config.yaml.

    Extracts top-level keys and a nested `model` block (default, provider).
    """
    result: Dict[str, Any] = {"model": {}}
    in_model = False
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            stripped = line.rstrip("\n")
            if stripped.strip().startswith("#"):
                continue
            if stripped.startswith("model:") and not stripped.strip()[6:].strip():
                in_model = True
                continue
            if in_model:
                if stripped and not stripped.startswith(" "):
                    in_model = False
                    continue
                if "default:" in stripped:
                    result["model"]["default"] = stripped.split("default:", 1)[1].strip()
                if "provider:" in stripped:
                    result["model"]["provider"] = stripped.split("provider:", 1)[1].strip()
    return result


def _read_soul_first_line(path: str) -> str:
    """Read the first non-empty line from SOUL.md and return a concise role title.

    For profiles whose first line is just a role (e.g. 'Code Architect'), return it as-is.
    For profiles starting with '# Persona', scan for the 'You are Name, a/the ...' sentence
    and extract the short role title before the first period or clause.
    """
    if not os.path.exists(path):
        return "Agent"
    with open(path, "r", encoding="utf-8") as f:
        lines = [ln.rstrip("\n") for ln in f if ln.strip()]
    if not lines:
        return "Agent"
    first = lines[0].strip()
    if first.startswith("#"):
        for line in lines[1:]:
            line = line.strip()
            if line.startswith("You are"):
                # Sentence: "You are Pixel, a Senior Graphic Designer and Brand Strategist..."
                # Extract the portion after the first comma
                parts = line.split(", ", 1)
                if len(parts) > 1:
                    role = parts[1]
                    # Trim at the first period to keep only the title clause
                    role = role.split(".")[0].strip()
                    # Strip leading articles
                    for article in ("a ", "the ", "an "):
                        if role.lower().startswith(article):
                            role = role[len(article):]
                    # Also trim at " focused on" or similar trailing descriptions
                    for cutoff in (" focused on", " and", ",", " trained to"):
                        if cutoff in role:
                            role = role.split(cutoff)[0].strip()
                    return role
                return line
            if line and not line.startswith("#"):
                return line
        return "Agent"
    return first


def _read_gateway_state(path: str) -> Dict[str, Any]:
    """Read gateway_state.json and return relevant fields."""
    defaults = {"gateway_state": "unknown", "pid": None}
    if not os.path.exists(path):
        return defaults
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {
            "gateway_state": data.get("gateway_state", "unknown"),
            "pid": data.get("pid"),
        }
    except Exception:
        return defaults


def check_process_alive(pid: Optional[int]) -> bool:
    """Check if a process with the given PID exists in this namespace."""
    if pid is None:
        return False
    try:
        return os.path.exists(f"/proc/{pid}")
    except Exception:
        return False


def get_profiles() -> List[Dict[str, Any]]:
    """Discover all profiles dynamically and return a list of summary dicts."""
    profile_ids = _discover_profile_ids()
    profiles = []
    for profile_id in profile_ids:
        # Default profile lives at the data root, sub-profiles in profiles/
        if profile_id == "default":
            profile_dir = settings.AGENTOS_DATA_DIR
        else:
            profile_dir = os.path.join(PROFILES_DIR, profile_id)
        config_path = os.path.join(profile_dir, "config.yaml")
        soul_path = os.path.join(profile_dir, "SOUL.md")
        gateway_path = os.path.join(profile_dir, "gateway_state.json")

        name = "Hermes" if profile_id == "default" else profile_id.capitalize()
        model = "unknown"
        provider = "unknown"

        if os.path.exists(config_path):
            parsed = _parse_yaml_simple(config_path)
            model = parsed.get("model", {}).get("default", "unknown")
            provider = parsed.get("model", {}).get("provider", "unknown")

        role = _read_soul_first_line(soul_path)
        gateway = _read_gateway_state(gateway_path)
        pid = gateway.get("pid")
        process_alive = check_process_alive(pid)

        profiles.append(
            {
                "id": profile_id,
                "name": name,
                "model": model,
                "provider": provider,
                "role": role,
                "gateway_state": gateway["gateway_state"],
                "pid": pid,
                "process_alive": process_alive,
            }
        )
    return profiles


async def get_profile_detail(profile_id: str) -> Optional[Dict[str, Any]]:
    """Return full detail for a single profile, including session count."""
    profiles = get_profiles()
    profile = next((p for p in profiles if p["id"] == profile_id), None)
    if profile is None:
        return None

    session_counts = await count_sessions_by_profile()
    profile["sessions"] = session_counts.get(profile_id, 0)
    return profile
