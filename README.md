# AgentOS

A web UI control plane for [Hermes Agent](https://hermes-agent.nousresearch.com) — dashboard, session history, kanban board, and more. Runs as an s6 service inside the Hermes container, or standalone alongside any Hermes installation.

## Features

- **Agent Dashboard** — Live status cards for all your Hermes profiles (model, provider, gateway state, session count). Auto-discovers the default profile and all sub-profiles.
- **Session History** — Browse, search, and filter all conversation sessions with FTS5 full-text search
- **Session Detail** — Read-only chat thread viewer with reasoning blocks, tool call expansion, and message timeline
- **Kanban Board** — Interactive task board with drag-and-drop between 5 columns (backlog, ready, running, done, blocked), markdown rendering in cards, task detail view, and archived toggle
- **Visual Identity** — Dark mission-control aesthetic with teal/gold accents, Inter + JetBrains Mono typography, ambient glow effects, sticky blur navbar
- **Cross-Platform** — Works in Docker containers, Linux/macOS pip installs, and Windows

## Screenshots

> Dashboard with 6 agent cards (Hermes + 5 sub-profiles)
> Session detail with chat bubbles, tool call expansion, and reasoning blocks
> Kanban board with 5 columns and task detail

## Quick Start (Dev Mode)

```bash
cd agentos

# Backend
pip install fastapi uvicorn[standard] aiosqlite pydantic-settings cachetools httpx
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 9120

# Frontend (another terminal)
cd frontend
npm install
npm run dev
```

Backend runs on http://localhost:9120, frontend dev server on http://localhost:5173.

For production, build the frontend and serve via FastAPI:

```bash
cd frontend && npm run build
# Built assets go to frontend/dist/ — FastAPI serves them at /
```

## Configuration

AgentOS auto-detects your Hermes data directory:

| Environment | Default Path | Detection |
|---|---|---|
| Docker container | `/opt/data` | Marker file `/opt/data/.hermes` |
| Linux / macOS | `~/.hermes` | Home directory fallback |
| Windows | `%USERPROFILE%\.hermes` | Home directory fallback |

Override with environment variables:

```bash
AGENTOS_DATA_DIR=/custom/path    # Explicit override
HERMES_DATA_DIR=/hermes/path     # Hermes native variable (also detected)
```

### Profile Discovery

AgentOS discovers profiles from two locations:

1. **Default profile** — `config.yaml`, `SOUL.md`, `gateway_state.json` at the data root (e.g. `/opt/data/`)
2. **Sub-profiles** — Each subdirectory under `profiles/` (e.g. `/opt/data/profiles/coder/`)

All profiles are shown on the dashboard with live gateway state, model info, and session counts.

## Architecture

```
┌─────────────────┐
│   Browser       │
│  localhost:9120 │
└────────┬────────┘
         │
┌────────▼────────┐
│   AgentOS       │
│  FastAPI +      │
│  React (Vite)   │
│  Port 9120      │
└────────┬────────┘
         │
┌────────▼────────┐
│   Hermes Agent  │
│  localhost:8642 │
│  state.db       │
│  kanban.db      │
│  profiles/      │
│  config.yaml    │
└─────────────────┘
```

AgentOS reads Hermes state directly from:
- `state.db` (SQLite) — session history, messages, FTS5 search
- `kanban.db` (SQLite) — task board, task runs, comments (read + write for status updates)
- `config.yaml` + `profiles/*/config.yaml` — agent model, provider info
- `gateway_state.json` — live gateway PID and state
- `SOUL.md` — agent role description

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /health` | Health check |
| `GET /api/agents` | List all profiles with live status |
| `GET /api/sessions` | Paginated session list with filters (search, profile, date) |
| `GET /api/sessions/{id}` | Session metadata |
| `GET /api/sessions/{id}/messages` | Chat messages with pagination |
| `GET /api/tasks` | Kanban board tasks |
| `GET /api/tasks/{id}` | Task detail with runs and comments |
| `PATCH /api/tasks/{id}` | Update task status (drag-and-drop) |
| `GET /api/config` | Config tree (secrets redacted) |
| `GET /api/config/raw` | Config as YAML text (secrets redacted) |
| `PATCH /api/config` | Update config fields (secret fields rejected) |
| `GET /api/skills` | List all installed skills (metadata only) |
| `GET /api/skills/{slug}` | Get skill detail (full SKILL.md + file list) |
| `GET /api/profiles` | List profiles with model, skill counts, external dirs |
| `GET /api/workflows` | List all workflows |
| `GET /api/workflows/{id}` | Get workflow detail (nodes + edges) |
| `POST /api/workflows` | Create new workflow |
| `PUT /api/workflows/{id}` | Update workflow (name, nodes, edges) |
| `DELETE /api/workflows/{id}` | Delete workflow |

## Tech Stack

- **Backend** — FastAPI (Python 3.13+), SQLite, uvicorn, aiosqlite
- **Frontend** — React 18, Vite 5, Tailwind CSS, TanStack Query, React Router, @dnd-kit (drag-and-drop), react-markdown + remark-gfm + rehype-highlight
- **Fonts** — Inter (UI), JetBrains Mono (code/data)
- **Design** — Dark theme (`#0B1120` base), teal accent (`#00E5B9`), gold secondary (`#F5B800`)

## Roadmap

- [x] Phase 0 — Bootstrap (FastAPI + Vite scaffold)
- [x] Phase 1 — Agent Dashboard (live health cards, dynamic profile discovery)
- [x] Phase 2 — Session History (list, search, FTS5, pagination, filters)
- [x] Phase 3 — Session Detail (chat thread, reasoning blocks, tool calls)
- [x] Phase 3.5 — Markdown rendering (react-markdown, syntax highlighting, GFM)
- [x] Phase 4 — Kanban Board (read-only, 5 columns, task detail, archived toggle)
- [x] Phase 5 — Kanban Drag & Drop (@dnd-kit, PATCH endpoint, markdown in cards)
- [x] Phase 6 — Task Detail Panel (tabs: Overview, Runs, Comments, Children)
- [x] Phase 7 — Config Viewer (read-only tree + YAML view, secret redaction)
- [x] Phase 8 — Config Editor (inline editing, atomic write, secret field protection)
- [x] Visual Identity — DESIGN.md spec, dark mission-control theme, Pixel design refinement
- [x] s6 Autostart — cont-init.d script, survives container rebuilds
- [x] Phase 9 — Skills Hub (browse installed skills, search, filter, detail modal)
- [x] Phase 10 — Workflow Editor (React Flow canvas, CRUD, node palette, dark theme)
- [ ] Phase 11+ — Workflow execution, Polish

See [PLAN.md](PLAN.md) for the full roadmap and [DESIGN.md](DESIGN.md) for the visual identity spec.

## License

MIT
