import os
from contextlib import suppress

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.agents import get_profiles, get_profile_detail, check_process_alive
from backend.config import settings

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

from backend.tasks import list_tasks, get_task  # noqa: E402


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


@app.get("/api/tasks/{task_id}")
async def tasks_detail(task_id: str) -> dict:
    detail = await get_task(task_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return detail


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
