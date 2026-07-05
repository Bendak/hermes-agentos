# AgentOS

A web UI control plane for Hermes Agent, deployed as an s6 service inside the Hermes container.

## Quick Start (Dev Mode)

```bash
cd /opt/data/agentos

# Backend
pip install -r backend/requirements.txt
python3 -m uvicorn backend.main:app --host 0.0.0.0 --port 9120

# Frontend (another terminal)
cd /opt/data/agentos/frontend
npm install
npm run dev
```

Backend runs on http://localhost:9120, frontend dev server on http://localhost:5173.

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
└─────────────────┘
```

## Links

- See [PLAN.md](PLAN.md) for the full roadmap.
