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

from backend import chat_sessions
from backend.auth import require_auth
from backend.config import settings

router = APIRouter()

HERMES_API_URL = settings.HERMES_API_URL or "http://localhost:8642"
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo"


def _hermes_api_key() -> str:
    """API server key: explicit setting, Hermes .env on disk, then container env.

    The gateway validates Bearer tokens against API_SERVER_KEY resolved from
    /opt/data/.env (which Hermes may regenerate on updates), so the on-disk
    .env is the source of truth. The container environment (docker-compose)
    can go stale after Hermes regenerates the key — it is only a last-resort
    fallback (avoids the "Invalid gateway API key (API_SERVER_KEY)" 401).
    """
    key = settings.HERMES_API_KEY
    if not key:
        # Primary: parse the Hermes .env on disk (same container, /opt/data/.env)
        env_path = os.path.join(settings.AGENTOS_DATA_DIR, ".env")
        try:
            with open(env_path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line.startswith("API_SERVER_KEY="):
                        key = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
        except OSError:
            pass
    if not key:
        key = os.environ.get("API_SERVER_KEY")
    if key:
        return key
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



# ── Sessões (Lote 1 — chat da família) ───────────────────────────────────────

def _gateway_base(profile: str) -> str:
    """Profile-routed gateway root (`/p/<profile>`), default keeps the bare root."""
    if profile and profile != "default":
        return f"{HERMES_API_URL}/p/{profile}"
    return HERMES_API_URL


def _gateway_headers() -> dict:
    return {
        "Authorization": f"Bearer {_hermes_api_key()}",
        "Content-Type": "application/json",
    }


async def _create_remote_session(profile: str, session_id: str, title: str | None) -> None:
    """Create the session row in the gateway so the transcript exists there.

    We mint the id ourselves (`agentos_<uuid>`) — the API accepts `id`, so there
    is no second round trip and no chance of a duplicate.
    """
    payload = {"id": session_id, "source": "api_server"}
    if title:
        payload["title"] = title
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        r = await client.post(
            f"{_gateway_base(profile)}/api/sessions",
            headers=_gateway_headers(),
            json=payload,
        )
    if r.status_code not in (200, 201):
        raise HTTPException(
            status_code=502,
            detail=f"Hermes session create failed {r.status_code}: {r.text[:300]}",
        )


async def _remote_messages(profile: str, session_id: str, limit: int, offset: int) -> dict:
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        r = await client.get(
            f"{_gateway_base(profile)}/api/sessions/{session_id}/messages",
            headers=_gateway_headers(),
            params={"limit": limit, "offset": offset},
        )
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Sessão não existe no Hermes")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Hermes messages failed {r.status_code}: {r.text[:300]}")
    data = r.json()
    out = []
    for m in data.get("data") or []:
        role = m.get("role")
        if role not in ("user", "assistant", "tool", "system"):
            continue
        out.append({
            "role": role,
            "content": m.get("content") or "",
            "timestamp": m.get("timestamp"),
            "tool_name": m.get("tool_name"),
        })
    return {"data": out, "pagination": data.get("pagination") or {}}


def _owned_or_404(session_id: str, user: dict) -> dict:
    row = chat_sessions.get_owned(session_id, user["user_id"])
    if row is None:
        # 404 (not 403): another user's session must not even be confirmed to exist.
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    return row


@router.get("/api/chat/sessions")
async def list_chat_sessions(
    include_archived: bool = False,
    user: dict = Depends(require_auth),
):
    chat_sessions.init_db()
    rows = chat_sessions.list_for_user(user["user_id"], include_archived=include_archived)
    return {"data": [chat_sessions.public(r) for r in rows]}


@router.post("/api/chat/sessions")
async def create_chat_session(body: dict, user: dict = Depends(require_auth)):
    chat_sessions.init_db()
    # O perfil vem do usuário logado; admin pode pedir outro (teste/suporte).
    profile = chat_sessions.profile_for(user["username"])
    if user.get("role") == "admin" and isinstance(body.get("profile"), str) and body["profile"].strip():
        profile = body["profile"].strip()
    title = body.get("title")
    if title is not None and not isinstance(title, str):
        raise HTTPException(status_code=400, detail="title must be a string")

    row = chat_sessions.create(user["user_id"], profile, title=title)
    try:
        await _create_remote_session(profile, row["hermes_id"], title)
    except HTTPException:
        chat_sessions.set_archived(row["id"], user["user_id"], True)  # não deixa sessão órfã na lista
        raise
    return chat_sessions.public(row)


@router.patch("/api/chat/sessions/{session_id}")
async def patch_chat_session(session_id: str, body: dict, user: dict = Depends(require_auth)):
    _owned_or_404(session_id, user)
    if "title" in body:
        if chat_sessions.rename(session_id, user["user_id"], str(body["title"])) is None:
            raise HTTPException(status_code=400, detail="Título vazio")
    if "archived" in body:
        chat_sessions.set_archived(session_id, user["user_id"], bool(body["archived"]))
    row = chat_sessions.get_owned(session_id, user["user_id"])
    assert row is not None
    return chat_sessions.public(row)


@router.delete("/api/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str, user: dict = Depends(require_auth)):
    """Arquiva (soft delete) — o transcript continua no gateway."""
    _owned_or_404(session_id, user)
    row = chat_sessions.set_archived(session_id, user["user_id"], True)
    assert row is not None
    return chat_sessions.public(row)


@router.get("/api/chat/sessions/{session_id}/messages")
async def chat_session_messages(
    session_id: str,
    limit: int = 200,
    offset: int = 0,
    user: dict = Depends(require_auth),
):
    row = _owned_or_404(session_id, user)
    if limit < 1 or limit > 500 or offset < 0:
        raise HTTPException(status_code=400, detail="limit/offset inválidos")
    return await _remote_messages(row["profile"], row["hermes_id"], limit, offset)


@router.post("/api/chat/sessions/{session_id}/stream")
async def chat_session_stream(session_id: str, body: dict, user: dict = Depends(require_auth)):
    """Turno SSE na sessão: identidade do JWT + author para a memória."""
    row = _owned_or_404(session_id, user)
    message = body.get("message") or body.get("input")
    if not isinstance(message, str) or not message.strip():
        raise HTTPException(status_code=400, detail="Mensagem vazia")

    chat_sessions.touch(session_id, title=chat_sessions.title_from_message(message))

    payload = {
        "message": message,
        "author": {"id": user["username"], "name": user["username"]},
    }
    headers = _gateway_headers()
    headers["X-Hermes-Session-Key"] = row["session_key"]

    client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0))
    try:
        req = client.build_request(
            "POST",
            f"{_gateway_base(row['profile'])}/api/sessions/{row['hermes_id']}/chat/stream",
            headers=headers,
            json=payload,
        )
        resp = await client.send(req, stream=True)
        if resp.status_code != 200:
            detail = (await resp.aread()).decode("utf-8", "replace")
            await client.aclose()
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Hermes stream error {resp.status_code}: {detail[:400]}",
            )

        async def sse_gen():
            # Passthrough CRU: o gateway emite eventos SSE completos
            # (`event:`, `data:`, linha em branco). Reescrever linha a linha
            # quebrava o framing (prefixava `data:` em `event:`).
            try:
                async for chunk in resp.aiter_raw():
                    if chunk:
                        yield chunk
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
