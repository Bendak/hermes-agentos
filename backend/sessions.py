import os
from typing import Dict

import aiosqlite

from backend.config import settings

STATE_DB = os.path.join(settings.AGENTOS_DATA_DIR, "state.db")

# model-to-profile mapping fallback when sessions table lacks `profile` column
MODEL_TO_PROFILE: Dict[str, str] = {
    "glm-5.2": "coder",
    "kimi-k2.6": "pixel",
    "mimo-v2.5": "atlas",  # shared with nova; best-effort fallback
    "mimo-v2.5-pro": "nexus",
}


async def count_sessions_by_profile() -> Dict[str, int]:
    """Return session counts per profile from state.db.

    Tries `SELECT profile, COUNT(*) FROM sessions GROUP BY profile` first.
    Falls back to grouping by model name and mapping to profiles.
    """
    if not os.path.exists(STATE_DB):
        return {}

    try:
        async with aiosqlite.connect(STATE_DB) as db:
            # Attempt the ideal query first
            try:
                async with db.execute(
                    "SELECT profile, COUNT(*) FROM sessions GROUP BY profile"
                ) as cursor:
                    rows = await cursor.fetchall()
                    return {row[0]: row[1] for row in rows}
            except Exception:
                # Fallback: use model column mapping
                async with db.execute(
                    "SELECT model, COUNT(*) FROM sessions GROUP BY model"
                ) as cursor:
                    rows = await cursor.fetchall()
                result: Dict[str, int] = {}
                for model, cnt in rows:
                    profile = MODEL_TO_PROFILE.get(model)
                    if profile:
                        result[profile] = result.get(profile, 0) + cnt
                return result
    except Exception:
        return {}
