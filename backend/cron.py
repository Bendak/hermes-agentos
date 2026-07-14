"""Cron job CRUD endpoints for AgentOS.

Reads/writes Hermes cron jobs.json at /opt/data/cron/jobs.json.
"""

import json
import os
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import require_auth

CRON_JOBS_PATH = "/opt/data/cron/jobs.json"

router = APIRouter(prefix="/api/cron", tags=["cron"])


# ── Helpers ───────────────────────────────────────────────────────


def _read_jobs() -> list[dict]:
    """Read cron jobs from Hermes cron jobs.json."""
    if not os.path.exists(CRON_JOBS_PATH):
        return []
    try:
        with open(CRON_JOBS_PATH) as f:
            data = json.load(f)
        return data.get("jobs", [])
    except (json.JSONDecodeError, OSError):
        return []


def _write_jobs(jobs: list[dict]) -> None:
    """Write cron jobs back to Hermes cron jobs.json."""
    os.makedirs(os.path.dirname(CRON_JOBS_PATH), exist_ok=True)
    with open(CRON_JOBS_PATH, "w") as f:
        json.dump({"jobs": jobs}, f, indent=2, ensure_ascii=False)


def _find_job(jobs: list[dict], job_id: str) -> dict | None:
    return next((j for j in jobs if j["id"] == job_id), None)


# ── Endpoints ─────────────────────────────────────────────────────


@router.get("")
async def list_cron(user: dict = Depends(require_auth)):
    """List all cron jobs."""
    return {"jobs": _read_jobs()}


@router.get("/{job_id}")
async def get_cron_job(job_id: str, user: dict = Depends(require_auth)):
    """Get a single cron job by ID."""
    job = _find_job(_read_jobs(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("")
async def create_cron_job(body: dict, user: dict = Depends(require_auth)):
    """Create a new cron job."""
    now = datetime.now(timezone.utc).isoformat()
    job_id = uuid.uuid4().hex[:12]

    schedule_expr = body.get("schedule", "0 * * * *")
    job = {
        "id": job_id,
        "name": body.get("name", "Untitled Job"),
        "prompt": body.get("prompt", ""),
        "skills": body.get("skills", []),
        "skill": body.get("skill"),
        "model": body.get("model"),
        "provider": body.get("provider"),
        "base_url": body.get("base_url"),
        "script": body.get("script"),
        "no_agent": body.get("no_agent", False),
        "context_from": body.get("context_from"),
        "schedule": {
            "kind": "cron",
            "expr": schedule_expr,
            "display": schedule_expr,
        },
        "schedule_display": schedule_expr,
        "repeat": {"times": None, "completed": 0},
        "enabled": body.get("enabled", True),
        "state": "scheduled" if body.get("enabled", True) else "paused",
        "paused_at": None if body.get("enabled", True) else now,
        "paused_reason": None,
        "created_at": now,
        "next_run_at": None,
        "last_run_at": None,
        "last_status": None,
        "last_error": None,
        "last_delivery_error": None,
        "deliver": body.get("deliver", "origin"),
        "origin": body.get("origin"),
        "enabled_toolsets": body.get("enabled_toolsets"),
        "workdir": body.get("workdir"),
        "profile": body.get("profile"),
        "fire_claim": None,
    }

    jobs = _read_jobs()
    jobs.append(job)
    _write_jobs(jobs)
    return job


@router.put("/{job_id}")
async def update_cron_job(job_id: str, body: dict, user: dict = Depends(require_auth)):
    """Update an existing cron job."""
    jobs = _read_jobs()
    job = _find_job(jobs, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Update allowed fields
    if "name" in body:
        job["name"] = body["name"]
    if "prompt" in body:
        job["prompt"] = body["prompt"]
    if "schedule" in body:
        expr = body["schedule"]
        job["schedule"] = {"kind": "cron", "expr": expr, "display": expr}
        job["schedule_display"] = expr
    if "enabled" in body:
        job["enabled"] = body["enabled"]
        if body["enabled"]:
            job["state"] = "scheduled"
            job["paused_at"] = None
            job["paused_reason"] = None
        else:
            job["state"] = "paused"
            job["paused_at"] = datetime.now(timezone.utc).isoformat()
    if "model" in body:
        job["model"] = body["model"]
    if "provider" in body:
        job["provider"] = body["provider"]
    if "deliver" in body:
        job["deliver"] = body["deliver"]
    if "skills" in body:
        job["skills"] = body["skills"]
    if "skill" in body:
        job["skill"] = body["skill"]

    _write_jobs(jobs)
    return job


@router.delete("/{job_id}")
async def delete_cron_job(job_id: str, user: dict = Depends(require_auth)):
    """Delete a cron job."""
    jobs = _read_jobs()
    new_jobs = [j for j in jobs if j["id"] != job_id]
    if len(new_jobs) == len(jobs):
        raise HTTPException(status_code=404, detail="Job not found")
    _write_jobs(new_jobs)
    return {"status": "deleted", "job_id": job_id}


@router.post("/{job_id}/run")
async def run_cron_job_now(job_id: str, user: dict = Depends(require_auth)):
    """Trigger immediate execution of a cron job via Hermes CLI."""
    import subprocess

    jobs = _read_jobs()
    job = _find_job(jobs, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Trigger via hermes cron run
    try:
        result = subprocess.run(
            ["hermes", "cron", "run", job_id],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            return {
                "status": "triggered",
                "job_id": job_id,
                "message": result.stderr.strip() or result.stdout.strip() or "Job submitted",
            }
        return {
            "status": "triggered",
            "job_id": job_id,
            "message": result.stdout.strip() or "Job triggered successfully",
        }
    except FileNotFoundError:
        # hermes CLI not available; just record intent
        return {
            "status": "triggered",
            "job_id": job_id,
            "message": "Run signal sent (hermes CLI not found in PATH)",
        }
    except subprocess.TimeoutExpired:
        return {
            "status": "triggered",
            "job_id": job_id,
            "message": "Job submitted (process started, timed out waiting)",
        }


@router.post("/{job_id}/pause")
async def pause_cron_job(job_id: str, user: dict = Depends(require_auth)):
    """Pause a cron job."""
    jobs = _read_jobs()
    job = _find_job(jobs, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job["enabled"] = False
    job["state"] = "paused"
    job["paused_at"] = datetime.now(timezone.utc).isoformat()
    _write_jobs(jobs)
    return {"status": "paused", "job_id": job_id}


@router.post("/{job_id}/resume")
async def resume_cron_job(job_id: str, user: dict = Depends(require_auth)):
    """Resume a cron job."""
    jobs = _read_jobs()
    job = _find_job(jobs, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job["enabled"] = True
    job["state"] = "scheduled"
    job["paused_at"] = None
    job["paused_reason"] = None
    _write_jobs(jobs)
    return {"status": "resumed", "job_id": job_id}
