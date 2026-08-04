"""Chat + Voice endpoints for AgentOS.

Proxies OpenAI-compatible requests to the Hermes API server (port 8642)
and transcribes audio via Groq Whisper for push-to-talk voice commands.

The AgentOS process runs in the SAME container as the Hermes gateway, so
it talks to the API server over localhost. API_SERVER_KEY is injected by
the Hermes docker-compose environment.
"""
import json
import os
import re
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from backend.auth import require_auth
from backend.config import settings

router = APIRouter()

HERMES_API_URL = settings.HERMES_API_URL or "http://localhost:8642"
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo"


def _hermes_api_key() -> str:
    """API server key: explicit setting, container env, or Hermes .env fallback."""
    key = settings.HERMES_API_KEY or os.environ.get("API_SERVER_KEY")
    if key:
        return key
    # Fallback: parse the Hermes .env on disk (same container, /opt/data/.env)
    env_path = os.path.join(settings.AGENTOS_DATA_DIR, ".env")
    try:
        with open(env_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("API_SERVER_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    raise HTTPException(status_code=500, detail="API_SERVER_KEY not configured")


def _groq_api_key() -> str:
    """Groq key for STT: env, then Hermes .env fallback."""
    key = os.environ.get("GROQ_API_KEY")
    if key:
        return key
    env_path = os.path.join(settings.AGENTOS_DATA_DIR, ".env")
    try:
        with open(env_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("GROQ_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured (needed for voice)")


def _sanitize_messages(messages: List[dict]) -> List[dict]:
    """Keep only role/content pairs the OpenAI-compatible API accepts."""
    clean = []
    for m in messages:
        role = m.get("role")
        content = m.get("content")
        if role in ("system", "user", "assistant") and isinstance(content, str):
            clean.append({"role": role, "content": content})
    if not clean:
        raise HTTPException(status_code=400, detail="No valid messages")
    return clean


@router.post("/api/chat")
async def chat(
    body: dict,
    user: dict = Depends(require_auth),
):
    """Proxy to Hermes API server /v1/chat/completions with SSE streaming."""
    messages = _sanitize_messages(body.get("messages", []))
    stream = bool(body.get("stream", True))
    model = body.get("model") or "hermes-agent"

    headers = {
        "Authorization": f"Bearer {_hermes_api_key()}",
        "Content-Type": "application/json",
    }
    payload = {"model": model, "messages": messages, "stream": stream}

    client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0))
    try:
        req = client.build_request("POST", f"{HERMES_API_URL}/v1/chat/completions", headers=headers, json=payload)
        resp = await client.send(req, stream=True)
        if resp.status_code != 200:
            body_text = (await resp.aread()).decode("utf-8", "replace")
            await client.aclose()
            raise HTTPException(status_code=resp.status_code, detail=f"Hermes API error {resp.status_code}: {body_text[:500]}")

        if not stream:
            data = await resp.aread()
            await client.aclose()
            return StreamingResponse(
                iter([data]),
                media_type="application/json",
                headers={"Cache-Control": "no-cache"},
            )

        async def sse_gen():
            try:
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data:"):
                        yield line + "\n\n"
                    else:
                        yield f"data: {line}\n\n"
            finally:
                await resp.aclose()
                await client.aclose()

        return StreamingResponse(
            sse_gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except HTTPException:
        raise
    except Exception as exc:
        await client.aclose()
        raise HTTPException(status_code=502, detail=f"Hermes API unreachable: {exc}")


@router.post("/api/voice")
async def voice_transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(default="pt"),
    user: dict = Depends(require_auth),
):
    """Transcribe an audio upload (from browser MediaRecorder) via Groq Whisper."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No audio file")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio")
    if len(data) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio too large (max 25MB)")

    headers = {"Authorization": f"Bearer {_groq_api_key()}"}
    # MIME/extension mapping: MediaRecorder emits webm/opus on Chrome, ogg on Firefox
    content_type = file.content_type or "audio/webm"
    ext_map = {
        "audio/webm": "webm",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/mp4": "m4a",
        "audio/mpeg": "mp3",
        "audio/x-wav": "wav",
    }
    ext = ext_map.get(content_type.split(";")[0].strip(), "webm")
    files = {"file": (f"recording.{ext}", data, content_type)}

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        try:
            resp = await client.post(
                GROQ_URL,
                headers=headers,
                files=files,
                data={"model": DEFAULT_GROQ_MODEL, "language": language or "pt"},
            )
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Groq request failed: {exc}")

    if resp.status_code != 200:
        detail = resp.text[:300]
        raise HTTPException(status_code=resp.status_code, detail=f"Groq STT error {resp.status_code}: {detail}")

    try:
        text = resp.json().get("text", "").strip()
    except ValueError:
        text = ""
    if not text:
        raise HTTPException(status_code=422, detail="No speech detected")

    return {"text": text}
