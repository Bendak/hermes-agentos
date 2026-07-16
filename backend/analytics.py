"""Analytics API — token usage, activity heatmap, hardware monitoring."""

import os
import time
from fastapi import APIRouter, Depends
from backend.auth import require_auth
from backend.config import settings

import aiosqlite

router = APIRouter()

STATE_DB = os.path.join(settings.AGENTOS_DATA_DIR, "state.db")

# ── Hardware monitoring state ────────────────────────────────────────
_cpu_prev: dict = {}
_cpu_prev_time: float = 0.0


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
    async with aiosqlite.connect(STATE_DB) as db:
        db.row_factory = aiosqlite.Row

        # Total tokens by model
        rows = await db.execute_fetchall("""
            SELECT model,
                   SUM(input_tokens) as input_tokens,
                   SUM(output_tokens) as output_tokens,
                   SUM(cache_read_tokens) as cache_read_tokens,
                   SUM(reasoning_tokens) as reasoning_tokens,
                   COUNT(DISTINCT session_id) as session_count
            FROM session_model_usage
            GROUP BY model
            ORDER BY SUM(input_tokens) + SUM(output_tokens) DESC
        """)
        by_model = []
        for r in rows:
            by_model.append({
                "model": r["model"],
                "input_tokens": r["input_tokens"] or 0,
                "output_tokens": r["output_tokens"] or 0,
                "cache_read_tokens": r["cache_read_tokens"] or 0,
                "reasoning_tokens": r["reasoning_tokens"] or 0,
                "session_count": r["session_count"] or 0,
            })

        # Token trend: last 7 days grouped by day with per-model breakdown
        rows = await db.execute_fetchall("""
            SELECT date(first_seen, 'unixepoch') as day,
                   model,
                   SUM(input_tokens) as input_tokens,
                   SUM(output_tokens) as output_tokens,
                   SUM(cache_read_tokens) as cache_read_tokens,
                   SUM(reasoning_tokens) as reasoning_tokens
            FROM session_model_usage
            WHERE first_seen >= strftime('%s', 'now', '-7 days')
            GROUP BY day, model
            ORDER BY day
        """)
        trend = []
        for r in rows:
            trend.append({
                "day": r["day"],
                "model": r["model"],
                "input_tokens": r["input_tokens"] or 0,
                "output_tokens": r["output_tokens"] or 0,
                "cache_read_tokens": r["cache_read_tokens"] or 0,
                "reasoning_tokens": r["reasoning_tokens"] or 0,
            })

        # Top 5 sessions by total token count
        rows = await db.execute_fetchall("""
            SELECT s.id as session_id,
                   s.display_name,
                   s.model,
                   SUM(smu.input_tokens + smu.output_tokens + smu.cache_read_tokens + smu.reasoning_tokens) as total_tokens,
                   SUM(smu.input_tokens) as input_tokens,
                   SUM(smu.output_tokens) as output_tokens,
                   SUM(smu.cache_read_tokens) as cache_read_tokens,
                   SUM(smu.reasoning_tokens) as reasoning_tokens
            FROM session_model_usage smu
            JOIN sessions s ON s.id = smu.session_id
            GROUP BY smu.session_id
            ORDER BY total_tokens DESC
            LIMIT 5
        """)
        top_sessions = []
        for r in rows:
            top_sessions.append({
                "session_id": r["session_id"],
                "display_name": r["display_name"],
                "model": r["model"],
                "total_tokens": r["total_tokens"] or 0,
                "input_tokens": r["input_tokens"] or 0,
                "output_tokens": r["output_tokens"] or 0,
                "cache_read_tokens": r["cache_read_tokens"] or 0,
                "reasoning_tokens": r["reasoning_tokens"] or 0,
            })

        # Summary totals
        totals = {
            "input_tokens": sum(m["input_tokens"] for m in by_model),
            "output_tokens": sum(m["output_tokens"] for m in by_model),
            "cache_read_tokens": sum(m["cache_read_tokens"] for m in by_model),
            "reasoning_tokens": sum(m["reasoning_tokens"] for m in by_model),
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
    async with aiosqlite.connect(STATE_DB) as db:
        rows = await db.execute_fetchall("""
            SELECT model,
                   COUNT(DISTINCT session_id) as session_count,
                   SUM(input_tokens) as input_tokens,
                   SUM(output_tokens) as output_tokens,
                   SUM(cache_read_tokens) as cache_read_tokens,
                   SUM(cache_write_tokens) as cache_write_tokens,
                   SUM(reasoning_tokens) as reasoning_tokens,
                   SUM(api_call_count) as api_call_count,
                   SUM(estimated_cost_usd) as estimated_cost_usd
            FROM session_model_usage
            GROUP BY model
            ORDER BY SUM(input_tokens) + SUM(output_tokens) DESC
        """)
        result = []
        for r in rows:
            result.append({
                "model": r[0],
                "session_count": r[1] or 0,
                "input_tokens": r[2] or 0,
                "output_tokens": r[3] or 0,
                "cache_read_tokens": r[4] or 0,
                "cache_write_tokens": r[5] or 0,
                "reasoning_tokens": r[6] or 0,
                "api_call_count": r[7] or 0,
                "estimated_cost_usd": r[8] or 0.0,
            })
    return {"models": result}


# ── Activity Heatmap ─────────────────────────────────────────────────

DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
# SQLite %w: 0=Sun, 1=Mon, ... 6=Sat

@router.get("/api/analytics/activity")
async def activity_heatmap(user: dict = Depends(require_auth)):
    """Activity heatmap: sessions grouped by day-of-week × hour in BRT (UTC-3)."""
    async with aiosqlite.connect(STATE_DB) as db:
        rows = await db.execute_fetchall("""
            SELECT
                CAST(strftime('%w', datetime(started_at, 'unixepoch', '-3 hours')) AS INTEGER) as dow,
                CAST(strftime('%H', datetime(started_at, 'unixepoch', '-3 hours')) AS INTEGER) as hour,
                COUNT(*) as cnt
            FROM sessions
            WHERE started_at IS NOT NULL
            GROUP BY dow, hour
        """)

        heatmap = []
        per_hour: dict[int, int] = {}
        per_day: dict[str, int] = {}
        total_sessions = 0

        for r in rows:
            dow, hour, cnt = int(r[0]), int(r[1]), int(r[2])
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
    st = os.statvfs("/opt/data")
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
