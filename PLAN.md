# AgentOS — Executable Development Plan

**Version:** 2.0.0 (revised by Hermes + Coder)
**Date:** 2026-07-05
**Status:** Approved for incremental implementation
**Repo:** Public GitHub (no secrets in code)

---

## 1. Final Architecture

```
┌─────────────────────────────────────────────────────┐
│  Container Hermes (s6, UID 10000, /opt/data)         │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ Gateway   │  │ Dashboard │  │ AgentOS (s6)     │ │
│  │ :8642     │  │ :9119     │  │ :9120            │ │
│  │ API+SSE   │  │ Hermes UI │  │ FastAPI + SPA    │ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│                                      ↑              │
│  ┌──────────────────────────────────┘              │
│  │ SQLite (read-only)    SQLite (read-write)        │
│  │ /opt/data/kanban.db   /opt/data/agentos.db       │
│  │ /opt/data/state.db    /opt/data/config.yaml(ro)  │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ┌──────────┐                                        │
│  │ ha-mcp   │  :8086 (separate)                     │
│  └──────────┘                                        │
└─────────────────────────────────────────────────────┘
```

### Key Decisions (revised vs original spec)

| Aspect | Original Spec (Nexus) | Revised (Hermes+Coder) | Reason |
|---------|----------------------|------------------------|-------|
| **Deploy** | Separate Docker container | **s6 service in Hermes container** | Avoids UID mismatch (lesson from Hermes Workspace) |
| **Port** | :3000 | **:9120** | Next available port after dashboard :9119 |
| **Frontend** | Next.js (SSR) | **Vite SPA** | No SSR for admin dashboard. 80MB vs 500MB RAM |
| **Backend** | FastAPI + Redis | **FastAPI standalone** | Redis is overkill for 1 user |
| **DB** | PostgreSQL + SQLite | **SQLite only** | Own AgentOS.db + read-only on kanban/state |
| **Auth** | JWT + RBAC from day 1 | **Auth via reverse proxy** (defer JWT to phase 13) | Single-user homelab doesn't need JWT in MVP |
| **Tests** | "Automated tests" | **Playwright E2E + vision (Pixel)** | Validates UI visually, not just DOM |
| **Deliverable** | 5 phases in 16 weeks | **13 one-week increments** | Feature per week, testable, cron-automatable |

---

## 2. Tech Stack Final

```
Backend:   FastAPI + Uvicorn + aiosqlite + cachetools
Frontend:  Vite + React + shadcn/ui + Tailwind + React Query + Zustand
Real-time: FastAPI native WebSocket
Kanban DnD: @dnd-kit/core
Charts:    Recharts
DB:        SQLite (/opt/data/agentos.db) + read-only Hermes DBs
Tests:     Playwright + pytest + Pixel vision
Deploy:    s6 service (uvicorn :9120)
```

**Estimated footprint:** ~80MB RAM, 1 Python process.

---

## 3. Security (Public GitHub)

### Mandatory rules

1. **No secrets in code** — all configs via env vars
2. `.gitignore` bulletproof:
   ```
   .env
   *.db
   *.db-shm
   *.db-wal
   __pycache__/
   node_modules/
   dist/
   .pytest_cache/
   /tmp/playwright-screenshots/
   ```
4. CI GitHub Action that rejects commits with `.*env*` or `*.key` files
5. SQLite Hermes DBs opened **read-only** (`mode=ro` in URI)
6. Writes to config.yaml via **Pydantic validation** + atomic write (temp+rename)
7. Path traversal guard on all file endpoints
8. `SECURITY.md` in repo with disclosure policy

### Required Environment Variables

```bash
# example.env — copy to .env and fill in
AGENTOS_DATA_DIR=/opt/data                    # Hermes data volume
AGENTOS_DB_PATH=/opt/data/agentos.db          # AgentOS own DB
HERMES_API_URL=http://localhost:8642           # Gateway API
HERMES_API_KEY=                               # API_SERVER_KEY from Hermes
AGENTOS_PORT=9120                             # AgentOS port
AGENTOS_HOST=0.0.0.0                          # Bind address
```

---

## 4. SDLC — Feature Development Workflow

### Profile Roles

| Profile | Role in SDLC | When |
|---------|-------------|--------|
| **Hermes (default)** | Orchestrates the workflow, creates Kanban task | Start of each increment |
| **Coder** | Implements the feature (backend + frontend) | During the sprint |
| **Pixel** | Validates UI/UX with Playwright + screenshot vision | After implementation |
| **Nexus** | Integrates, runs regression tests, commits | After validation |
| **Atlas** | Documents the feature in README | After integration |

### Workflow per feature

```
1. Hermes creates Kanban task (assignee=coder, workspace=dir:/opt/data/agentos)
2. Coder implements:
   a. Backend (FastAPI endpoint)
   b. Frontend (React component)
   c. E2E test (Playwright)
3. Pixel validates:
   a. Runs playwright + takes screenshot
   b. vision_analyze on screenshot
   c. Reports: PASS/FAIL + UI observations
4. Nexus integrates:
   a. Runs all E2E tests (regression)
   b. If PASS: git commit + push
   c. If FAIL: reports what broke, returns to Coder
5. Atlas documents:
   a. Updates README with the new feature
   b. Updates PLAN.md marking the increment as done
```

### Testing (future)

E2E tests with Playwright + vision validation will be added in a future phase.

---

## 5. Incremental Roadmap (1 feature per week)

### Phase 0 — Bootstrap (Week 1) ✅ DONE
- [x] Scaffold FastAPI app with `GET /health`
- [x] Scaffold Vite + React with landing page
- [x] `GET /health` returns `{"status": "ok", "version": "0.1.0"}`
- [x] Landing page shows "AgentOS"
- [x] GitHub repo created, `.gitignore`, `SECURITY.md`
- **Deliverable:** App running on `:9120` with initial page

### Phase 1 — Agent Health Cards (Week 2) ✅ DONE
- [x] Backend: `GET /api/agents` — dynamic profile discovery (default + sub-profiles)
- [x] Frontend: Dashboard with cards (name, model, status, sessions)
- [x] Pixel: Visual validation with Playwright + design refinement
- **Deliverable:** Functional dashboard showing the team (6 agents)

### Phase 2 — Session List (Week 3) ✅ DONE
- [x] Backend: `GET /api/sessions` — read-only query on `state.db`
- [x] Frontend: Table with filters (profile, search, date)
- [x] Frontend: FTS5 search in session list
- [x] Frontend: Pagination
- **Deliverable:** Session list with search and filters

### Phase 3 — Session Detail + Chat (Week 4-5) ✅ DONE
- [x] Backend: `GET /api/sessions/:id/messages` — read from `state.db`
- [x] Frontend: Chat thread with message bubbles (user/assistant/tool)
- [x] Frontend: Tool call expand/collapse cards
- [x] Frontend: Reasoning blocks
- [x] Bug fix: Message overflow (overflowWrap: anywhere for long content)
- [x] Bug fix: Default profile (Hermes) missing from dashboard
- **Deliverable:** Chat thread with tool calls and reasoning blocks (read-only)

### Phase 3.5 — Chat Detail Improvements (Week 5.5) ✅ DONE
- [x] **Markdown rendering** — react-markdown + remark-gfm renders headings, lists, code blocks, bold/italic, links, tables, blockquotes
- [x] **Line break handling** — remark-gfm preserves line breaks properly
- [x] **Code block syntax highlighting** — rehype-highlight with github-dark theme
- [x] **Message content sanitization** — react-markdown default (no raw HTML allowed)
- [x] **Tool call content formatting** — markdown in scrollable container
- **Deliverable:** Messages rendered with Markdown formatting, line breaks, and readable code blocks

### Phase 4 — Kanban Board Read-Only (Week 6) ✅ DONE
- [x] Backend: `GET /api/tasks` — read-only query on `kanban.db`
- [x] Frontend: 5 columns (backlog, todo, in_progress, review, done)
- [x] Frontend: Cards with title, assignee, priority
- [x] Frontend: Task detail view + archived toggle
- **Deliverable:** Visual Kanban board (read-only)

### Phase 5 — Kanban Drag & Drop (Week 7) ✅ DONE
- [x] Backend: `PATCH /api/tasks/{id}` — validates status, writes to `kanban.db`, auto-set started_at/completed_at
- [x] Frontend: @dnd-kit/core + @dnd-kit/sortable — drag cards between 5 columns with closestCorners
- [x] Frontend: Optimistic update via useMutation with rollback on error
- [x] Frontend: DragOverlay with rotation + shadow, column drop highlight (ring-accent)
- [x] Frontend: PointerSensor distance:5 (click vs drag no conflict)
- [x] Frontend: MarkdownRenderer in cards (task.title) and task detail (task.body) with prose-kanban-card CSS
- **Deliverable:** Functional Kanban with drag-and-drop + markdown rendering

### Phase 6 — Task Detail Panel (Week 8) ✅ DONE
- [x] Frontend: Tabbed interface (Overview, Runs, Comments, Children) with state-based tabs
- [x] Frontend: MarkdownRenderer in task title, comments, and body
- [x] Frontend: Count badges on tabs (Runs (N), Comments (N))
- [x] Frontend: data-testid attributes for testability
- [x] Frontend: Children tab with clickable cards
- **Deliverable:** Task detail with organized tabs and markdown in all content

### Phase 7 — Config Viewer (Week 9) ✅ DONE
- [x] Backend: `GET /api/config` — safe parse of `config.yaml` (safe_load) with secret redaction
- [x] Backend: `GET /api/config/raw` — YAML redacted as text
- [x] Frontend: Collapsible tree view (recursive ConfigNode, auto-expand 2 levels)
- [x] Frontend: YAML view with toggle (tree ↔ yaml)
- [x] Frontend: Search/filter by key name
- [x] Frontend: Secret indicators (🔒 + amber text for redacted values)
- [x] Frontend: Warning banner "Read-only — changes require container restart"
- [x] Frontend: Navbar link "Config"
- **Deliverable:** Read-only config viewer with secret redaction

### Phase 8 — Config Editor (Week 10) ✅ DONE
- [x] Backend: `PATCH /api/config` — atomic write (temp + rename), yaml.safe_dump
- [x] Backend: Secret field validation (NEVER_EDITABLE list, rejects api_key/token/password/etc)
- [x] Backend: Suffix-based matching (avoids false positives like max_tokens)
- [x] Frontend: Edit toggle (View ↔ Edit mode)
- [x] Frontend: Inline editors by type (text, number, boolean checkbox, list)
- [x] Frontend: Change tracking with modified indicator + count badge
- [x] Frontend: Sticky save bar (Save Changes (N) / Cancel)
- [x] Frontend: useMutation with cache invalidation
- **Deliverable:** Safe config editor with validation and atomic write

### Phase 9 — Skills Hub Browser (Week 11) ✅ DONE
- [x] Backend: `GET /api/skills` — parse SKILL.md YAML frontmatter
- [x] Backend: `GET /api/skills/{slug}` — full detail + file list
- [x] Frontend: Skills grid with category colors, search, filters, sort
- [x] Frontend: Detail modal with MarkdownRenderer
- [x] Cleanup: remove example.env, fix SECURITY.md, clean PLAN.md tests, improve .gitignore
- **Deliverable:** Functional skills browser
### Phase 10 — Workflow Editor Visual (Week 12) ✅ DONE
- [x] Backend: Complete CRUD — `backend/workflows.py` (SQLite table, 5 endpoints)
- [x] Frontend: React Flow canvas with custom nodes (trigger/action/condition)
- [x] Frontend: WorkflowListPage + WorkflowEditorPage + node palette + properties panel
- [x] Styling: Dark theme CSS overrides for React Flow
- **Deliverable:** Visual workflow editor (static)

### Phase 11 — Workflow Execution (Week 13) ✅ DONE
- [x] Backend: `backend/workflow_engine.py` — topological sort, node executor, cycle detection
- [x] Backend: `POST /api/workflows/{id}/run`, `GET /runs`, `GET /runs/{id}`
- [x] Backend: `workflow_runs` table with history + result JSON
- [x] Frontend: ▶ Run Now button, result toast, Run History panel
- [x] Frontend: Node config panel (action types, condition fields, trigger types)
- [x] Frontend: runResults state for visual indicators on nodes
- **Deliverable:** Executable workflows with execution engine

### Phase 12 — Polish (Week 14) ✅ DONE
- [x] Dark/Light mode toggle — ☀️/🌙 in navbar, localStorage persistence
- [x] Light theme CSS variables — `.light` class with all variables
- [x] Keyboard shortcuts — ⌘K quick search, `g+{d,s,t,c,k,w}` navigation, `?` help modal
- [x] Responsive navbar — hamburger menu on mobile, `sm:hidden`/`sm:flex`
- [x] SearchModal — search across sessions, tasks, skills, workflows
- [x] HelpModal — lists all available shortcuts
- **Deliverable:** Polished app with dark/light mode, shortcuts and responsive

### Phase 13 — Auth (Week 15) ✅ DONE
- [x] JWT authentication — token-based auth using Python stdlib hmac (no external JWT library)
- [x] Login page — `/login` route with username/password form
- [x] ProtectedRoute — frontend route guard redirects unauthenticated users to login
- [x] AuthContext — React context provides `user`, `token`, `login()`, `logout()` across the app
- [x] `backend/auth.py` — bcrypt-free password hashing via `hashlib.pbkdf2_hmac` (no C dependencies)
- [x] `backend/routers/auth.py` — `/api/auth/login`, `/api/auth/me`, `/api/auth/logout` endpoints
- [x] Multi-user ready — first run auto-creates `admin` user from env vars `AGENTOS_ADMIN_USER` / `AGENTOS_ADMIN_PASS`
- [x] All API routes protected with `require_auth` middleware (except `/health`, `/login`, static assets)
- **Deliverable:** Complete JWT auth, login page, protected routes, multi-user ready

### Phase 14 — Kanban Integration (Week 16) ✅ DONE
- [x] Task Editor Modal — edit title, body, assignee, priority, status
- [x] Enhanced Kanban Board — 5 columns, improved DnD, cards with badges
- [x] Filters & Search — by assignee, priority, status, title search
- [x] Bulk Operations — multi-select, batch status changes
- [x] Comments & Stats — task comments, completion stats
- [x] Notify webhook — Discord webhook on task completion
- **Deliverable:** Complete Kanban board with task editor, filters, bulk ops, notifications

### Phase 15 — User Management (Week 17) ✅ DONE
- [x] Settings page (`/settings`) — admin-only user management panel
- [x] List users — table with username, role, created date
- [x] Create users — form with username, password, role (admin/user)
- [x] Delete users — confirmation dialog, cannot delete self
- [x] Change passwords — admin can reset any user's password
- [x] `backend/routers/users.py` — CRUD endpoints for user management
- [x] Role-based access — admin sees Settings, regular users do not
- **Deliverable:** Multi-user management UI with create, delete, password reset

### Phase 16 — Cron Job Editor (Week 18) ✅ DONE
- [x] `GET /api/cron/jobs` — list all cron jobs from `jobs.json`
- [x] `POST /api/cron/jobs` — create new cron job
- [x] `PUT /api/cron/jobs/{id}` — update job (schedule, prompt, enabled)
- [x] `DELETE /api/cron/jobs/{id}` — delete cron job
- [x] `POST /api/cron/jobs/{id}/run` — trigger immediate execution
- [x] `POST /api/cron/jobs/{id}/pause` — pause job (sets enabled=false)
- [x] `POST /api/cron/jobs/{id}/resume` — resume job (sets enabled=true)
- [x] `backend/routers/cron.py` — CRUD + run/pause/resume endpoints
- [x] Frontend CronJobsPage — table with job name, schedule, status, actions
- [x] Inline editor — edit schedule expression and prompt text
- **Deliverable:** Complete cron job editor with CRUD, run now, pause/resume

### Phase 17 — Profile Editor (Advanced) (Week 19) ✅ DONE
- [x] 6-tab profile editor:
  - **Model** — select model provider and model name
  - **Agent** — configure agent behavior (temperature, max tokens, etc.)
  - **Toolsets** — enable/disable MCP servers and toolsets
  - **Description** — edit agent role description
  - **Memory / SOUL.md** — edit the agent's SOUL.md persona file
  - **Preview** — live preview of the full profile configuration
- [x] `backend/routers/profiles.py` — profile detail, soul read/write endpoints
- [x] `GET /api/profiles/{name}` — full profile detail with config + soul
- [x] `PUT /api/profiles/{name}/soul` — write SOUL.md content
- [x] Frontend ProfileEditorPage — tabbed editor with save/load
- **Deliverable:** Advanced profile editor with 6 tabs, SOUL.md editing, live preview

---

## 6. Automatic Implementation Cron

### Cron structure

Each increment is a Kanban task. The automatic workflow:

```yaml
# Cron job: AgentOS Sprint
schedule: "0 9 * * 1"  # Every Monday at 9:00
prompt: |
  Check PLAN.md at /opt/data/agentos/PLAN.md
  Identify the next incomplete increment
  Create Kanban task with:
    - assignee: coder
    - workspace: dir:/opt/data/agentos
    - skills: [planning-and-delegation, software-quality-practices]
  After Coder completes, dispatch Pixel to validate E2E
  After Pixel validates, dispatch Nexus to integrate and commit
  After Nexus commits, dispatch Atlas to document
  Mark increment as done in PLAN.md
```

### Quality gates (automatic)

| Gate | Who | What it checks |
|------|------|----------------|
| Implementation | Coder | Feature works + E2E test written |
| Visual Validation | Pixel | Screenshot + vision_analyze = PASS |
| Regression | Nexus | All previous E2E tests still pass |
| Documentation | Atlas | README + PLAN.md updated |

### Stop condition

If an increment fails 2 times (consecutive_failures=2), Kanban auto-blocks and escalates to Hermes (default profile), which notifies Mauricio via WhatsApp with the error and next step.

---

## 7. Repository Structure

```
agentos/
├── README.md                     # Overview + installation
├── SECURITY.md                   # Disclosure policy
├── LICENSE                       # MIT
├── 020-agentos                   # s6 cont-init.d script (reference)
├── .gitignore                    # Bulletproof
├── .github/
│   └── workflows/
│       ├── ci.yml                # Lint + test on PR
│       └── secrets-check.yml     # Reject .env/*.key commits
├── backend/
│   ├── main.py                   # FastAPI app
│   ├── config.py                 # Settings from env
│   ├── auth.py                   # JWT auth + pbkdf2_hmac password hashing
│   ├── routers/
│   │   ├── agents.py
│   │   ├── sessions.py
│   │   ├── tasks.py
│   │   ├── config.py
│   │   ├── skills.py
│   │   ├── workflows.py
│   │   ├── auth.py               # Auth endpoints (login, me, logout)
│   │   ├── users.py              # User CRUD (admin only)
│   │   ├── cron.py               # Cron job CRUD + run/pause/resume
│   │   └── profiles.py           # Profile detail + SOUL.md endpoints
│   ├── integrations/
│   │   ├── hermes_api.py         # REST API client
│   │   ├── kanban_db.py          # Read-only SQLite
│   │   ├── session_db.py         # Read-only SQLite
│   │   └── config_store.py       # YAML read (safe_load)
│   └── ws/
│       └── manager.py           # WebSocket
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Sessions.tsx
│   │   │   ├── Tasks.tsx
│   │   │   ├── Config.tsx
│   │   │   ├── Skills.tsx
│   │   │   ├── Workflows.tsx
│   │   │   ├── WorkflowEditor.tsx
│   │   │   ├── Settings.tsx       # User management (admin)
│   │   │   ├── CronJobs.tsx       # Cron job editor
│   │   │   ├── ProfileEditor.tsx  # Advanced profile editor (6 tabs)
│   │   │   ├── Login.tsx          # Login page
│   │   │   └── Profile.tsx        # Profile view
│   │   ├── components/
│   │   │   ├── auth/
│   │   │   │   ├── AuthContext.tsx
│   │   │   │   └── ProtectedRoute.tsx
│   │   │   └── ...                # Shared UI components
│   │   ├── components/
│   │   └── lib/
│   ├── package.json
│   └── vite.config.ts
├── tests/
│   └── e2e/
│       ├── conftest.py
│       └── features/
├── docker/
│   ├── s6-agentos.run            # s6 service definition
│   └── Dockerfile               # Multi-stage (Node build → Python serve)
└── docs/
    ├── PLAN.md                   # This document (progress tracker)
    ├── ARCHITECTURE.md
    └── CHANGELOG.md
```

---

## 8. Current Status

| Phase | Status | Feature | Notes |
|-------|--------|---------|-------|
| 0 | ✅ Done | Bootstrap + landing page | FastAPI + Vite scaffold |
| 1 | ✅ Done | Agent health cards | 6 profiles (incl. default/Hermes), dynamic discovery |
| 2 | ✅ Done | Session list | FTS5 search, pagination, filters |
| 3 | ✅ Done | Session detail + chat | Message bubbles, tool calls, reasoning blocks |
| 3.5 | ✅ Done | Chat detail improvements | Markdown rendering, syntax highlighting, GFM |
| 4 | ✅ Done | Kanban read-only | 5 columns, task detail, archived toggle |
| — | ✅ Done | Visual identity | DESIGN.md, dark theme, Pixel refinement |
| — | ✅ Done | Bug fixes | Message overflow, default profile missing |
| 5 | ✅ Done | Kanban DnD + Markdown | @dnd-kit, PATCH endpoint, optimistic update, MarkdownRenderer in cards |
| 6 | ✅ Done | Task detail tabs | Overview/Runs/Comments/Children tabs, markdown in title+comments |
| 7 | ✅ Done | Config viewer | Tree+YAML view, secret redaction, search, read-only |
| 8 | ✅ Done | Config editor | Atomic write, secret validation, inline editors, change tracking |
| 9 | ✅ Done | Skills hub | Grid view, category colors, search/filter/sort, detail modal |
| 10 | ✅ Done | Workflow editor | React Flow canvas, CRUD, node palette, dark theme |
| 11 | ✅ Done | Workflow execution | Toposort engine, Run Now, run history, node config |
| 12 | ✅ Done | Polish | Dark/light toggle, ⌘K search, nav shortcuts, responsive |
| 13 | ✅ Done | Auth | JWT, login page, ProtectedRoute, AuthContext, multi-user |
| 14 | ✅ Done | Kanban Integration | Task editor modal, filters/search, comments, stats, bulk ops, notify webhook |
| 15 | ✅ Done | User Management | Settings page, list/create/delete users, change passwords |
| 16 | ✅ Done | Cron Job Editor | CRUD jobs.json, run now, pause/resume, edit schedule/prompt |
| 17 | ✅ Done | Profile Editor (Advanced) | 6 tabs: Model, Agent, Toolsets, Description, Memory, Preview |

---

## 9. How to Resume (for any session)

To continue from where you left off:

1. Read this file (`/opt/data/agentos/PLAN.md`) — see which phase is pending
2. Check the repo: `cd /opt/data/agentos && git log --oneline -5`
3. Run existing tests: `cd /opt/data/agentos && pytest tests/e2e/ -v`
4. Check Kanban status: `sqlite3 /opt/data/kanban.db "SELECT id,title,status FROM tasks WHERE title LIKE '%AgentOS%' ORDER BY created_at DESC LIMIT 5;"`
5. Implement the next pending increment
6. Follow the SDLC workflow (Coder → Pixel → Nexus → Atlas)

### Auto-resume cron

```yaml
schedule: "0 9 * * *"  # Daily at 9:00
prompt: |
  Read /opt/data/agentos/PLAN.md and identify the next pending increment.
  Check if there's an active Kanban task for AgentOS.
  If there's no active task and there's a pending increment:
    1. Create Kanban task (assignee=coder, workspace=dir:/opt/data/agentos)
    2. After Coder completes, dispatch Pixel for E2E + vision
    3. After Pixel PASS, dispatch Nexus for regression + commit
    4. After Nexus commits, update PLAN.md marking increment as done
  If there's a blocked task: notify Mauricio via WhatsApp with error.
```

---

## 10. Completed Features Summary

### Core Platform
- **FastAPI + Vite SPA** — s6 service on port 9120, ~80MB RAM footprint
- **Agent Dashboard** — live status cards for all Hermes profiles (model, provider, gateway state, sessions)
- **Session History** — FTS5 full-text search, pagination, profile/date filters
- **Session Detail** — chat thread with markdown rendering, syntax highlighting, tool call expansion, reasoning blocks

### Kanban
- **Kanban Board** — 5-column drag-and-drop (@dnd-kit), markdown in cards
- **Task Detail** — tabbed interface (Overview, Runs, Comments, Children), markdown everywhere
- **Task Editor** — edit title, body, assignee, priority, status in modal
- **Filters & Search** — by assignee, priority, status, title search
- **Bulk Operations** — multi-select, batch status changes
- **Notify Webhook** — Discord webhook on task completion

### Configuration & Skills
- **Config Viewer** — collapsible tree + YAML toggle, secret redaction, search/filter
- **Config Editor** — inline editors (text/number/bool/list), atomic write, secret field protection
- **Skills Hub** — grid view, category colors, search/filter/sort, detail modal

### Workflows
- **Workflow Editor** — React Flow canvas, custom nodes (trigger/action/condition), CRUD
- **Workflow Execution** — toposort engine, cycle detection, Run Now, run history, node config

### Authentication & Users
- **JWT Authentication** — stdlib hmac-based tokens, login page, ProtectedRoute, AuthContext
- **Password Hashing** — pbkdf2_hmac (bcrypt-free, no C dependencies, stdlib only)
- **User Management** — Settings page, list/create/delete users, change passwords (admin)
- **Multi-user Ready** — first-run auto-creates admin, role-based access (admin/user)

### Cron & Scheduling
- **Cron Job Editor** — CRUD jobs.json, run now, pause/resume, edit schedule/prompt

### Profile Management
- **Advanced Profile Editor** — 6 tabs: Model, Agent, Toolsets, Description, Memory (SOUL.md), Preview
- **SOUL.md Editing** — read/write agent persona file via API

### UX Polish
- **Dark/Light Mode** — toggle in navbar, localStorage persistence
- **Keyboard Shortcuts** — ⌘K quick search, `g+{d,s,t,c,k,w}` navigation, `?` help modal
- **Responsive Design** — hamburger menu on mobile, adaptive layout
- **Markdown Everywhere** — react-markdown + remark-gfm + rehype-highlight in chat, cards, comments, tasks

*Living document — update after each completed increment.*
