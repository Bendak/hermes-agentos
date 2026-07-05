import os
from contextlib import suppress

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
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


dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
with suppress(RuntimeError):
    if os.path.isdir(dist_path):
        app.mount("/", StaticFiles(directory=dist_path, html=True), name="static")
