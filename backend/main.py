import os
from contextlib import suppress

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.agents import get_profiles, get_profile_detail, check_process_alive
from backend.config import settings
from backend.config_viewer import get_config, update_config
from backend.skills_hub import list_skills, get_skill_detail, list_profiles_summary

app = FastAPI(title="AgentOS", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:9120"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/agents")
async def list_agents() -> list[dict]:
    profiles = get_profiles()
    from backend.sessions import count_sessions_by_profile  # noqa: PLC0415
    session_counts = await count_sessions_by_profile()
    for p in profiles:
        p["sessions"] = session_counts.get(p["id"], 0)
    return profiles


@app.get("/api/agents/{profile_id}")
async def get_agent(profile_id: str) -> dict:
    detail = await get_profile_detail(profile_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return detail


@app.get("/api/agents/{profile_id}/health")
async def get_agent_health(profile_id: str) -> dict:
    # Basic process-level health
    profiles = get_profiles()
    profile = next((p for p in profiles if p["id"] == profile_id), None)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile not found")

    alive = check_process_alive(profile.get("pid"))
    state = profile.get("gateway_state", "unknown")

    return {
        "profile_id": profile_id,
        "gateway_state": state,
        "process_alive": alive,
        "pid": profile.get("pid"),
    }


# ── Sessions endpoints ───────────────────────────────────────────

from backend.sessions import list_sessions, get_session, search_sessions_fts, get_session_messages  # noqa: E402


@app.get("/api/sessions")
async def sessions_list(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None),
    source: str | None = Query(default=None),
    model: str | None = Query(default=None),
) -> dict:
    return await list_sessions(limit=limit, offset=offset, search=search, source=source, model=model)


@app.get("/api/sessions/search")
async def sessions_search(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[dict]:
    return await search_sessions_fts(query=q, limit=limit)


@app.get("/api/sessions/{session_id}")
async def sessions_detail(session_id: str) -> dict:
    detail = await get_session(session_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return detail


@app.get("/api/sessions/{session_id}/messages")
async def session_messages(
    session_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> dict:
    # Verify session exists
    detail = await get_session(session_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return await get_session_messages(session_id, limit=limit, offset=offset)


# ── Tasks endpoints ──────────────────────────────────────────────

from backend.tasks import (  # noqa: E402
    list_tasks,
    get_task,
    update_task_status,
    update_task,
    add_comment,
    bulk_update,
    search_tasks,
    get_kanban_stats,
)


@app.patch("/api/tasks/{task_id}")
async def update_task_endpoint(task_id: str, body: dict):
    # Accept both the legacy {status: "..."} shape and the full partial-update
    # shape ({title, body, assignee, priority, status, project_id, …}).
    # If the only field present is "status" we route through the legacy helper
    # so existing DnD callers keep working unchanged.
    if body.get("status") and len(body) == 1:
        result = await update_task_status(task_id, body["status"])
    else:
        result = await update_task(task_id, body)
    if result is None:
        raise HTTPException(status_code=404, detail="Task not found or invalid field value")
    return result


@app.get("/api/tasks")
async def tasks_list(
    status: str | None = Query(default=None),
    assignee: str | None = Query(default=None),
    include_archived: bool = Query(default=False),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    return await list_tasks(
        status=status, assignee=assignee, include_archived=include_archived, limit=limit
    )


@app.get("/api/tasks/search")
async def tasks_search(
    q: str = Query(min_length=1),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    return await search_tasks(q, limit=limit)


@app.get("/api/tasks/{task_id}")
async def tasks_detail(task_id: str) -> dict:
    detail = await get_task(task_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return detail


@app.post("/api/tasks/{task_id}/comments")
async def tasks_add_comment(task_id: str, body: dict):
    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment body is required")
    author = body.get("author") or "agentos"
    result = await add_comment(task_id, author, text)
    if result is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


@app.post("/api/tasks/bulk")
async def tasks_bulk(body: dict):
    ids = body.get("ids")
    updates = body.get("updates")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="'ids' must be a non-empty list")
    if not isinstance(updates, dict) or not updates:
        raise HTTPException(status_code=400, detail="'updates' must be a non-empty object")
    return await bulk_update(ids, updates)


@app.get("/api/kanban/stats")
async def kanban_stats() -> dict:
    return await get_kanban_stats()


@app.post("/api/kanban/notify")
async def kanban_notify(body: dict):
    """Webhook receiver for dispatcher completion notifications.

    The body is stored as a row in ``task_events`` (kind='notify') so it can be
    surfaced on the task detail page without a separate table. Returns a 202 so
    callers know the event was accepted even if the task doesn't exist yet.
    """
    import json as _json
    from datetime import datetime, timezone

    task_id = body.get("task_id")
    if not task_id:
        raise HTTPException(status_code=400, detail="'task_id' is required")

    from backend.tasks import DB_PATH  # noqa: PLC0415
    import aiosqlite  # noqa: PLC0415

    now = int(datetime.now(timezone.utc).timestamp())
    if os.path.exists(DB_PATH):
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO task_events (task_id, run_id, kind, payload, created_at) VALUES (?, ?, ?, ?, ?)",
                (task_id, body.get("run_id"), "notify", _json.dumps(body), now),
            )
            await db.commit()

    return {"accepted": True, "task_id": task_id}


# ── Config viewer endpoints ──────────────────────────────────────

@app.get("/api/config")
async def config_view():
    config = await get_config()
    if config is None:
        raise HTTPException(status_code=404, detail="Configuration file not found")
    return config


@app.get("/api/config/raw")
async def config_raw():
    import yaml as yaml_lib

    config = await get_config()
    if config is None:
        raise HTTPException(status_code=404, detail="Configuration file not found")
    return {
        "yaml": yaml_lib.dump(config, default_flow_style=False, sort_keys=False, allow_unicode=True)
    }


@app.patch("/api/config")
async def config_edit(body: dict):
    patches = body.get("patches")
    if not patches or not isinstance(patches, list):
        raise HTTPException(status_code=400, detail="Missing or invalid 'patches' list")
    try:
        result = await update_config(patches)
    except ValueError as e:
        raise HTTPException(status_code=403, detail=str(e))
    if result is None:
        raise HTTPException(status_code=404, detail="Configuration file not found")
    return result


@app.get("/api/skills")
async def skills_list():
    return await list_skills()


@app.get("/api/skills/{slug}")
async def skill_detail(slug: str):
    result = await get_skill_detail(slug)
    if result is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    return result


@app.get("/api/profiles")
async def profiles_list():
    return await list_profiles_summary()


# ── Workflows endpoints ────────────────────────────────────────────

from backend.workflows import list_workflows, get_workflow, create_workflow, update_workflow, delete_workflow  # noqa: E402
from backend.workflow_engine import run_workflow, get_workflow_runs, get_run_detail  # noqa: E402


@app.get("/api/workflows")
async def workflows_list():
    return await list_workflows()


@app.get("/api/workflows/{workflow_id}")
async def workflow_detail(workflow_id: str):
    result = await get_workflow(workflow_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@app.post("/api/workflows")
async def workflow_create(body: dict):
    return await create_workflow(body)


@app.put("/api/workflows/{workflow_id}")
async def workflow_update(workflow_id: str, body: dict):
    result = await update_workflow(workflow_id, body)
    if result is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@app.delete("/api/workflows/{workflow_id}")
async def workflow_delete(workflow_id: str):
    success = await delete_workflow(workflow_id)
    if not success:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"ok": True}


@app.post("/api/workflows/{workflow_id}/run")
async def workflow_run(workflow_id: str):
    try:
        result = await run_workflow(workflow_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return result


@app.get("/api/workflows/{workflow_id}/runs")
async def workflow_runs_list(workflow_id: str):
    return await get_workflow_runs(workflow_id)


@app.get("/api/runs/{run_id}")
async def run_detail(run_id: str):
    result = await get_run_detail(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return result


dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
index_html = os.path.join(dist_path, "index.html")


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    """Serve static assets or index.html for SPA routes.

    Handles browser refreshes on React Router paths (/sessions, /health, etc.)
    which would otherwise 404 since the backend has no such routes.
    """
    # API routes get proper 404 JSON
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404, detail="Not found")
    # Health endpoint is handled by the explicit route above
    # Try to serve a real file from dist/
    candidate = os.path.join(dist_path, full_path)
    if full_path and os.path.isfile(candidate):
        return FileResponse(candidate)
    # Fallback to index.html for SPA routing
    if os.path.isfile(index_html):
        return FileResponse(index_html)
    raise HTTPException(status_code=404, detail="Frontend not built")
