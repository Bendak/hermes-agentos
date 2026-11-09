"""Dependency health for the AgentOS dashboard.

The public ``/health`` endpoint only proves the AgentOS process is alive.  This
module adds an authenticated snapshot of the pieces the UI depends on: the
Hermes API server, the AgentOS channel plugin and local writable state.
"""

from __future__ import annotations

import os
import tempfile
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, Depends

from backend.auth import DB_PATH as AUTH_DB_PATH, require_auth
from backend.channel_client import channel_env, channel_mode
from backend.config import settings

router = APIRouter()

_TIMEOUT = 3.0
_UNKNOWN = "unknown"
_OK = "ok"
_DOWN = "down"


def _channel_health_url() -> str:
    raw = channel_env("AGENTOS_CHANNEL_URL", "ws://127.0.0.1:9130/ws")
    parsed = urlparse(raw)
    scheme = "https" if parsed.scheme in {"wss", "https"} else "http"
    netloc = parsed.netloc or "127.0.0.1:9130"
    return f"{scheme}://{netloc}/health"


def _uploads_root() -> str:
    explicit = channel_env("AGENTOS_CHANNEL_MEDIA_ROOT")
    if explicit:
        return explicit
    return os.path.join(settings.AGENTOS_DATA_DIR, "agentos", "uploads")


def _latency_ms(started: float) -> int:
    return max(0, int((time.monotonic() - started) * 1000))


async def _probe(client: httpx.AsyncClient, service_id: str, label: str, url: str) -> dict[str, Any]:
    started = time.monotonic()
    try:
        response = await client.get(url)
        latency = _latency_ms(started)
        if response.status_code >= 400:
            return {
                "id": service_id,
                "label": label,
                "status": _DOWN,
                "detail": f"HTTP {response.status_code}",
                "latency_ms": latency,
            }
        payload = response.json()
        if not isinstance(payload, dict):
            raise ValueError("payload inválido")
        if payload.get("ok") is False or payload.get("status") not in (None, "ok"):
            return {
                "id": service_id,
                "label": label,
                "status": _DOWN,
                "detail": str(payload.get("status") or "indisponível"),
                "latency_ms": latency,
            }
        parts = [
            str(payload[key])
            for key in ("platform", "version")
            if payload.get(key)
        ]
        if "clients" in payload:
            clients = payload["clients"]
            parts.append(f"{clients} cliente" + ("" if clients == 1 else "s"))
        return {
            "id": service_id,
            "label": label,
            "status": _OK,
            "detail": " · ".join(parts) if parts else "respondendo",
            "latency_ms": latency,
        }
    except httpx.TimeoutException:
        return {
            "id": service_id,
            "label": label,
            "status": _DOWN,
            "detail": "tempo esgotado",
            "latency_ms": _latency_ms(started),
        }
    except Exception:
        return {
            "id": service_id,
            "label": label,
            "status": _DOWN,
            "detail": "sem conexão",
            "latency_ms": _latency_ms(started),
        }


def _local_check(service_id: str, label: str, path: str, writable: bool = False) -> dict[str, Any]:
    exists = os.path.exists(path)
    if not exists:
        return {
            "id": service_id,
            "label": label,
            "status": _DOWN,
            "detail": "ausente",
        }
    try:
        if writable:
            if os.path.isdir(path):
                with tempfile.NamedTemporaryFile(dir=path, prefix=".healthcheck-", delete=True):
                    pass
            else:
                fd = os.open(path, os.O_RDWR)
                os.close(fd)
        elif not os.access(path, os.R_OK):
            raise PermissionError(path)
    except OSError:
        return {
            "id": service_id,
            "label": label,
            "status": _DOWN,
            "detail": "sem permissão",
        }
    return {
        "id": service_id,
        "label": label,
        "status": _OK,
        "detail": "acessível",
    }


@router.get("/api/health/status")
async def health_status(_user: dict = Depends(require_auth)) -> dict[str, Any]:
    """Authenticated dependency snapshot used by the dashboard and health page."""
    services: list[dict[str, Any]] = [
        {
            "id": "agentos",
            "label": "AgentOS API",
            "status": _OK,
            "detail": f"versão {getattr(settings, 'AGENTOS_VERSION', '0.1.0')}",
            "latency_ms": 0,
        }
    ]

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        services.append(
            await _probe(
                client,
                "hermes",
                "Hermes API",
                f"{settings.HERMES_API_URL.rstrip('/')}/health",
            )
        )

        if channel_mode():
            services.append(
                await _probe(
                    client,
                    "channel",
                    "Canal AgentOS (plugin)",
                    _channel_health_url(),
                )
            )
        else:
            services.append(
                {
                    "id": "channel",
                    "label": "Canal AgentOS (plugin)",
                    "status": _UNKNOWN,
                    "detail": "modo HTTP legado",
                }
            )

    services.append(
        _local_check(
            "database",
            "Banco local",
            AUTH_DB_PATH,
            writable=True,
        )
    )
    services.append(
        _local_check(
            "uploads",
            "Armazenamento de anexos",
            _uploads_root(),
            writable=True,
        )
    )

    degraded = any(service["status"] == _DOWN for service in services)
    return {
        "status": "degraded" if degraded else "ok",
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "services": services,
    }
