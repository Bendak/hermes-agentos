"""Token usage and context size for a chat session (read-only).

The gateway already persists everything AgentOS needs in the profile's
``state.db``; nothing travels on the channel. This module only reads it.

Mapping (verified against a live state.db):

- plugin mode: the gateway session for a chat thread has
  ``chat_id == chat_sessions.hermes_id``; compression can split one thread
  into several gateway sessions, so totals aggregate every row of the thread.
- legacy HTTP mode: AgentOS creates the gateway session with
  ``id == hermes_id``.

Context size comes from ``sessions.model_config._usage_anchor.prompt_tokens``
of the newest session in the thread: the prompt size reported by the
provider on the last API call. It is an internal gateway field, so every read
is defensive — when it is missing the UI simply shows no context bar.

The context window is resolved by Hermes' own model metadata (same source the
CLI/desktop status bar uses) through a short subprocess, cached per model.
``AGENTOS_CONTEXT_WINDOW`` overrides it; when neither works the window is
``None`` and only the absolute token count is shown.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time

from backend import state_dbs
from backend.config import _dotenv_value

logger = logging.getLogger(__name__)

# Cost states that carry a real number. Anything else (``unknown``, NULL)
# means "no pricing for this model" — rendering $0.00 there would be a lie.
_PRICED = {"estimated", "actual", "included"}

_WINDOW_TTL = 6 * 3600
_WINDOW_NEG_TTL = 600
_window_cache: dict[tuple[str, str, str], tuple[float, int | None]] = {}

_WINDOW_SCRIPT = (
    "import sys\n"
    "from agent.model_metadata import get_model_context_length as g\n"
    "print(int(g(sys.argv[1], sys.argv[2], provider=sys.argv[3])))\n"
)


def _setting(name: str) -> str:
    return (os.environ.get(name) or _dotenv_value(name) or "").strip()


def state_db_for(profile: str) -> str | None:
    """Path of the state.db that owns *profile*'s sessions, if it exists."""
    for label, path in state_dbs.state_db_files():
        if label == (profile or "default") and os.path.isfile(path):
            return path
    return None


def _int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _anchor_tokens(model_config: str | None) -> int | None:
    if not model_config:
        return None
    try:
        anchor = json.loads(model_config).get("_usage_anchor") or {}
        tokens = int(anchor.get("prompt_tokens") or 0)
    except (ValueError, TypeError, AttributeError):
        return None
    return tokens if tokens > 0 else None


async def context_window(model: str, base_url: str, provider: str) -> int | None:
    """Context window for *model*, or ``None`` when it cannot be resolved."""
    override = _setting("AGENTOS_CONTEXT_WINDOW")
    if override.isdigit() and int(override) > 0:
        return int(override)
    if not model:
        return None
    key = (model, base_url or "", provider or "")
    hit = _window_cache.get(key)
    now = time.monotonic()
    if hit and hit[0] > now:
        return hit[1]

    python = _setting("AGENTOS_HERMES_PYTHON") or "/opt/hermes/.venv/bin/python"
    src = _setting("AGENTOS_HERMES_SRC") or "/opt/hermes"
    window: int | None = None
    if os.path.isfile(python) and os.path.isdir(src):
        env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
        try:
            proc = await asyncio.create_subprocess_exec(
                python, "-c", _WINDOW_SCRIPT, model, base_url or "", provider or "",
                cwd=src, env=env,
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
            try:
                out, _ = await asyncio.wait_for(proc.communicate(), timeout=10)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                out = b""
            value = out.decode().strip().splitlines()[-1] if out else ""
            if value.isdigit() and int(value) > 0:
                window = int(value)
        except (OSError, ValueError, IndexError) as exc:
            logger.info("context window lookup failed: %s", type(exc).__name__)
    ttl = _WINDOW_TTL if window else _WINDOW_NEG_TTL
    _window_cache[key] = (now + ttl, window)
    return window


async def session_usage(hermes_id: str, profile: str) -> dict:
    """Aggregate usage for one chat thread. Never raises on missing data."""
    empty = {"available": False}
    db = state_db_for(profile)
    if not db or not hermes_id:
        return empty
    aux: list[dict] = []
    try:
        conn = await state_dbs.open_ro(db)
        try:
            cols = {r[1] for r in await conn.execute_fetchall("PRAGMA table_info(sessions)")}
            where = "id = ?"
            params: list = [hermes_id]
            if "chat_id" in cols:
                where += " OR chat_id = ?"
                params.append(hermes_id)
            rows = list(await conn.execute_fetchall(
                "SELECT id, model, model_config, billing_provider, billing_base_url, "
                "input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, "
                "reasoning_tokens, api_call_count, estimated_cost_usd, actual_cost_usd, "
                f"cost_status, started_at FROM sessions WHERE {where} "
                "ORDER BY started_at ASC",
                params,
            ))
            if not rows:
                return empty
            ids = [r[0] for r in rows]
            tables = {r[0] for r in await conn.execute_fetchall(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            if "session_model_usage" in tables:
                marks = ",".join("?" * len(ids))
                aux = [
                    {
                        "task": t, "model": m,
                        "input_tokens": _int(i), "output_tokens": _int(o),
                        "cache_read_tokens": _int(c), "api_calls": _int(n),
                    }
                    for t, m, i, o, c, n in await conn.execute_fetchall(
                        "SELECT task, model, SUM(input_tokens), SUM(output_tokens), "
                        "SUM(cache_read_tokens), SUM(api_call_count) "
                        f"FROM session_model_usage WHERE session_id IN ({marks}) "
                        "AND COALESCE(task, '') != '' GROUP BY task, model ORDER BY task, model",
                        ids,
                    )
                ]
        finally:
            await conn.close()
    except Exception as exc:  # corrupt/locked/old-schema db: degrade, don't 500
        logger.warning("usage read failed: %s", type(exc).__name__)
        return empty

    totals = {
        "input_tokens": sum(_int(r[5]) for r in rows),
        "output_tokens": sum(_int(r[6]) for r in rows),
        "cache_read_tokens": sum(_int(r[7]) for r in rows),
        "cache_write_tokens": sum(_int(r[8]) for r in rows),
        "reasoning_tokens": sum(_int(r[9]) for r in rows),
        "api_calls": sum(_int(r[10]) for r in rows),
    }

    cost = None
    statuses = {(r[13] or "").lower() for r in rows if _int(r[10]) > 0}
    if statuses and statuses <= _PRICED:
        # per row: the provider's actual charge when it reported one, else the
        # estimate; the label is 'actual' only when no row is an estimate
        priced = [r for r in rows if _int(r[10]) > 0]  # the same rows the label looks at

        def _row_cost(r) -> float:
            if (r[13] or "").lower() == "actual":
                return float(r[12] or 0)  # provider-reported, even when it is 0
            return float(r[12] or 0) if float(r[12] or 0) > 0 else float(r[11] or 0)

        usd = sum(_row_cost(r) for r in priced)
        if "estimated" in statuses:
            label = "estimated"
        elif statuses == {"included"}:
            label = "included"  # covered by a subscription: no per-call invoice
        else:
            label = "actual"
        cost = {"usd": round(usd, 6), "status": label}

    latest = rows[-1]
    model = latest[1] or None
    context = None
    tokens = _anchor_tokens(latest[2])
    if tokens:
        window = await context_window(model or "", latest[4] or "", latest[3] or "")
        context = {"tokens": tokens, "window": window}

    return {
        "available": True,
        "model": model,
        "totals": totals,
        "cost": cost,
        "context": context,
        "auxiliary": aux,
    }
