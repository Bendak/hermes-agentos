import os
from contextlib import suppress
from datetime import datetime

from fastapi import FastAPI, HTTPException, Query, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.agents import get_profiles, get_profile_detail, check_process_alive
from backend.config import settings
from backend.config_viewer import get_config, update_config
from backend.skills_hub import list_skills, get_skill_detail, list_profiles_summary
from backend.profiles import router as profiles_router
from backend.auth import (
    require_auth,
    require_admin,
    create_access_token,
    create_refresh_token,
    verify_token,
    get_user_by_username,
    get_user_by_id,
    create_user,
    users_exist,
    hash_password,
    verify_password,
    list_all_users,
    update_user_password,
    delete_user,
)

app = FastAPI(title="AgentOS", version="0.1.0")

# Register profile editor router
app.include_router(profiles_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:9120"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth routes (public) ────────────────────────────────────────────

@app.post("/api/auth/login")
async def auth_login(body: dict):
    """Authenticate user and return tokens."""
    username = body.get("username", "")
    password = body.get("password", "")
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")

    user = get_user_by_username(username)
    if not user or not verify_password(password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    access_token = create_access_token(user["id"], user["role"])
    refresh_token = create_refresh_token(user["id"])

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user["role"],
        },
    }


@app.post("/api/auth/refresh")
async def auth_refresh(body: dict):
    """Refresh an access token using a refresh token."""
    refresh_token = body.get("refresh_token", "")
    if not refresh_token:
        raise HTTPException(status_code=400, detail="Refresh token required")

    try:
        payload = verify_token(refresh_token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid token type")

    user = get_user_by_id(int(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    access_token = create_access_token(user["id"], user["role"])
    return {"access_token": access_token}


@app.post("/api/auth/register")
async def auth_register(body: dict, request: Request):
    """Register a new user. Admin only, or no-auth on first run."""
    # First-run bootstrap: if no users exist, skip auth
    if not users_exist():
        pass  # proceed without requiring admin
    else:
        # Verify admin auth
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Authentication required")
        try:
            payload = verify_token(auth_header[7:])
            if payload.get("type") != "access":
                raise HTTPException(status_code=401, detail="Invalid token type")
            admin_user = get_user_by_id(int(payload["sub"]))
            if not admin_user or admin_user["role"] != "admin":
                raise HTTPException(status_code=403, detail="Admin access required")
        except ValueError as e:
            raise HTTPException(status_code=401, detail=str(e))

    username = body.get("username", "")
    password = body.get("password", "")
    role = body.get("role", "admin")

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    if role not in ("admin", "viewer"):
        raise HTTPException(status_code=400, detail="Role must be 'admin' or 'viewer'")

    try:
        new_user = create_user(username, password, role)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    return {
        "user": {
            "id": new_user["id"],
            "username": new_user["username"],
            "role": new_user["role"],
        },
        "message": "User created successfully",
    }


# First-run register endpoint (no auth required)
@app.post("/api/auth/register-first")
async def auth_register_first(body: dict):
    """Create the first admin user. Only works when no users exist."""
    if users_exist():
        raise HTTPException(status_code=403, detail="Users already exist. Use /api/auth/register with admin auth.")

    username = body.get("username", "")
    password = body.get("password", "")

    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")

    try:
        new_user = create_user(username, password, "admin")
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

    # Auto-login: return tokens immediately
    access_token = create_access_token(new_user["id"], new_user["role"])
    refresh_token = create_refresh_token(new_user["id"])

    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": {
            "id": new_user["id"],
            "username": new_user["username"],
            "role": new_user["role"],
        },
        "message": "First admin user created successfully",
    }


@app.get("/api/auth/me")
async def auth_me(user: dict = Depends(require_auth)):
    """Return current user info."""
    return {"user": user}


@app.get("/api/auth/check")
async def auth_check():
    """Check if any users exist (for first-run detection). No auth required."""
    return {"users_exist": users_exist()}


# ── Health endpoint (public) ────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}


# ── Protected API routes ────────────────────────────────────────────

@app.get("/api/agents")
async def list_agents(user: dict = Depends(require_auth)) -> list[dict]:
    profiles = get_profiles()
    from backend.sessions import count_sessions_by_profile  # noqa: PLC0415
    session_counts = await count_sessions_by_profile()
    for p in profiles:
        p["sessions"] = session_counts.get(p["id"], 0)
    return profiles


@app.get("/api/agents/{profile_id}")
async def get_agent(profile_id: str, user: dict = Depends(require_auth)) -> dict:
    detail = await get_profile_detail(profile_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return detail


@app.get("/api/agents/{profile_id}/health")
async def get_agent_health(profile_id: str, user: dict = Depends(require_auth)) -> dict:
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
    user: dict = Depends(require_auth),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None),
    source: str | None = Query(default=None),
    model: str | None = Query(default=None),
) -> dict:
    return await list_sessions(limit=limit, offset=offset, search=search, source=source, model=model)


@app.get("/api/sessions/search")
async def sessions_search(
    user: dict = Depends(require_auth),
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[dict]:
    return await search_sessions_fts(query=q, limit=limit)


@app.get("/api/sessions/{session_id}")
async def sessions_detail(session_id: str, user: dict = Depends(require_auth)) -> dict:
    detail = await get_session(session_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return detail


@app.get("/api/sessions/{session_id}/messages")
async def session_messages(
    session_id: str,
    user: dict = Depends(require_auth),
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
    create_task,
    add_comment,
    bulk_update,
    search_tasks,
    get_kanban_stats,
)

@app.post("/api/tasks")
async def create_task_endpoint(body: dict, user: dict = Depends(require_auth)):
    title = body.get("title", "")
    if not title.strip():
        raise HTTPException(status_code=400, detail="'title' is required")
    result = await create_task(
        title=title,
        body=body.get("body", ""),
        assignee=body.get("assignee"),
        priority=body.get("priority", 2),
        status=body.get("status", "todo"),
        created_by=body.get("created_by", "agentos"),
        workspace_kind=body.get("workspace_kind"),
        workspace_path=body.get("workspace_path"),
    )
    if result is None:
        raise HTTPException(status_code=400, detail="Failed to create task")
    return result


@app.patch("/api/tasks/{task_id}")
async def update_task_endpoint(task_id: str, body: dict, user: dict = Depends(require_auth)):
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
    user: dict = Depends(require_auth),
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
    user: dict = Depends(require_auth),
    q: str = Query(min_length=1),
    limit: int = Query(default=50, ge=1, le=200),
) -> list[dict]:
    return await search_tasks(q, limit=limit)


@app.get("/api/tasks/{task_id}")
async def tasks_detail(task_id: str, user: dict = Depends(require_auth)) -> dict:
    detail = await get_task(task_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return detail


@app.post("/api/tasks/{task_id}/comments")
async def tasks_add_comment(task_id: str, body: dict, user: dict = Depends(require_auth)):
    text = (body.get("body") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Comment body is required")
    author = body.get("author") or "agentos"
    result = await add_comment(task_id, author, text)
    if result is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return result


def _guess_content_type(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    types = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
        '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain',
        '.json': 'application/json', '.yaml': 'text/yaml', '.yml': 'text/yaml',
        '.py': 'text/x-python', '.js': 'text/javascript', '.ts': 'text/typescript',
        '.html': 'text/html', '.css': 'text/css', '.sh': 'text/x-shellscript',
    }
    return types.get(ext, 'application/octet-stream')


@app.get("/api/tasks/{task_id}/artifacts")
async def list_task_artifacts(task_id: str, user: dict = Depends(require_auth)):
    """List files in task workspace."""
    task = await get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workspace_path = task.get("workspace_path")
    if not workspace_path or not os.path.exists(workspace_path):
        return {"files": [], "workspace_path": None}

    files = []
    for entry in os.scandir(workspace_path):
        if entry.is_file():
            stat = entry.stat()
            files.append({
                "name": entry.name,
                "path": entry.path,
                "size": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                "type": _guess_content_type(entry.name),
            })

    files.sort(key=lambda f: f["modified"], reverse=True)
    return {"files": files, "workspace_path": workspace_path}


@app.get("/api/tasks/{task_id}/artifacts/{filename}")
async def get_task_artifact(task_id: str, filename: str, user: dict = Depends(require_auth), preview: bool = False):
    """Serve a file from task workspace."""
    task = await get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workspace_path = task.get("workspace_path")
    if not workspace_path:
        raise HTTPException(status_code=404, detail="No workspace")

    file_path = os.path.join(workspace_path, filename)
    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    # Security: ensure file is within workspace
    real_path = os.path.realpath(file_path)
    real_workspace = os.path.realpath(workspace_path)
    if not real_path.startswith(real_workspace):
        raise HTTPException(status_code=403, detail="Access denied")

    content_type = _guess_content_type(filename)
    disposition = "inline" if preview else "attachment"
    return FileResponse(
        file_path,
        filename=filename,
        media_type=content_type,
        content_disposition_type=disposition,
    )


@app.get("/api/tasks/{task_id}/logs")
async def get_task_logs(task_id: str, user: dict = Depends(require_auth)):
    """Return worker session log for a task."""
    log_path = f"/opt/data/kanban/logs/{task_id}.log"
    if not os.path.exists(log_path):
        return {"content": None, "size": 0}
    size = os.path.getsize(log_path)
    # Read last 100KB max (like Hermes kanban UI)
    max_bytes = 100 * 1024
    with open(log_path, "r", errors="replace") as f:
        if size > max_bytes:
            f.seek(size - max_bytes)
            content = f.read()
            truncated = True
        else:
            content = f.read()
            truncated = False
    return {"content": content, "size": size, "truncated": truncated}


@app.post("/api/tasks/bulk")
async def tasks_bulk(body: dict, user: dict = Depends(require_auth)):
    ids = body.get("ids")
    updates = body.get("updates")
    if not isinstance(ids, list) or not ids:
        raise HTTPException(status_code=400, detail="'ids' must be a non-empty list")
    if not isinstance(updates, dict) or not updates:
        raise HTTPException(status_code=400, detail="'updates' must be a non-empty object")
    return await bulk_update(ids, updates)


@app.get("/api/kanban/stats")
async def kanban_stats(user: dict = Depends(require_auth)) -> dict:
    return await get_kanban_stats()


@app.post("/api/kanban/notify")
async def kanban_notify(body: dict, user: dict = Depends(require_auth)):
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
async def config_view(user: dict = Depends(require_auth)):
    config = await get_config()
    if config is None:
        raise HTTPException(status_code=404, detail="Configuration file not found")
    return config


@app.get("/api/config/raw")
async def config_raw(user: dict = Depends(require_auth)):
    import yaml as yaml_lib

    config = await get_config()
    if config is None:
        raise HTTPException(status_code=404, detail="Configuration file not found")
    return {
        "yaml": yaml_lib.dump(config, default_flow_style=False, sort_keys=False, allow_unicode=True)
    }


@app.patch("/api/config")
async def config_edit(body: dict, user: dict = Depends(require_auth)):
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
async def skills_list(user: dict = Depends(require_auth)):
    return await list_skills()


@app.get("/api/skills/{slug}")
async def skill_detail(slug: str, user: dict = Depends(require_auth)):
    result = await get_skill_detail(slug)
    if result is None:
        raise HTTPException(status_code=404, detail="Skill not found")
    return result


@app.get("/api/profiles")
async def profiles_list(user: dict = Depends(require_auth)):
    return await list_profiles_summary()


# ── Workflows endpoints ────────────────────────────────────────────

from backend.workflows import list_workflows, get_workflow, create_workflow, update_workflow, delete_workflow  # noqa: E402
from backend.workflow_engine import run_workflow, get_workflow_runs, get_run_detail  # noqa: E402

# ── Cron endpoints ────────────────────────────────────────────────

from backend.cron import router as cron_router  # noqa: E402
app.include_router(cron_router)

from backend.analytics import router as analytics_router  # noqa: E402
app.include_router(analytics_router)


@app.get("/api/workflows")
async def workflows_list(user: dict = Depends(require_auth)):
    return await list_workflows()


@app.get("/api/workflows/{workflow_id}")
async def workflow_detail(workflow_id: str, user: dict = Depends(require_auth)):
    result = await get_workflow(workflow_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@app.post("/api/workflows")
async def workflow_create(body: dict, user: dict = Depends(require_auth)):
    return await create_workflow(body)


@app.put("/api/workflows/{workflow_id}")
async def workflow_update(workflow_id: str, body: dict, user: dict = Depends(require_auth)):
    result = await update_workflow(workflow_id, body)
    if result is None:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return result


@app.delete("/api/workflows/{workflow_id}")
async def workflow_delete(workflow_id: str, user: dict = Depends(require_auth)):
    success = await delete_workflow(workflow_id)
    if not success:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return {"ok": True}


@app.post("/api/workflows/{workflow_id}/run")
async def workflow_run(workflow_id: str, user: dict = Depends(require_auth)):
    try:
        result = await run_workflow(workflow_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return result


@app.get("/api/workflows/{workflow_id}/runs")
async def workflow_runs_list(workflow_id: str, user: dict = Depends(require_auth)):
    return await get_workflow_runs(workflow_id)


@app.get("/api/runs/{run_id}")
async def run_detail(run_id: str, user: dict = Depends(require_auth)):
    result = await get_run_detail(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Run not found")
    return result


@app.get("/api/auth/users")
async def list_users(user: dict = Depends(require_admin)):
    """List all users. Admin only."""
    return {"users": list_all_users()}


@app.put("/api/auth/password")
async def change_own_password(body: dict, user: dict = Depends(require_auth)):
    """Change current user's password."""
    current_password = body.get("current_password", "")
    new_password = body.get("new_password", "")
    if not current_password or not new_password:
        raise HTTPException(status_code=400, detail="Current and new password required")
    if len(new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    full_user = get_user_by_id(user["user_id"])
    if not full_user or not verify_password(current_password, full_user["password_hash"]):
        raise HTTPException(status_code=403, detail="Current password is incorrect")
    update_user_password(user["user_id"], new_password)
    return {"message": "Password updated successfully"}


@app.put("/api/auth/users/{target_user_id}/password")
async def admin_change_password(target_user_id: int, body: dict, user: dict = Depends(require_admin)):
    """Admin: change another user's password."""
    new_password = body.get("new_password", "")
    if not new_password:
        raise HTTPException(status_code=400, detail="New password required")
    if len(new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    target = get_user_by_id(target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    if not update_user_password(target_user_id, new_password):
        raise HTTPException(status_code=404, detail="User not found")
    return {"message": f"Password updated for user {target['username']}"}


@app.delete("/api/auth/users/{target_user_id}")
async def delete_user_endpoint(target_user_id: int, user: dict = Depends(require_admin)):
    """Admin: delete a user. Cannot delete self."""
    if target_user_id == user["user_id"]:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    target = get_user_by_id(target_user_id)
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    delete_user(target_user_id)
    return {"message": f"User {target['username']} deleted"}


# ── Models endpoint ───────────────────────────────────────────────

@app.get("/api/models")
async def list_models(user: dict = Depends(require_auth)) -> dict:
    """Return available model+provider combos from cache files and config."""
    import yaml  # noqa: PLC0415
    import json  # noqa: PLC0415
    import glob  # noqa: PLC0415

    default_model = None
    default_provider = None
    seen = set()
    models = []

    # Read main config for default model
    main_cfg = "/opt/data/config.yaml"
    try:
        with open(main_cfg) as f:
            cfg = yaml.safe_load(f) or {}
        default_model = cfg.get("model", {}).get("default")
        default_provider = cfg.get("model", {}).get("provider")
    except Exception:
        pass

    # Read provider_models_cache.json — has ALL models from ALL providers
    # This cache is populated by `hermes model --refresh` and contains
    # the live /v1/models response from each configured provider.
    cache_path = "/opt/data/provider_models_cache.json"
    try:
        with open(cache_path) as f:
            cache = json.load(f)
        for provider, info in cache.items():
            p_models = info.get("models", [])
            for m in p_models:
                key = (m, provider)
                if key not in seen:
                    seen.add(key)
                    models.append({"model": m, "provider": provider})
    except Exception:
        pass

    # Also read ollama_cloud_models_cache.json (separate cache file)
    ollama_cache_path = "/opt/data/ollama_cloud_models_cache.json"
    try:
        with open(ollama_cache_path) as f:
            ocache = json.load(f)
        for m in ocache.get("models", []):
            key = (m, "ollama-cloud")
            if key not in seen:
                seen.add(key)
                models.append({"model": m, "provider": "ollama-cloud"})
    except Exception:
        pass

    # Fallback: read profile configs for any models not in cache
    for cfg_path in sorted(glob.glob("/opt/data/profiles/*/config.yaml")):
        try:
            with open(cfg_path) as f:
                cfg = yaml.safe_load(f) or {}
            m = cfg.get("model", {}).get("default")
            p = cfg.get("model", {}).get("provider", "")
            if m:
                key = (m, p)
                if key not in seen:
                    seen.add(key)
                    models.append({"model": m, "provider": p})
        except Exception:
            continue

    # Sort: default model first, then alphabetically by provider then model
    if default_model:
        models.sort(key=lambda x: (x["model"] != default_model, x["provider"], x["model"]))
    else:
        models.sort(key=lambda x: (x["provider"], x["model"]))

    return {
        "default": {"model": default_model or "", "provider": default_provider or ""},
        "models": models,
    }


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
