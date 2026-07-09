import os
from datetime import datetime, timezone

import aiosqlite

from backend.config import settings

DB_PATH = os.path.join(settings.AGENTOS_DATA_DIR, "kanban.db")


def _ts_to_iso(ts: int | float | None) -> str | None:
    """Convert Unix timestamp (seconds) to ISO 8601 UTC string."""
    if ts is None:
        return None
    try:
        dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
        return dt.isoformat()
    except (ValueError, TypeError, OverflowError):
        return None


def _format_date(ts: int | float | None) -> str:
    """Return dd/mm from a Unix timestamp."""
    if ts is None:
        return "-"
    try:
        dt = datetime.fromtimestamp(float(ts), tz=timezone.utc)
        day = str(dt.day).zfill(2)
        month = str(dt.month).zfill(2)
        return f"{day}/{month}"
    except (ValueError, TypeError, OverflowError):
        return "-"


async def list_tasks(
    status: str | None = None,
    assignee: str | None = None,
    include_archived: bool = False,
    limit: int = 100,
) -> list[dict]:
    """Return tasks from kanban.db, optionally filtered by status/assignee.

    Each task dict includes:
    - id, title, body, assignee, status, priority, created_by
    - created_at (ISO string), started_at (ISO or null), completed_at (ISO or null)
    - workspace_kind, workspace_path, session_id, project_id
    - has_children (bool)
    - parent_id (str or null)
    - run_count, comment_count
    - created_date (dd/mm string for display)
    """
    if not os.path.exists(DB_PATH):
        return []

    limit = max(1, min(limit, 500))

    query = """
        SELECT
            t.id,
            t.title,
            t.body,
            t.assignee,
            t.status,
            t.priority,
            t.created_by,
            t.created_at,
            t.started_at,
            t.completed_at,
            t.workspace_kind,
            t.workspace_path,
            t.session_id,
            t.project_id
        FROM tasks t
        WHERE 1=1
    """
    params: list = []

    if status:
        query += " AND t.status = ?"
        params.append(status)

    if assignee:
        query += " AND t.assignee = ?"
        params.append(assignee)

    if not include_archived:
        query += " AND t.status != 'archived'"

    query += " ORDER BY t.priority DESC, t.created_at DESC LIMIT ?"
    params.append(limit)

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()

        if not rows:
            return []

        task_ids = [r["id"] for r in rows]

        # Pre-fetch aggregate counts
        placeholders = ",".join("?" for _ in task_ids)

        # run counts
        run_counts: dict[str, int] = {tid: 0 for tid in task_ids}
        async with db.execute(
            f"""
            SELECT task_id, COUNT(*) as cnt
            FROM task_runs
            WHERE task_id IN ({placeholders})
            GROUP BY task_id
            """,
            task_ids,
        ) as cur:
            async for row in cur:
                run_counts[row["task_id"]] = row["cnt"]

        # comment counts
        comment_counts: dict[str, int] = {tid: 0 for tid in task_ids}
        async with db.execute(
            f"""
            SELECT task_id, COUNT(*) as cnt
            FROM task_comments
            WHERE task_id IN ({placeholders})
            GROUP BY task_id
            """,
            task_ids,
        ) as cur:
            async for row in cur:
                comment_counts[row["task_id"]] = row["cnt"]

        # has_children (parent_id in task_links)
        has_children: dict[str, bool] = {tid: False for tid in task_ids}
        async with db.execute(
            f"""
            SELECT DISTINCT parent_id
            FROM task_links
            WHERE parent_id IN ({placeholders})
            """,
            task_ids,
        ) as cur:
            async for row in cur:
                has_children[row["parent_id"]] = True

        # parent_id (child_id in task_links)
        parent_ids: dict[str, str | None] = {tid: None for tid in task_ids}
        async with db.execute(
            f"""
            SELECT parent_id, child_id
            FROM task_links
            WHERE child_id IN ({placeholders})
            """,
            task_ids,
        ) as cur:
            async for row in cur:
                parent_ids[row["child_id"]] = row["parent_id"]

        tasks = []
        for r in rows:
            tid = r["id"]
            tasks.append({
                "id": tid,
                "title": r["title"],
                "body": r["body"],
                "assignee": r["assignee"],
                "status": r["status"],
                "priority": r["priority"],
                "created_by": r["created_by"],
                "created_at": _ts_to_iso(r["created_at"]),
                "started_at": _ts_to_iso(r["started_at"]),
                "completed_at": _ts_to_iso(r["completed_at"]),
                "workspace_kind": r["workspace_kind"],
                "workspace_path": r["workspace_path"],
                "session_id": r["session_id"],
                "project_id": r["project_id"],
                "has_children": has_children.get(tid, False),
                "parent_id": parent_ids.get(tid),
                "run_count": run_counts.get(tid, 0),
                "comment_count": comment_counts.get(tid, 0),
                "created_date": _format_date(r["created_at"]),
            })

        return tasks


VALID_STATUSES = {"todo", "ready", "running", "done", "blocked", "archived"}

async def create_task(
    *,
    title: str = "",
    body: str = "",
    assignee: str | None = None,
    priority: int = 2,
    status: str = "todo",
    created_by: str = "agentos",
) -> dict | None:
    """Insert a new task into kanban.db and return the created task dict."""
    import uuid

    if not title.strip():
        return None

    # Map common aliases
    if status == "pending":
        status = "todo"
    if status not in VALID_STATUSES:
        status = "todo"

    try:
        priority = int(priority)
    except (TypeError, ValueError):
        priority = 2

    task_id = uuid.uuid4().hex[:12]
    now = int(datetime.now(timezone.utc).timestamp())

    # Ensure the database directory exists
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)

    async with aiosqlite.connect(DB_PATH) as db:
        # Create tables if they don't exist (first run)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                body TEXT,
                assignee TEXT,
                status TEXT NOT NULL DEFAULT 'todo',
                priority INTEGER DEFAULT 2,
                created_by TEXT,
                created_at INTEGER,
                started_at INTEGER,
                completed_at INTEGER,
                workspace_kind TEXT,
                workspace_path TEXT,
                session_id TEXT,
                project_id TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS task_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                profile TEXT,
                step_key TEXT,
                status TEXT,
                started_at INTEGER,
                ended_at INTEGER,
                outcome TEXT,
                summary TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS task_comments (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT NOT NULL,
                author TEXT,
                body TEXT,
                created_at INTEGER
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS task_links (
                parent_id TEXT NOT NULL,
                child_id TEXT NOT NULL,
                PRIMARY KEY (parent_id, child_id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS task_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id TEXT,
                run_id TEXT,
                kind TEXT,
                payload TEXT,
                created_at INTEGER
            )
        """)

        await db.execute(
            """
            INSERT INTO tasks (id, title, body, assignee, status, priority, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (task_id, title.strip(), body or "", assignee, status, priority, created_by, now),
        )
        await db.commit()

    return await get_task(task_id)


# Columns a PATCH is allowed to write. Anything else is silently ignored to
# avoid clobbering dispatcher-managed fields (claim_lock, worker_pid, …).
EDITABLE_FIELDS = {"title", "body", "assignee", "priority", "status", "project_id"}


async def update_task_status(task_id: str, new_status: str) -> dict | None:
    """Update a task's status and related timestamps. Returns the updated task or None.

    Kept for backwards compatibility with the Phase 5 PATCH endpoint that only
    changed status. New callers should prefer ``update_task`` which accepts a
    partial dict.
    """
    if new_status not in VALID_STATUSES:
        return None

    if not os.path.exists(DB_PATH):
        return None

    async with aiosqlite.connect(DB_PATH) as db:
        # Check task exists
        async with db.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)) as cur:
            if not await cur.fetchone():
                return None

        now = int(datetime.now(timezone.utc).timestamp())

        if new_status == "running":
            await db.execute(
                """
                UPDATE tasks
                SET status = ?, started_at = COALESCE(started_at, ?)
                WHERE id = ?
                """,
                (new_status, now, task_id),
            )
        elif new_status == "done":
            await db.execute(
                """
                UPDATE tasks
                SET status = ?, completed_at = ?
                WHERE id = ?
                """,
                (new_status, now, task_id),
            )
        else:
            await db.execute(
                "UPDATE tasks SET status = ? WHERE id = ?",
                (new_status, task_id),
            )

        await db.commit()

    # Return updated task via get_task
    return await get_task(task_id)


async def update_task(task_id: str, updates: dict) -> dict | None:
    """Apply a partial update to a task. ``updates`` is a dict of field→value.

    Only fields in ``EDITABLE_FIELDS`` are considered. When ``status`` is
    present the same timestamp bookkeeping as ``update_task_status`` applies.
    Returns the refreshed task dict or ``None`` if the task is missing.
    """
    if not os.path.exists(DB_PATH):
        return None

    # Filter to editable fields and validate status/priority up front.
    filtered: dict = {}
    for k, v in updates.items():
        if k not in EDITABLE_FIELDS:
            continue
        if v is None and k in ("title",):
            # title is NOT NULL in the schema; never null it out.
            continue
        if k == "status" and v not in VALID_STATUSES:
            return None  # invalid status value
        if k == "priority" and v is not None:
            try:
                v = int(v)
            except (TypeError, ValueError):
                return None
        filtered[k] = v

    if not filtered:
        # Nothing to do — return the current task so the caller gets a 200.
        return await get_task(task_id)

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)) as cur:
            if not await cur.fetchone():
                return None

        now = int(datetime.now(timezone.utc).timestamp())

        # Special-case status so we keep started_at/completed_at consistent.
        new_status = filtered.pop("status", None)
        if new_status is not None:
            if new_status == "running":
                await db.execute(
                    "UPDATE tasks SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?",
                    (new_status, now, task_id),
                )
            elif new_status == "done":
                await db.execute(
                    "UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?",
                    (new_status, now, task_id),
                )
            else:
                await db.execute(
                    "UPDATE tasks SET status = ? WHERE id = ?",
                    (new_status, task_id),
                )

        # Apply any remaining editable columns.
        if filtered:
            set_clause = ", ".join(f"{col} = ?" for col in filtered)
            params: list = list(filtered.values()) + [task_id]
            await db.execute(
                f"UPDATE tasks SET {set_clause} WHERE id = ?",
                params,
            )

        await db.commit()

    return await get_task(task_id)


async def add_comment(task_id: str, author: str, body: str) -> dict | None:
    """Append a comment to ``task_comments``. Returns the new comment dict."""
    if not os.path.exists(DB_PATH):
        return None
    if not body.strip():
        return None
    author = author or "agentos"
    now = int(datetime.now(timezone.utc).timestamp())

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT id FROM tasks WHERE id = ?", (task_id,)) as cur:
            if not await cur.fetchone():
                return None

        cur = await db.execute(
            "INSERT INTO task_comments (task_id, author, body, created_at) VALUES (?, ?, ?, ?)",
            (task_id, author, body, now),
        )
        await db.commit()
        comment_id = cur.lastrowid

    return {
        "id": comment_id,
        "task_id": task_id,
        "author": author,
        "body": body,
        "created_at": _ts_to_iso(now),
    }


async def bulk_update(task_ids: list[str], updates: dict) -> dict:
    """Apply the same partial update to many tasks at once.

    Returns ``{"updated": N, "skipped": M, "ids": [...]}`` where ``ids`` lists
    the tasks that were actually modified.
    """
    if not task_ids or not updates:
        return {"updated": 0, "skipped": len(task_ids), "ids": []}

    updated_ids: list[str] = []
    skipped = 0
    for tid in task_ids:
        result = await update_task(tid, updates)
        if result is None:
            skipped += 1
        else:
            updated_ids.append(tid)
    return {"updated": len(updated_ids), "skipped": skipped, "ids": updated_ids}


async def search_tasks(q: str, limit: int = 50) -> list[dict]:
    """Free-text search across task titles (LIKE-based; kanban.db has no FTS5)."""
    if not os.path.exists(DB_PATH):
        return []
    pattern = f"%{q}%"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT id, title, assignee, status, priority, created_at
            FROM tasks
            WHERE title LIKE ? OR body LIKE ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (pattern, pattern, max(1, min(limit, 200))),
        ) as cur:
            rows = await cur.fetchall()
        return [
            {
                "id": r["id"],
                "title": r["title"],
                "assignee": r["assignee"],
                "status": r["status"],
                "priority": r["priority"],
                "created_at": _ts_to_iso(r["created_at"]),
            }
            for r in rows
        ]


async def get_kanban_stats() -> dict:
    """Aggregate statistics for the dashboard / kanban header.

    Returns counts by status, by assignee, by priority, plus totals and recent
    completion timestamps. Designed to be cheap — a handful of grouped queries
    against kanban.db.
    """
    if not os.path.exists(DB_PATH):
        return {"by_status": {}, "by_assignee": {}, "by_priority": {}, "total": 0}

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        by_status: dict[str, int] = {}
        async with db.execute(
            "SELECT status, COUNT(*) as c FROM tasks WHERE status != 'archived' GROUP BY status"
        ) as cur:
            async for r in cur:
                by_status[r["status"]] = r["c"]

        by_assignee: dict[str, int] = {}
        async with db.execute(
            """
            SELECT COALESCE(assignee, 'unassigned') as a, COUNT(*) as c
            FROM tasks WHERE status != 'archived'
            GROUP BY a ORDER BY c DESC
            """,
        ) as cur:
            async for r in cur:
                by_assignee[r["a"]] = r["c"]

        by_priority: dict[str, int] = {}
        async with db.execute(
            """
            SELECT COALESCE(priority, 0) as p, COUNT(*) as c
            FROM tasks WHERE status != 'archived'
            GROUP BY p ORDER BY p ASC
            """,
        ) as cur:
            async for r in cur:
                by_priority[str(r["p"])] = r["c"]

        total = sum(by_status.values())

        # Recently completed (last 7 days)
        cutoff = int(datetime.now(timezone.utc).timestamp()) - 7 * 86400
        recent_done = 0
        async with db.execute(
            "SELECT COUNT(*) as c FROM tasks WHERE status = 'done' AND completed_at IS NOT NULL AND completed_at >= ?",
            (cutoff,),
        ) as cur:
            r = await cur.fetchone()
            if r:
                recent_done = r["c"]

    return {
        "by_status": by_status,
        "by_assignee": by_assignee,
        "by_priority": by_priority,
        "total": total,
        "recent_done_7d": recent_done,
    }


async def get_task(task_id: str) -> dict | None:
    """Return full task detail including runs, comments, and links."""
    if not os.path.exists(DB_PATH):
        return None

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT
                id,
                title,
                body,
                assignee,
                status,
                priority,
                created_by,
                created_at,
                started_at,
                completed_at,
                workspace_kind,
                workspace_path,
                session_id,
                project_id
            FROM tasks
            WHERE id = ?
            """,
            (task_id,),
        ) as cur:
            row = await cur.fetchone()

        if not row:
            return None

        # runs
        runs = []
        async with db.execute(
            """
            SELECT
                id,
                profile,
                step_key,
                status,
                started_at,
                ended_at,
                outcome,
                summary
            FROM task_runs
            WHERE task_id = ?
            ORDER BY started_at DESC
            """,
            (task_id,),
        ) as cur:
            async for r in cur:
                runs.append({
                    "id": r["id"],
                    "profile": r["profile"],
                    "step_key": r["step_key"],
                    "status": r["status"],
                    "started_at": _ts_to_iso(r["started_at"]),
                    "ended_at": _ts_to_iso(r["ended_at"]),
                    "outcome": r["outcome"],
                    "summary": r["summary"],
                })

        # comments
        comments = []
        async with db.execute(
            """
            SELECT id, author, body, created_at
            FROM task_comments
            WHERE task_id = ?
            ORDER BY created_at DESC
            """,
            (task_id,),
        ) as cur:
            async for r in cur:
                comments.append({
                    "id": r["id"],
                    "author": r["author"],
                    "body": r["body"],
                    "created_at": _ts_to_iso(r["created_at"]),
                })

        # links
        children = []
        async with db.execute(
            "SELECT child_id FROM task_links WHERE parent_id = ?",
            (task_id,),
        ) as cur:
            async for r in cur:
                children.append(r["child_id"])

        parent_id = None
        async with db.execute(
            "SELECT parent_id FROM task_links WHERE child_id = ?",
            (task_id,),
        ) as cur:
            r = await cur.fetchone()
            if r:
                parent_id = r["parent_id"]

        return {
            "id": row["id"],
            "title": row["title"],
            "body": row["body"],
            "assignee": row["assignee"],
            "status": row["status"],
            "priority": row["priority"],
            "created_by": row["created_by"],
            "created_at": _ts_to_iso(row["created_at"]),
            "started_at": _ts_to_iso(row["started_at"]),
            "completed_at": _ts_to_iso(row["completed_at"]),
            "workspace_kind": row["workspace_kind"],
            "workspace_path": row["workspace_path"],
            "session_id": row["session_id"],
            "project_id": row["project_id"],
            "runs": runs,
            "comments": comments,
            "children": children,
            "parent_id": parent_id,
        }
