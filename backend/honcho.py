"""Honcho memory monitor — read-only aggregation of the local Honcho API (v3).

Why this module exists: the 06/10 peer-card panic showed there was NO place
that answered "is my memory alive?" — the card was null (Honcho 2.1.2 doesn't
generate it) while representation/conclusions were intact. This endpoint
surfaces health, counters (with history), freshness, representation size, the
explicit card status and the deriver queue lag.

READ-ONLY BY DESIGN — Honcho holds real, irreplaceable memory: no writes, no
fake/dummy data, ever (the deriver would turn test data into conclusions).
Tests mock the HTTP layer.

Degrades per section — a dead component never 500s the panel, it lands in
``errors[]``; non-fatal oddities land in ``warnings[]``.
"""

import json
import logging
import os
import re
import time
from urllib.parse import urlsplit

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

# N-11: em bancos migrados (ALTER TABLE ADD COLUMN pending) a ordem física é
# pending POR ÚLTIMO, diferente daqui. Todo INSERT usa colunas nomeadas — nunca
# inserir posicionalmente.
_SCHEMA = (
    "CREATE TABLE IF NOT EXISTS honcho_snapshots ("
    " ts INTEGER NOT NULL, workspace TEXT NOT NULL, sessions INTEGER,"
    " conclusions INTEGER, peers INTEGER, pending INTEGER,"
    " representation_chars INTEGER)"
)
# N-02: dois collects concorrentes (cache frio) gravavam 2 linhas na mesma hora.
_SCHEMA_UNIQUE = (
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_honcho_snap_ws_ts"
    " ON honcho_snapshots(workspace, ts)"
)


def _load_config() -> dict | None:
    """{base_url, base_host, workspaces:[...]} do honcho.json — tolerante a tipos.

    F-H1: config JSON *válida* com tipo errado (root list, baseUrl int, hosts
    str) derrubava a rota com AttributeError/500. Aqui tudo é validado com
    isinstance; qualquer lixo → None (not_configured), nunca exceção.
    """
    try:
        with open(CONFIG_PATH) as f:
            cfg = json.load(f)
    except FileNotFoundError:
        return None
    except Exception as e:
        logger.warning("honcho: config ilegível (%s): %s", CONFIG_PATH, e)
        return None

    if not isinstance(cfg, dict):
        logger.warning("honcho: config não é objeto (%s)", type(cfg).__name__)
        return None

    base = cfg.get("baseUrl")
    if not isinstance(base, str) or not base.strip():
        base = os.environ.get("HONCHO_BASE_URL")
    if not isinstance(base, str) or not base.strip():
        return None
    base = base.strip().rstrip("/")

    workspaces: list[str] = []
    hosts = cfg.get("hosts")
    if isinstance(hosts, dict):
        for host in hosts.values():
            if not isinstance(host, dict) or not host.get("enabled", True):
                continue
            w = host.get("workspace")
            if isinstance(w, str) and w and w not in workspaces:
                workspaces.append(w)

    # F-H10: só o host no payload da UI (sem path/query).
    # N-01: URL sintaticamente inválida (porta 'abc', IPv6 malformado, >65535)
    # explodia em urlsplit/.port — config ruim vira not_configured, nunca exceção.
    try:
        parts = urlsplit(base)
        port = parts.port  # may raise ValueError
        if not parts.scheme or not parts.hostname:
            raise ValueError("url sem scheme/host")
        base_host = f"{parts.scheme}://{parts.hostname}"
        if port:
            base_host += f":{port}"
    except Exception as e:
        logger.warning("honcho: baseUrl inválido (%s): %s", base, e)
        return None
    return {"base_url": base, "base_host": base_host, "workspaces": workspaces}


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


async def _open_db() -> aiosqlite.Connection:
    db = await aiosqlite.connect(AGENTOS_DB)
    await db.execute(_SCHEMA)
    try:  # DBs antigos podem ter duplicatas — índice é best-effort
        await db.execute(_SCHEMA_UNIQUE)
        await db.commit()
    except Exception as e:
        logger.warning("honcho: índice único de snapshots não criado: %s", e)
    # migração de DBs criados antes da coluna `pending` (F-H4)
    try:
        async with db.execute("PRAGMA table_info(honcho_snapshots)") as cur:
            cols = {r[1] for r in await cur.fetchall()}
        if "pending" not in cols:
            await db.execute("ALTER TABLE honcho_snapshots ADD COLUMN pending INTEGER")
            await db.commit()
    except Exception:
        pass
    return db


async def _snapshot(ws_id: str, counters: dict) -> None:
    """Grava ≤1 snapshot/hora por workspace (histórico p/ sparkline)."""
    now = int(time.time())
    try:
        db = await _open_db()
        try:
            async with db.execute(
                "SELECT ts FROM honcho_snapshots WHERE workspace=? ORDER BY ts DESC LIMIT 1",
                (ws_id,),
            ) as cur:
                row = await cur.fetchone()
            if row and now - int(row[0]) < _SNAPSHOT_INTERVAL:
                return
            await db.execute(
                "INSERT OR IGNORE INTO honcho_snapshots (ts, workspace, sessions,"
                " conclusions, peers, pending, representation_chars)"
                " VALUES (?,?,?,?,?,?,?)",
                (now, ws_id, counters.get("sessions"), counters.get("conclusions"),
                 counters.get("peers"), counters.get("queue", {}).get("pending"),
                 counters.get("representation_chars")),
            )
            await db.commit()
        finally:
            await db.close()
    except Exception as e:  # snapshot nunca derruba o painel
        logger.warning("honcho: snapshot falhou: %s", e)


async def _series(ws_id: str) -> list[dict]:
    try:
        db = await _open_db()
        try:
            db.row_factory = aiosqlite.Row
            cutoff = int(time.time()) - 7 * 86400
            async with db.execute(
                "SELECT ts, sessions, conclusions, peers, pending, representation_chars"
                " FROM honcho_snapshots WHERE workspace=? AND ts>=? ORDER BY ts",
                (ws_id, cutoff),
            ) as cur:
                return [dict(r) for r in await cur.fetchall()]
        finally:
            await db.close()
    except Exception as e:
        logger.warning("honcho: série falhou: %s", e)
        return []


def _drop_warnings(entry: dict, series: list[dict]) -> list[str]:
    """F-H4/H9 + N-03: perda detectada comparando o LIVE com o último snapshot.

    Antes comparava só snapshot×snapshot: uma queda real ficava invisível até
    o próximo write (≤1h). Agora o request atual já acusa. Inclui
    representation_chars (N-03c). Baseline = último snapshot armazenado.
    """
    if not series:
        return []
    last = series[-1]
    out = []
    for key in ("sessions", "conclusions", "peers", "representation_chars"):
        a, b = last.get(key), entry.get(key)
        if isinstance(a, int) and isinstance(b, int) and b < a:
            out.append(f"queda de {key}: {a} → {b}")
    return out


_CONCLUSION_MAX = 1000


def _conclusion_item(item: dict) -> dict:
    """F-5 (adversarial lote 2): corte EXPLÍCITO.

    Para auditoria de fatos, texto cortado sem aviso parece completo. Se o
    conteúdo excede o teto, devolvemos o trecho + '…' e ``truncated: true``
    para a UI marcar — nunca um prefixo silencioso.
    """
    raw = str(item.get("content") or "")
    truncated = len(raw) > _CONCLUSION_MAX
    content = raw[:_CONCLUSION_MAX].rstrip() + "…" if truncated else raw
    return {
        "id": item.get("id"),
        "content": content,
        "truncated": truncated,
        "created_at": item.get("created_at"),
    }


_LAG_THRESHOLD = 50
_LAG_MIN_SECONDS = 3600


def _lag_warnings(entry: dict, series: list[dict]) -> list[str]:
    """§6 (F-4/N-8): deriver lento — pending > 50 por mais de 1h.

    Só alerta com duração PROVADA: a sequência de snapshots precisa cobrir o
    período sem buracos (gap ≤ 2× o intervalo de gravação) e sem `pending`
    desconhecido. Buraco de cobertura ou NULL quebra o streak — desconhecido
    não é "sustentado", e o docstring promete nunca inventar duração (N-8:
    série esparsa interpolava 144h a partir de 2 pontos).
    """
    queue = entry.get("queue") or {}
    cur = queue.get("pending")
    if not isinstance(cur, int) or cur <= _LAG_THRESHOLD:
        return []
    now = int(time.time())
    max_gap = 2 * _SNAPSHOT_INTERVAL
    start = None
    prev_ts = now
    for point in reversed(series):
        ts = point.get("ts")
        pending = point.get("pending")
        if not isinstance(ts, int):
            continue
        if not isinstance(pending, int) or pending <= _LAG_THRESHOLD:
            break
        if prev_ts - ts > max_gap:
            break
        start = ts
        prev_ts = ts
    if start is None or now - start < _LAG_MIN_SECONDS:
        return []
    hours = (now - start) / 3600
    return [f"deriver lento: {cur} pendente(s) há {hours:.1f}h (>50 por >1h)"]


async def collect() -> dict:
    """Agrega tudo; nunca levanta (degradação por seção)."""
    cfg = _load_config()
    if cfg is None:
        # F-1 (adversarial lote 2): generated_at SEMPRE presente — a UI formata
        # esse campo no cabeçalho; sem ele a página inteira quebrava (RangeError).
        return {"status": "not_configured", "workspaces": [], "series": {},
                "errors": [f"honcho.json ausente/ilegível/inválido em {CONFIG_PATH}"],
                "warnings": [], "generated_at": int(time.time())}

    result: dict = {
        "status": "ok",
        "base_url": cfg["base_host"],
        "workspaces": [],
        "series": {},
        "errors": [],
        "warnings": [],
        "generated_at": int(time.time()),
    }
    try:
        async with httpx.AsyncClient(base_url=cfg["base_url"], timeout=_HTTP_TIMEOUT) as client:
            try:
                health = await _get_json(client, "/health")
                result["health"] = health
                if isinstance(health, dict) and str(health.get("status", "ok")).lower() not in (
                        "ok", "healthy", "up"):
                    # N-06: corpo unhealthy não pode virar "ok" geral
                    result["status"] = "degraded"
                    result["warnings"].append(f"health reporta {health.get('status')!r}")
            except Exception as e:
                result["status"] = "unreachable"
                result["errors"].append(f"health: {e}")
                return result

            try:
                api_ws = (await _post_json(client, "/v3/workspaces/list")).get("items", [])
            except Exception as e:
                result["status"] = "degraded"
                result["errors"].append(f"workspaces: {e}")
                return result

            api_ids = [w.get("id") for w in api_ws
                       if isinstance(w, dict) and isinstance(w.get("id"), str)]
            # F-H2: config mapeando host para workspace errado/inexistente não pode
            # esconder workspaces reais. Universo = UNIÃO (config primeiro).
            for w in cfg["workspaces"]:
                if w not in api_ids:
                    result["warnings"].append(
                        f"workspace configurado {w!r} não existe no Honcho"
                        f" (lista da API: {len(api_ids)})")
            order = [w for w in cfg["workspaces"] if w in api_ids] + \
                    [w for w in api_ids if w not in cfg["workspaces"]]
            order = [w for w in order if isinstance(w, str)]
            if not order:
                # F-H7: `ok` sem seção nenhuma é falso-verde
                result["status"] = "degraded"
                result["warnings"].append("nenhum workspace para monitorar")

            if len(order) > _MAX_WORKSPACES:  # N-07
                result["warnings"].append(
                    f"{len(order)} workspaces; monitorando só os {_MAX_WORKSPACES} primeiros")
            for ws_id in order[:_MAX_WORKSPACES]:
                entry: dict = {
                    "id": ws_id,
                    "created_at": next((w.get("created_at") for w in api_ws
                                        if w.get("id") == ws_id), None),
                    # N-04: contrato congelado p/ a UI — chave sempre presente
                    "latest_conclusion_at": None,
                }
                peers: list[dict] = []
                try:
                    peers_data = await _post_json(client, f"/v3/workspaces/{ws_id}/peers/list")
                    peers = peers_data.get("items", [])
                    # F-H8: `total`, não len da página (cap 50)
                    entry["peers"] = peers_data.get("total", len(peers))
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
                # F-H3: freshness = conclusão mais nova (representation defasa)
                try:
                    newest = await _post_json(
                        client, f"/v3/workspaces/{ws_id}/conclusions/list", {"size": 1})
                    items = newest.get("items") or []
                    if items and isinstance(items[0], dict):
                        entry["latest_conclusion_at"] = items[0].get("created_at")
                except Exception as e:
                    result["errors"].append(f"{ws_id}.latest_conclusion: {e}")
                # Q3 (02/11): auditoria de fatos — últimas 10 conclusões COM conteúdo
                # (admin-only; permite pedir conclusão corretiva quando algo está errado).
                # Nota: a API v3 ignora `size` no body e devolve 50/página — cortamos aqui.
                try:
                    recent = await _post_json(
                        client, f"/v3/workspaces/{ws_id}/conclusions/list", {"size": 10})
                    entry["recent_conclusions"] = [
                        _conclusion_item(it)
                        for it in (recent.get("items") or [])[:10]
                        if isinstance(it, dict)
                    ]
                except Exception as e:
                    result["errors"].append(f"{ws_id}.recent_conclusions: {e}")
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

                # human peers — no workspace default (primeiro da ordem)
                if ws_id == order[0]:
                    for p in peers:
                        pid = p.get("id") if isinstance(p, dict) else None
                        if pid not in _HUMAN_PEERS:
                            continue
                        pentry: dict = {"id": pid}
                        try:
                            card = await _get_json(
                                client, f"/v3/workspaces/{ws_id}/peers/{pid}/card")
                            pc = card.get("peer_card") if isinstance(card, dict) else None
                            # F-H5: null (não gerado) != [] (gerado e vazio)
                            if pc is None:
                                pentry["card"] = "not_generated"
                            elif isinstance(pc, list) and not pc:
                                pentry["card"] = "empty"
                            else:
                                pentry["card"] = "populated"
                        except Exception as e:
                            result["errors"].append(f"{ws_id}.{pid}.card: {e}")
                        try:
                            rep = await _post_json(
                                client, f"/v3/workspaces/{ws_id}/peers/{pid}/representation")
                            text = rep.get("representation", "") if isinstance(rep, dict) else ""
                            pentry["representation"] = _repr_stats(text)
                        except Exception as e:
                            result["errors"].append(f"{ws_id}.{pid}.representation: {e}")
                        entry.setdefault("humans", []).append(pentry)

                    humans = entry.get("humans", [])
                    if humans:
                        entry["representation_chars"] = max(
                            (h["representation"]["chars"] for h in humans
                             if h.get("representation")), default=0)
                        # F-H6: `max` mascarava peer sem memória — avisa por peer
                        for h in humans:
                            if h.get("representation") and h["representation"]["chars"] == 0:
                                result["warnings"].append(
                                    f"{ws_id}: peer {h['id']} sem representação (0 chars)")

                result["workspaces"].append(entry)
                await _snapshot(ws_id, entry)
                series = await _series(ws_id)
                result["series"][ws_id] = series
                result["warnings"].extend(
                    f"{ws_id}: {w}" for w in _drop_warnings(entry, series))
                result["warnings"].extend(
                    f"{ws_id}: {w}" for w in _lag_warnings(entry, series))

            if result["errors"]:
                result["status"] = "degraded"
    except Exception as e:  # fail-safe global — jamais 500
        result["status"] = "degraded"
        result["errors"].append(f"collect: {type(e).__name__}: {e}")
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
