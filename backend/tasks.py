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
