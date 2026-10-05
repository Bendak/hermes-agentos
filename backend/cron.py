"""Cron job CRUD endpoints for AgentOS.

Storage is fully delegated to the Hermes cron store (``/opt/hermes/cron/jobs.py``):
cross-process ``flock`` on ``<home>/cron/.jobs.lock``, atomic replace writes, record
normalization and file ownership preservation. AgentOS previously rewrote ``jobs.json``
directly (no lock, truncate-write), which could lose concurrent scheduler updates
(M9-01), permanently wipe the store on a torn write (M9-02) and drop top-level
bookkeeping such as ``updated_at`` (M9-12). Reusing the store module closes those by
construction instead of re-implementing the locking discipline.
"""

import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from backend.auth import require_auth, require_admin

HERMES_SRC = os.environ.get("AGENTOS_HERMES_SRC", "/opt/hermes")
CRON_HOME = os.environ.get("AGENTOS_CRON_HOME", "/opt/data")


def _load_store() -> Any:
    """Import the Hermes cron store module (``/opt/hermes/cron/jobs.py``)."""
    if HERMES_SRC not in sys.path:
        sys.path.insert(0, HERMES_SRC)
    from cron import jobs  # type: ignore[import-untyped]
    return jobs


hjobs: Any = None
try:
    hjobs = _load_store()
    HAVE_STORE = True
except ImportError:  # Hermes sources not present (standalone checkout)
    HAVE_STORE = False

router = APIRouter(prefix="/api/cron", tags=["cron"])

_PROFILE_ID_RE = re.compile(r"^[A-Za-z0-9._-]+$")
_SCHEDULE_EXPR_RE = re.compile(r"^\s*\S+\s+\S+\s+\S+\s+\S+\s+\S+\s*$")


# ── Helpers ───────────────────────────────────────────────────────


def _require_store():
    if not HAVE_STORE:
        raise HTTPException(
            status_code=503,
            detail="Hermes cron store not available in this deployment",
        )


def _store_scope():
    """Anchor the Hermes cron store at the default profile home (no globals mutated)."""
    return hjobs.use_cron_store(CRON_HOME)


def _find_job(jobs: list[dict], job_id: str) -> dict | None:
    # .get: legacy records may lack "id" (M9-11) — must not 500 the whole listing.
    return next((j for j in jobs if j.get("id") == job_id), None)


def _validate_payload(body: dict) -> tuple[str, dict]:
    """Validate common write fields; returns (schedule_expr, updates-ish dict)."""
    expr = body.get("schedule", "0 * * * *")
    if not isinstance(expr, str) or not _SCHEDULE_EXPR_RE.match(expr):
        raise HTTPException(
            status_code=422,
            detail=f"Invalid cron expression: {expr!r} (expected 5 fields)",
        )
    profile = body.get("profile")
    if profile is not None and (
        not isinstance(profile, str) or not _PROFILE_ID_RE.match(profile)
    ):
        raise HTTPException(status_code=422, detail=f"Invalid profile id: {profile!r}")
    deliver = body.get("deliver")
    if deliver is not None and not isinstance(deliver, str):
        raise HTTPException(status_code=422, detail="deliver must be a string")
    return expr, body


# ── Endpoints ─────────────────────────────────────────────────────


@router.get("")
async def list_cron(user: dict = Depends(require_auth)):
    """List all cron jobs."""
    _require_store()
    with _store_scope():
        return {"jobs": hjobs.load_jobs()}


@router.get("/{job_id}")
async def get_cron_job(job_id: str, user: dict = Depends(require_auth)):
    """Get a single cron job by ID."""
    _require_store()
    with _store_scope():
        job = _find_job(hjobs.load_jobs(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.post("")
async def create_cron_job(body: dict, user: dict = Depends(require_admin)):
    """Create a new cron job."""
    _require_store()
    expr, body = _validate_payload(body)
    now = datetime.now(timezone.utc).isoformat()

    job = {
        "id": uuid.uuid4().hex[:12],
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
        "schedule": {"kind": "cron", "expr": expr, "display": expr},
        "schedule_display": expr,
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

    # Read-modify-write held under the store's own lock (RLock reentrant, so the
    # nested save_jobs() reuses it) — this is the lost-update fix (M9-01).
    with _store_scope(), hjobs._jobs_lock():
        jobs = hjobs.load_jobs()
        job = hjobs._normalize_job_record(job)
        jobs.append(job)
        hjobs.save_jobs(jobs)
    return job


@router.put("/{job_id}")
async def update_cron_job(job_id: str, body: dict, user: dict = Depends(require_admin)):
    """Update an existing cron job."""
    _require_store()
    updates: dict = {}

    if "name" in body:
        updates["name"] = body["name"]
    if "prompt" in body:
        updates["prompt"] = body["prompt"]
    if "schedule" in body:
        expr, _ = _validate_payload({"schedule": body["schedule"]})
        updates["schedule"] = {"kind": "cron", "expr": expr, "display": expr}
        updates["schedule_display"] = expr
    if "enabled" in body:
        updates["enabled"] = body["enabled"]
        if body["enabled"]:
            updates["state"] = "scheduled"
            updates["paused_at"] = None
            updates["paused_reason"] = None
        else:
            updates["state"] = "paused"
            updates["paused_at"] = datetime.now(timezone.utc).isoformat()
    for field in ("model", "provider", "deliver", "skills", "skill"):
        if field in body:
            updates[field] = body[field]
    if "profile" in body:
        _, _ = _validate_payload({"profile": body["profile"]})
        updates["profile"] = body["profile"]

    if not updates:
        raise HTTPException(status_code=400, detail="No updatable fields provided")

    # update_job(): atomic RMW under the store lock, normalizes records, re-anchors
    # next_run_at on schedule change (M9-03/M9-07) and preserves bookkeeping fields.
    with _store_scope():
        try:
            job = hjobs.update_job(job_id, updates)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.delete("/{job_id}")
async def delete_cron_job(job_id: str, user: dict = Depends(require_admin)):
    """Delete a cron job."""
    _require_store()
    with _store_scope():
        removed = hjobs.remove_job(job_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "deleted", "job_id": job_id}


@router.post("/{job_id}/run")
async def run_cron_job_now(job_id: str, user: dict = Depends(require_admin)):
    """Dispatch immediate execution of a cron job via the Hermes CLI.

    Fire-and-forget: the child is detached and never killed by this handler. The old
    implementation ran the CLI synchronously with ``subprocess.run(timeout=30)`` — it
    killed long jobs at 30s (M9-04), blocked the event loop meanwhile (M9-09) and
    reported "triggered" even on failure. Outcome is now the job's own run state.
    """
    _require_store()
    with _store_scope():
        job = _find_job(hjobs.load_jobs(), job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        proc = subprocess.Popen(
            ["hermes", "cron", "run", job_id],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
    except FileNotFoundError:
        raise HTTPException(
            status_code=503, detail="hermes CLI not available in this deployment"
        )
    return {
        "status": "dispatched",
        "job_id": job_id,
        "message": f"Run dispatched (pid {proc.pid}); check the job's run state for the outcome.",
    }


@router.post("/{job_id}/pause")
async def pause_cron_job(job_id: str, user: dict = Depends(require_admin)):
    """Pause a cron job."""
    _require_store()
    with _store_scope():
        try:
            job = hjobs.pause_job(job_id, reason="paused from AgentOS")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "paused", "job_id": job_id}


@router.post("/{job_id}/resume")
async def resume_cron_job(job_id: str, user: dict = Depends(require_admin)):
    """Resume a cron job."""
    _require_store()
    with _store_scope():
        try:
            job = hjobs.update_job(
                job_id,
                {
                    "enabled": True,
                    "state": "scheduled",
                    "paused_at": None,
                    "paused_reason": None,
                },
            )
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return {"status": "resumed", "job_id": job_id}
