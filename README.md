# AgentOS

A web UI control plane for [Hermes Agent](https://hermes-agent.nousresearch.com) — dashboard, session history, kanban board, and more. Runs as an s6 service inside the Hermes container, or standalone alongside any Hermes installation.

## Features

- **Agent Dashboard** — Live status cards for all your Hermes profiles (model, provider, gateway state, session count)
- **Session History** — Browse, search, and filter all conversation sessions with FTS5 full-text search
- **Cross-Platform** — Works in Docker containers, Linux/macOS pip installs, and Windows

## Quick Start (Dev Mode)

```bash
cd agentos

# Backend
pip install -r backend/requirements.txt
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 9120

# Frontend (another terminal)
cd frontend
npm install
npm run dev
```

Backend runs on http://localhost:9120, frontend dev server on http://localhost:5173.

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
│  profiles/      │
└─────────────────┘
```

AgentOS reads Hermes state directly from `state.db` (SQLite) and profile configs from `profiles/*/config.yaml`. No write access needed — AgentOS is read-only by design.

## Roadmap

- [x] Phase 0 — Bootstrap (FastAPI + Vite scaffold)
- [x] Phase 1 — Agent Dashboard (live health cards)
- [x] Phase 2 — Session History (list, search, FTS5)
- [ ] Phase 3 — Session Detail + Chat Streaming
- [ ] Phase 4+ — Kanban board, config UI, skills browser, cron management

See [PLAN.md](PLAN.md) for the full roadmap.

## License

MIT