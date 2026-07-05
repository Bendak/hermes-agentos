import os
from contextlib import suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.config import settings

app = FastAPI(title="AgentOS", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:9120"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

AGENTS = [
    {"id": "coder", "name": "Coder", "model": "glm-5.2"},
    {"id": "pixel", "name": "Pixel", "model": "kimi-k2.6"},
    {"id": "atlas", "name": "Atlas", "model": "mimo-v2.5"},
    {"id": "nova", "name": "Nova", "model": "mimo-v2.5"},
    {"id": "nexus", "name": "Nexus", "model": "mimo-v2.5-pro"},
]


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": "0.1.0"}


@app.get("/api/agents")
def list_agents() -> list[dict]:
    return AGENTS


dist_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
with suppress(RuntimeError):
    if os.path.isdir(dist_path):
        app.mount("/", StaticFiles(directory=dist_path, html=True), name="static")
