"""Honcho memory monitor — read-only aggregation of the local Honcho API (v3).

Why this module exists: the 06/10 peer-card panic showed there was NO place
that answered "is my memory alive?" — the card was null (Honcho 2.1.2 doesn't
generate it) while representation/conclusions were intact. This endpoint
surfaces health, counters (with history), freshness, representation size, the
explicit card status and the deriver queue lag.

Read-only by design: no writes to Honcho. Degrades per section — a dead
component never 500s the panel, it lands in ``errors[]``.
"""

import json
import logging
import os
import re
import time

import aiosqlite
import httpx

logger = logging.getLogger(__name__)

CONFIG_PATH = os.environ.get("HONCHO_CONFIG", "/opt/data/honcho.json")
AGENTOS_DB = os.environ.get("AGENTOS_DB", "/opt/data/agentos/agentos.db")

_HTTP_TIMEOUT = 5.0
_CACHE_TTL = 60.0
_SNAPSHOT_INTERVAL = 3600
_MAX_WORKSPACES = 5
_HUMAN_PEERS = ("user_a", "user_b")

_OBS_RE = re.compile(r"^\[(\d{4}-\d{2}-\d{2})", re.MULTILINE)

_cache: tuple[float, dict] | None = None


def _load_config() -> dict | None:
    """{base_url, workspaces:[id,...]} do honcho.json (root baseUrl)."""
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.warning("honcho: config ilegível (%s): %s", CONFIG_PATH, e)
        return None
    base = (cfg.get("baseUrl") or os.environ.get("HONCHO_BASE_URL") or "").rstrip("/")
    if not base:
        return None
    ws = []
    for host in (cfg.get("hosts") or {}).values():
        w = host.get("workspace")
        if w and host.get("enabled", True) and w not in ws:
            ws.append(w)
    return {"base_url": base, "workspaces": ws[:_MAX_WORKSPACES]}


async def _get_json(client: httpx.AsyncClient, path: str) -> dict:
    r = await client.get(path)
    r.raise_for_status()
    return r.json()


async def _post_json(client: httpx.AsyncClient, path: str, body: dict | None = None) -> dict:
    r = await client.post(path, json=body or {})
    r.raise_for_status()
    return r.json()


def _repr_stats(text: str) -> dict:
    observations = _OBS_RE.findall(text or "")
    return {
        "chars": len(text or ""),
        "observations": len(observations),
        "latest_observation": max(observations) if observations else None,
    }


async def _snapshot(ws_id: str, counters: dict) -> None:
    """Grava ≤1 snapshot/hora por workspace (histórico p/ sparkline)."""
    now = int(time.time())
    try:
        async with aiosqlite.connect(AGENTOS_DB) as db:
            await db.execute(
                "CREATE TABLE IF NOT EXISTS honcho_snapshots ("
                " ts INTEGER NOT NULL, workspace TEXT NOT NULL,"
                " sessions INTEGER, conclusions INTEGER, peers INTEGER,"
                " representation_chars INTEGER)"
            )
            async with db.execute(
                "SELECT ts FROM honcho_snapshots WHERE workspace=? ORDER BY ts DESC LIMIT 1",
                (ws_id,),
            ) as cur:
                row = await cur.fetchone()
            if row and now - int(row[0]) < _SNAPSHOT_INTERVAL:
                return
            await db.execute(
                "INSERT INTO honcho_snapshots VALUES (?,?,?,?,?,?)",
                (now, ws_id, counters.get("sessions"), counters.get("conclusions"),
                 counters.get("peers"), counters.get("representation_chars")),
            )
            await db.commit()
    except Exception as e:  # snapshot nunca derruba o painel
        logger.warning("honcho: snapshot falhou: %s", e)


async def _series(ws_id: str) -> list[dict]:
    try:
        async with aiosqlite.connect(AGENTOS_DB) as db:
            db.row_factory = aiosqlite.Row
            await db.execute(
                "CREATE TABLE IF NOT EXISTS honcho_snapshots ("
                " ts INTEGER NOT NULL, workspace TEXT NOT NULL,"
                " sessions INTEGER, conclusions INTEGER, peers INTEGER,"
                " representation_chars INTEGER)"
            )
            cutoff = int(time.time()) - 7 * 86400
            async with db.execute(
                "SELECT ts, sessions, conclusions, peers, representation_chars"
                " FROM honcho_snapshots WHERE workspace=? AND ts>=? ORDER BY ts",
                (ws_id, cutoff),
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]
    except Exception as e:
        logger.warning("honcho: série falhou: %s", e)
        return []


async def collect() -> dict:
    """Agrega tudo; nunca levanta (degradação por seção)."""
    cfg = _load_config()
    if cfg is None:
        return {"status": "not_configured", "workspaces": [], "series": {},
                "errors": [f"honcho.json ausente/ilegível em {CONFIG_PATH}"]}

    result: dict = {
        "status": "ok",
        "base_url": cfg["base_url"],
        "workspaces": [],
        "series": {},
        "errors": [],
        "generated_at": int(time.time()),
    }
    try:
        async with httpx.AsyncClient(base_url=cfg["base_url"], timeout=_HTTP_TIMEOUT) as client:
            try:
                health = await _get_json(client, "/health")
                result["health"] = health
            except Exception as e:
                result["status"] = "unreachable"
                result["errors"].append(f"health: {e}")
                return result

            try:
                ws_list = (await _post_json(client, "/v3/workspaces/list")).get("items", [])
            except Exception as e:
                result["status"] = "degraded"
                result["errors"].append(f"workspaces: {e}")
                return result

            for w in ws_list:
                ws_id = w.get("id")
                if not ws_id or ws_id not in cfg["workspaces"]:
                    continue
                entry: dict = {"id": ws_id, "created_at": w.get("created_at")}
                peers: list[dict] = []
                try:
                    peers = (await _post_json(
                        client, f"/v3/workspaces/{ws_id}/peers/list")).get("items", [])
                    entry["peers"] = len(peers)
                except Exception as e:
                    result["errors"].append(f"{ws_id}.peers: {e}")
                for key, path in (
                    ("sessions", f"/v3/workspaces/{ws_id}/sessions/list"),
                    ("conclusions", f"/v3/workspaces/{ws_id}/conclusions/list"),
                ):
                    try:
                        data = await _post_json(client, path)
                        entry[key] = data.get("total", len(data.get("items", [])))
                    except Exception as e:
                        result["errors"].append(f"{ws_id}.{key}: {e}")
                try:
                    q = await _get_json(client, f"/v3/workspaces/{ws_id}/queue/status")
                    entry["queue"] = {
                        "total": q.get("total_work_units"),
                        "completed": q.get("completed_work_units"),
                        "pending": q.get("pending_work_units"),
                        "in_progress": q.get("in_progress_work_units"),
                    }
                except Exception as e:
                    result["errors"].append(f"{ws_id}.queue: {e}")

                # human peers (somente no workspace default): card + representation
                for p in peers:
                    pid = p.get("id")
                    if pid not in _HUMAN_PEERS or ws_id != cfg["workspaces"][0]:
                        continue
                    pentry: dict = {"id": pid}
                    try:
                        card = await _get_json(client, f"/v3/workspaces/{ws_id}/peers/{pid}/card")
                        pc = card.get("peer_card")
                        pentry["card"] = "populated" if pc else "not_generated"
                    except Exception as e:
                        result["errors"].append(f"{ws_id}.{pid}.card: {e}")
                    try:
                        rep = await _post_json(
                            client, f"/v3/workspaces/{ws_id}/peers/{pid}/representation")
                        pentry["representation"] = _repr_stats(rep.get("representation", ""))
                        entry.setdefault("representation_chars", 0)
                        entry["representation_chars"] = max(
                            entry["representation_chars"],
                            pentry["representation"]["chars"],
                        )
                    except Exception as e:
                        result["errors"].append(f"{ws_id}.{pid}.representation: {e}")
                    entry.setdefault("humans", []).append(pentry)

                result["workspaces"].append(entry)
                await _snapshot(ws_id, entry)
                result["series"][ws_id] = await _series(ws_id)

            if result["errors"]:
                result["status"] = "degraded"
    except Exception as e:  # fail-safe global
        result["status"] = "degraded"
        result["errors"].append(f"collect: {e}")
    return result


async def summary() -> dict:
    """collect() com TTL de 60s (painel não pagina a API a cada request)."""
    global _cache
    now = time.monotonic()
    if _cache is not None and now - _cache[0] < _CACHE_TTL:
        return _cache[1]
    data = await collect()
    _cache = (now, data)
    return data
