"""Analytics API — token usage, activity heatmap, hardware monitoring."""

import logging
import os
import threading
import time
from fastapi import APIRouter, Depends
from backend.auth import require_auth
from backend.config import settings

import aiosqlite

from backend.state_dbs import STATE_DB, open_ro, state_db_files

logger = logging.getLogger(__name__)

router = APIRouter()

# M5-03: fonte ÚNICA de timezone para todo bucket de dia — trend e heatmap
# discordavam (trend em UTC, heatmap em BRT). Trocar aqui muda os dois.
BRT_SQL_OFFSET = "-3 hours"

# M5-05: padrão compartilhado de leitura dos state.db (root + profiles).
# mode=ro (via open_ro) nunca cria db fantasma; db sem a tabela/shape esperado
# é pulado com warning em vez de 500 — drift de schema entre profiles não pode
# derrubar o endpoint.


async def _query_each_db(sql: str) -> list[tuple[str, list]]:
    """Run *sql* against every live state.db; return [(owner, rows), ...].

    M5-01: o analytics lia SÓ o state.db do profile default (~24% do uso
    invisível). Aqui o universo é root + sub-profiles (mesma semântica do
    WI-7)."""
    out: list[tuple[str, list]] = []
    for owner, path in state_db_files():
        if not os.path.exists(path):
            continue
        db = None
        try:
            db = await open_ro(path)
            db.row_factory = aiosqlite.Row
            rows = await db.execute_fetchall(sql)
            out.append((owner, list(rows)))
        except Exception as e:  # schema drift: pula o db, não o endpoint
            logger.warning("analytics: skipping state.db %s (%s): %s", owner, path, e)
        finally:
            if db is not None:
                await db.close()
    return out

# ── Hardware monitoring state ────────────────────────────────────────
_cpu_prev: dict = {}
_cpu_prev_time: float = 0.0
# M5-07: _calc_cpu_percent é read-modify-write do delta — requests
# concorrentes liam o prev um do outro e distorciam a %. Lock torna a
# janela de race fechada num worker (multi-worker = estado por processo,
# inerente ao design de memória; documentado no finding).
_cpu_lock = threading.Lock()


def _read_cpu_times():
    """Read total CPU jiffies from /proc/stat."""
    with open("/proc/stat", "r") as f:
        for line in f:
            if line.startswith("cpu "):
                parts = line.split()[1:]
                vals = [int(x) for x in parts[:8]]  # user nice system idle iowait irq softirq steal
                return {
                    "user": vals[0], "nice": vals[1], "system": vals[2],
                    "idle": vals[3], "iowait": vals[4], "irq": vals[5],
                    "softirq": vals[6], "steal": vals[7],
                }
    return {}


def _calc_cpu_percent():
    """Calculate CPU usage % since last call."""
    global _cpu_prev, _cpu_prev_time
    with _cpu_lock:
        return _calc_cpu_percent_locked()


def _calc_cpu_percent_locked():
    global _cpu_prev, _cpu_prev_time
    cur = _read_cpu_times()
    now = time.time()
    if not cur or not _cpu_prev:
        _cpu_prev = cur
        _cpu_prev_time = now
        return 0.0

    d_idle = cur["idle"] - _cpu_prev["idle"]
    d_total = sum(cur.values()) - sum(_cpu_prev.values())
    _cpu_prev = cur
    _cpu_prev_time = now
    if d_total == 0:
        return 0.0
    return round((1.0 - d_idle / d_total) * 100, 1)


def _read_meminfo():
    """Read /proc/meminfo and return total, available, used in bytes."""
    info: dict[str, int] = {}
    with open("/proc/meminfo", "r") as f:
        for line in f:
            parts = line.split(":")
            if len(parts) == 2:
                key = parts[0].strip()
                val_parts = parts[1].strip().split()
                if val_parts:
                    # Values are in kB
                    info[key] = int(val_parts[0]) * 1024
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", info.get("MemFree", 0))
    used = total - available
    percent = round(used / total * 100, 1) if total else 0.0
    return {"total": total, "used": used, "free": available, "percent": percent}


def _read_uptime():
    """Read /proc/uptime and return seconds since boot."""
    with open("/proc/uptime", "r") as f:
        return float(f.read().split()[0])


# ── Token Usage Endpoints ────────────────────────────────────────────

@router.get("/api/analytics/tokens")
async def token_usage(user: dict = Depends(require_auth)):
    """Token usage summary: by model, trend (7 days), top sessions."""
    # M5-01: root + sub-profiles. F-M5-09: sessões arquivadas ficam FORA
    # (a página de Sessões e o analytics precisam do mesmo universo).
    model_acc: dict[str, dict] = {}
    for owner, rows in await _query_each_db("""
        SELECT smu.model as model,
               SUM(smu.input_tokens) as input_tokens,
               SUM(smu.output_tokens) as output_tokens,
               SUM(smu.cache_read_tokens) as cache_read_tokens,
               SUM(smu.cache_write_tokens) as cache_write_tokens,
               SUM(smu.reasoning_tokens) as reasoning_tokens,
               SUM(smu.estimated_cost_usd) as estimated_cost_usd,
               SUM(smu.api_call_count) as api_call_count,
               COUNT(DISTINCT smu.session_id) as session_count
        FROM session_model_usage smu
        JOIN sessions s ON s.id = smu.session_id
        WHERE COALESCE(s.archived, 0) = 0
        GROUP BY smu.model
    """):
        for r in rows:
            acc = model_acc.setdefault(r["model"], {
                "model": r["model"], "input_tokens": 0, "output_tokens": 0,
                "cache_read_tokens": 0, "cache_write_tokens": 0,
                "reasoning_tokens": 0, "estimated_cost_usd": 0.0,
                "api_call_count": 0, "session_count": 0,
            })
            acc["input_tokens"] += r["input_tokens"] or 0
            acc["output_tokens"] += r["output_tokens"] or 0
            acc["cache_read_tokens"] += r["cache_read_tokens"] or 0
            acc["cache_write_tokens"] += r["cache_write_tokens"] or 0
            acc["reasoning_tokens"] += r["reasoning_tokens"] or 0
            acc["estimated_cost_usd"] += r["estimated_cost_usd"] or 0.0
            acc["api_call_count"] += r["api_call_count"] or 0
            acc["session_count"] += r["session_count"] or 0
    # M5-08: o ranking por in+out puro divergia do consumo real (um modelo
    # 4º na barra era o maior da tela com 380M de cache_read). Contrato único
    # (M5-04/10): ordenar por TOTAL (todos os tipos) e expor o total pronto.
    for m in model_acc.values():
        m["total_tokens"] = (
            m["input_tokens"] + m["output_tokens"] + m["cache_read_tokens"]
            + m["cache_write_tokens"] + m["reasoning_tokens"]
        )
    by_model = sorted(model_acc.values(), key=lambda m: m["total_tokens"], reverse=True)

    # M5-02: bucket por last_seen (não first_seen) — linhas multi-dia eram
    # atribuídas integralmente ao primeiro dia (52 linhas em escala) e a
    # janela por first_seen excluía linhas ativas. M5-03: mesmo offset BRT do
    # heatmap (BRT_SQL_OFFSET) — os dois gráficos agora concordam no dia.
    trend_acc: dict[tuple[str, str], dict] = {}
    for owner, rows in await _query_each_db(f"""
        SELECT date(smu.last_seen, 'unixepoch', '{BRT_SQL_OFFSET}') as day,
               smu.model as model,
               SUM(smu.input_tokens) as input_tokens,
               SUM(smu.output_tokens) as output_tokens,
               SUM(smu.cache_read_tokens) as cache_read_tokens,
               SUM(smu.cache_write_tokens) as cache_write_tokens,
               SUM(smu.reasoning_tokens) as reasoning_tokens
        FROM session_model_usage smu
        JOIN sessions s ON s.id = smu.session_id
        WHERE COALESCE(s.archived, 0) = 0
          AND smu.last_seen >= strftime('%s', 'now', '-7 days')
        GROUP BY day, smu.model
    """):
        for r in rows:
            acc = trend_acc.setdefault((r["day"], r["model"]), {
                "day": r["day"], "model": r["model"], "input_tokens": 0,
                "output_tokens": 0, "cache_read_tokens": 0,
                "cache_write_tokens": 0, "reasoning_tokens": 0,
            })
            acc["input_tokens"] += r["input_tokens"] or 0
            acc["output_tokens"] += r["output_tokens"] or 0
            acc["cache_read_tokens"] += r["cache_read_tokens"] or 0
            acc["cache_write_tokens"] += r["cache_write_tokens"] or 0
            acc["reasoning_tokens"] += r["reasoning_tokens"] or 0
    trend = sorted(trend_acc.values(), key=lambda t: (t["day"], t["model"]))

    # Top 5 sessions — agora globais (todos os profiles), com a coluna
    # `profile` (M5-01: "UNION com coluna de profile") para o badge no front.
    top_sessions = []
    for owner, rows in await _query_each_db("""
        SELECT s.id as session_id,
               s.display_name,
               s.model,
               SUM(smu.input_tokens + smu.output_tokens + smu.cache_read_tokens + smu.reasoning_tokens) as total_tokens,
               SUM(smu.input_tokens) as input_tokens,
               SUM(smu.output_tokens) as output_tokens,
               SUM(smu.cache_read_tokens) as cache_read_tokens,
               SUM(smu.cache_write_tokens) as cache_write_tokens,
               SUM(smu.reasoning_tokens) as reasoning_tokens,
               SUM(smu.estimated_cost_usd) as estimated_cost_usd
        FROM session_model_usage smu
        JOIN sessions s ON s.id = smu.session_id
        WHERE COALESCE(s.archived, 0) = 0
        GROUP BY smu.session_id
    """):
        for r in rows:
            top_sessions.append({
                "session_id": r["session_id"],
                "display_name": r["display_name"],
                "model": r["model"],
                "profile": owner,
                "total_tokens": (r["total_tokens"] or 0) + (r["cache_write_tokens"] or 0),
                "input_tokens": r["input_tokens"] or 0,
                "output_tokens": r["output_tokens"] or 0,
                "cache_read_tokens": r["cache_read_tokens"] or 0,
                "cache_write_tokens": r["cache_write_tokens"] or 0,
                "reasoning_tokens": r["reasoning_tokens"] or 0,
                "estimated_cost_usd": r["estimated_cost_usd"] or 0.0,
            })
    top_sessions.sort(key=lambda t: t["total_tokens"], reverse=True)
    top_sessions = top_sessions[:5]

    totals = {
        "input_tokens": sum(m["input_tokens"] for m in by_model),
        "output_tokens": sum(m["output_tokens"] for m in by_model),
        "cache_read_tokens": sum(m["cache_read_tokens"] for m in by_model),
        "cache_write_tokens": sum(m["cache_write_tokens"] for m in by_model),
        "reasoning_tokens": sum(m["reasoning_tokens"] for m in by_model),
        "total_tokens": sum(m["total_tokens"] for m in by_model),
        "estimated_cost_usd": round(sum(m["estimated_cost_usd"] for m in by_model), 6),
        "api_call_count": sum(m["api_call_count"] for m in by_model),
    }

    return {
        "by_model": by_model,
        "trend": trend,
        "top_sessions": top_sessions,
        "totals": totals,
    }


@router.get("/api/analytics/tokens/by-model")
async def token_by_model(user: dict = Depends(require_auth)):
    """Detailed per-model token breakdown with session counts."""
    acc: dict[str, dict] = {}
    for owner, rows in await _query_each_db("""
        SELECT smu.model as model,
               COUNT(DISTINCT smu.session_id) as session_count,
               SUM(smu.input_tokens) as input_tokens,
               SUM(smu.output_tokens) as output_tokens,
               SUM(smu.cache_read_tokens) as cache_read_tokens,
               SUM(smu.cache_write_tokens) as cache_write_tokens,
               SUM(smu.reasoning_tokens) as reasoning_tokens,
               SUM(smu.api_call_count) as api_call_count,
               SUM(smu.estimated_cost_usd) as estimated_cost_usd
        FROM session_model_usage smu
        JOIN sessions s ON s.id = smu.session_id
        WHERE COALESCE(s.archived, 0) = 0
        GROUP BY smu.model
    """):
        for r in rows:
            a = acc.setdefault(r["model"], {
                "model": r["model"], "session_count": 0, "input_tokens": 0,
                "output_tokens": 0, "cache_read_tokens": 0,
                "cache_write_tokens": 0, "reasoning_tokens": 0,
                "api_call_count": 0, "estimated_cost_usd": 0.0,
            })
            a["session_count"] += r["session_count"] or 0
            a["input_tokens"] += r["input_tokens"] or 0
            a["output_tokens"] += r["output_tokens"] or 0
            a["cache_read_tokens"] += r["cache_read_tokens"] or 0
            a["cache_write_tokens"] += r["cache_write_tokens"] or 0
            a["reasoning_tokens"] += r["reasoning_tokens"] or 0
            a["api_call_count"] += r["api_call_count"] or 0
            a["estimated_cost_usd"] += r["estimated_cost_usd"] or 0.0
    result = sorted(acc.values(), key=lambda m: m["input_tokens"] + m["output_tokens"], reverse=True)
    return {"models": result}


# ── Activity Heatmap ─────────────────────────────────────────────────

DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
# SQLite %w: 0=Sun, 1=Mon, ... 6=Sat

@router.get("/api/analytics/activity")
async def activity_heatmap(user: dict = Depends(require_auth)):
    """Activity heatmap: sessions grouped by day-of-week × hour in BRT (UTC-3)."""
    heat_acc: dict[tuple[int, int], int] = {}
    for owner, rows in await _query_each_db(f"""
        SELECT
            CAST(strftime('%w', datetime(started_at, 'unixepoch', '{BRT_SQL_OFFSET}')) AS INTEGER) as dow,
            CAST(strftime('%H', datetime(started_at, 'unixepoch', '{BRT_SQL_OFFSET}')) AS INTEGER) as hour,
            COUNT(*) as cnt
        FROM sessions
        WHERE started_at IS NOT NULL
          AND COALESCE(archived, 0) = 0
        GROUP BY dow, hour
    """):
        for r in rows:
            heat_acc[(int(r[0]), int(r[1]))] = heat_acc.get((int(r[0]), int(r[1])), 0) + int(r[2])

    heatmap = []
    per_hour: dict[int, int] = {}
    per_day: dict[str, int] = {}
    total_sessions = 0

    for (dow, hour), cnt in sorted(heat_acc.items()):
        day_name = DAY_NAMES[dow]
        heatmap.append({"day": day_name, "hour": hour, "count": cnt})
        per_hour[hour] = per_hour.get(hour, 0) + cnt
        per_day[day_name] = per_day.get(day_name, 0) + cnt
        total_sessions += cnt

        # Determine peak hour and peak day
        peak_hour = max(per_hour, key=lambda k: per_hour[k]) if per_hour else None
        peak_day = max(per_day, key=lambda k: per_day[k]) if per_day else None

        # Fill per_hour/per_day for all hours/days
        all_hours = {h: per_hour.get(h, 0) for h in range(24)}
        all_days = {d: per_day.get(d, 0) for d in DAY_NAMES}

    return {
        "heatmap": heatmap,
        "per_hour": all_hours,
        "per_day": all_days,
        "peak_hour": peak_hour,
        "peak_day": peak_day,
        "total_sessions": total_sessions,
    }


# ── Hardware Monitoring ─────────────────────────────────────────────

@router.get("/api/analytics/hardware")
async def hardware_stats(user: dict = Depends(require_auth)):
    """Current system stats using /proc (no psutil)."""
    # CPU
    cpu_percent = _calc_cpu_percent()
    cpu_cores = os.cpu_count() or 1

    # Load average
    load1, load5, load15 = os.getloadavg()

    # RAM
    mem = _read_meminfo()

    # Disk
    st = os.statvfs(settings.AGENTOS_DATA_DIR)  # M5-06: não hardcode
    disk_total = st.f_blocks * st.f_frsize
    disk_free = st.f_bavail * st.f_frsize
    disk_used = disk_total - disk_free
    disk_percent = round(disk_used / disk_total * 100, 1) if disk_total else 0.0

    # Uptime
    uptime_seconds = _read_uptime()
    days = int(uptime_seconds // 86400)
    hours = int((uptime_seconds % 86400) // 3600)
    minutes = int((uptime_seconds % 3600) // 60)
    uptime_formatted = f"{days}d {hours}h {minutes}m"

    return {
        "cpu": {
            "percent": cpu_percent,
            "cores": cpu_cores,
            "load_avg": [round(load1, 2), round(load5, 2), round(load15, 2)],
        },
        "ram": {
            "total": mem["total"],
            "used": mem["used"],
            "free": mem["free"],
            "percent": mem["percent"],
        },
        "disk": {
            "total": disk_total,
            "used": disk_used,
            "free": disk_free,
            "percent": disk_percent,
        },
        "uptime": {
            "seconds": round(uptime_seconds),
            "formatted": uptime_formatted,
        },
    }
