"""Single source of truth for profile discovery (M10-16).

Three modules used to derive PROFILES_DIR independently (only profiles.py honored
the AGENTOS_PROFILES_DIR env override), each with different skip filters and ad-hoc
'default' handling. Everything goes through this module now.

ID policy: 'default' is RESERVED for the root config (AGENTOS_DATA_DIR/config.yaml).
A real directory named 'default' under PROFILES_DIR is ignored by discovery — a
virtual root profile and a real sub-profile must never share one id.
"""

import os
from typing import List

from backend.config import settings

DEFAULT_PROFILE_ID = "default"
PROFILES_DIR = os.environ.get("AGENTOS_PROFILES_DIR") or os.path.join(
    settings.AGENTOS_DATA_DIR, "profiles"
)
MAIN_CONFIG = os.path.join(settings.AGENTOS_DATA_DIR, "config.yaml")


def iter_sub_profile_ids() -> List[str]:
    """Sub-profile ids: real directories under PROFILES_DIR.

    Consistent filters everywhere: skip dot/underscore entries and the reserved
    'default' id (owned by the root config).
    """
    if not os.path.isdir(PROFILES_DIR):
        return []
    out: List[str] = []
    for entry in sorted(os.listdir(PROFILES_DIR)):
        # M13-2: reserved in ANY case — a case-variant dir is not a "zombie
        # listed but uncontrollable"; it is simply not a profile (API: 400).
        if entry.startswith(".") or entry.startswith("_") or entry.lower() == DEFAULT_PROFILE_ID:
            continue
        if os.path.isdir(os.path.join(PROFILES_DIR, entry)):
            out.append(entry)
    return out


def discover_profile_ids(include_default: bool = True) -> List[str]:
    """All profile ids: the virtual 'default' (root config) plus sub-profiles."""
    ids = list(iter_sub_profile_ids())
    if include_default and os.path.exists(MAIN_CONFIG):
        ids.insert(0, DEFAULT_PROFILE_ID)
    return sorted(ids)
