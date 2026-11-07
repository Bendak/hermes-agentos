"""Chat + Voice endpoints for AgentOS.

Proxies OpenAI-compatible requests to the Hermes API server (port 8642)
and transcribes audio via Groq Whisper for push-to-talk voice commands.

The AgentOS process runs in the SAME container as the Hermes gateway, so
it talks to the API server over localhost. API_SERVER_KEY is injected by
the Hermes docker-compose environment.
"""
import asyncio
import json
import mimetypes
import os
import secrets
import time
import re
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from starlette.background import BackgroundTask

import logging

from backend import chat_sessions, chat_transcript
from backend.auth import require_auth
from backend.config import settings
from backend.channel_client import channel_mode, get_client

router = APIRouter()
logger = logging.getLogger(__name__)

HERMES_API_URL = settings.HERMES_API_URL or "http://localhost:8642"
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
DEFAULT_GROQ_MODEL = "whisper-large-v3-turbo"


def _profiles_dir() -> str:
    return os.environ.get("AGENTOS_PROFILES_DIR") or os.path.join(settings.AGENTOS_DATA_DIR, "profiles")


def _read_env_var(path: str, name: str) -> str:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("export "):
                    line = line[len("export "):].lstrip()
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _hermes_api_key(profile: str = "default") -> str:
    """API server key for the profile that will answer this session.

    The gateway resolves API_SERVER_KEY *inside the profile scope* for
    `/p/<profile>/` and fails closed when the profile has none, so a single
    root key can never authenticate a family profile. Never fall back to the
    root key for a named profile — that would silently downgrade to 401.
    """
    if profile and profile != "default":
        key = _read_env_var(os.path.join(_profiles_dir(), profile, ".env"), "API_SERVER_KEY")
        if key:
            return key
        raise HTTPException(
            status_code=500,
            detail=f"profile '{profile}' has no API_SERVER_KEY configured",
        )

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
        raise HTTPException(status_code=502, detail="Hermes API unreachable")



# ── Sessões (Lote 1 — chat da família) ───────────────────────────────────────

_PROFILE_RE = re.compile(r"^[a-z0-9_]{1,64}$")
_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9_.-]")

_turn_locks: dict[str, "asyncio.Lock"] = {}
_turn_locks_guard: "asyncio.Lock | None" = None


def _safe_username(name: str) -> str:
    return _SAFE_NAME_RE.sub("_", (name or ""))[:32] or "usuário"


def _lock_guard() -> "asyncio.Lock":
    global _turn_locks_guard
    if _turn_locks_guard is None:
        _turn_locks_guard = asyncio.Lock()
    return _turn_locks_guard


async def _acquire_turn_lock(session_id: str) -> "asyncio.Lock":
    """Uma sessão = um turno por vez (o gateway aceitaria dois em paralelo)."""
    async with _lock_guard():
        lock = _turn_locks.setdefault(session_id, asyncio.Lock())
    if lock.locked():
        raise HTTPException(status_code=409, detail="Turno já em andamento nesta sessão")
    await lock.acquire()
    return lock


def _ensure_profile_home(profile: str) -> None:
    """Garante um `state.db` VÁLIDO no home do profile antes de criar sessão.

    Profile recém-criado (ou recriado após purge) não tem o store. Um arquivo
    vazio não basta: o gateway responde 503 e não inicializa nesse fluxo. Usamos
    o próprio SessionDB do Hermes para criar o schema; fallback = touch (o tick
    do gateway pode inicializar depois).
    """
    if profile == "default":
        return
    prof_dir = os.path.join(_profiles_dir(), profile)
    db_path = os.path.join(prof_dir, "state.db")
    if os.path.exists(db_path) and os.path.getsize(db_path) > 0:
        return
    try:
        import sys
        if "/opt/hermes" not in sys.path:
            sys.path.insert(0, "/opt/hermes")
        from pathlib import Path as _Path
        from hermes_state import SessionDB

        SessionDB(_Path(db_path))
    except Exception:
        flags = os.O_WRONLY | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(db_path, flags, 0o600)
        os.close(fd)
    try:
        st = os.stat(prof_dir)
        os.chown(db_path, st.st_uid, st.st_gid)
        os.chmod(db_path, 0o600)
    except OSError:
        pass


def _hot_serve_profile(profile: str) -> None:
    """Pede ao gateway para servir o profile agora (inicializa o home).

    Best-effort: sem socket/verb antigo o tick periódico cobre; 'already served' ok.
    """
    if profile == "default":
        return
    try:
        import sys
        if "/opt/hermes" not in sys.path:
            sys.path.insert(0, "/opt/hermes")
        from pathlib import Path as _Path
        from gateway.control_socket import request_serve_profile_hot

        home = _Path(os.environ.get("HERMES_HOME") or "/opt/data")
        request_serve_profile_hot(home, profile)
    except Exception:
        pass


def _ensure_profile_key(profile: str) -> None:
    """Admin abriu conversa num profile sem API_SERVER_KEY: provisiona uma.

    O adaptador `/p/<profile>/` valida a chave NO ESCOPO do profile e falha
    fechado. Sem isso, qualquer profile sem `.env` próprio responde 401/500 e
    o dropdown do admin só funcionaria para os três que já tinham chave.

    Escrita append no MESMO inode (não troca owner) e chmod 600; o gateway relê
    o `.env` do profile por turno (memoizado por bytes), sem restart.
    """
    if profile == "default":
        return
    prof_dir = os.path.join(_profiles_dir(), profile)
    env_path = os.path.join(prof_dir, ".env")
    try:
        if os.path.exists(env_path):
            with open(env_path, "r", encoding="utf-8") as fh:
                for line in fh:
                    if line.startswith("API_SERVER_KEY=") and line.split("=", 1)[1].strip():
                        return
    except OSError:
        pass
    if os.path.islink(env_path):
        # escrever seguindo symlink escaparia do profile (D-C do round 6)
        raise HTTPException(status_code=400, detail="profile .env é symlink — recusando escrever")
    key = secrets.token_urlsafe(48)
    flags = os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(env_path, flags, 0o600)
    except OSError:
        raise HTTPException(status_code=400, detail="não foi possível gravar a chave do profile")
    try:
        created = os.fstat(fd).st_size == 0
        if created:
            st = os.stat(prof_dir)
            os.fchown(fd, st.st_uid, st.st_gid)
        with os.fdopen(fd, "a", encoding="utf-8", closefd=False) as fh:
            fh.write(f"\n# provisionada pelo AgentOS (admin) em {time.strftime('%Y-%m-%d')}\n")
            fh.write(f"API_SERVER_KEY={key}\n")
    finally:
        os.close(fd)
    os.chmod(env_path, 0o600)


def _validate_profile(profile: str) -> str:
    """A profile name we are willing to put in a URL path.

    Two gates: a strict charset (`.` and `/` never survive, so the request
    cannot escape the `/p/<profile>/` namespace) and the profile home must
    exist under the profiles dir (no ghost routing).
    """
    if not profile or profile == "default":
        return "default"
    if not _PROFILE_RE.fullmatch(profile):
        raise HTTPException(status_code=400, detail="profile inválido")
    # Mesmo critério da descoberta: dir sem config.yaml é profile morto (o delete
    # da API remove só config/SOUL). Roteá-lo criaria sessão órfã sem identidade.
    if not os.path.isfile(os.path.join(_profiles_dir(), profile, "config.yaml")):
        raise HTTPException(status_code=400, detail="profile inexistente")
    return profile


def _gateway_base(profile: str) -> str:
    """Profile-routed gateway root (`/p/<profile>`), default keeps the bare root."""
    profile = _validate_profile(profile)
    if profile != "default":
        return f"{HERMES_API_URL}/p/{profile}"
    return HERMES_API_URL


def _gateway_headers(profile: str = "default") -> dict:
    return {
        "Authorization": f"Bearer {_hermes_api_key(profile)}",
        "Content-Type": "application/json",
    }


async def _create_remote_session(profile: str, session_id: str, title: str | None) -> None:
    """Create the session row in the gateway so the transcript exists there.

    In channel mode the plugin creates the gateway session on the first
    MessageEvent; creating an API-server row here would leave an unused ghost.
    """
    if channel_mode():
        return

    payload = {"id": session_id, "source": "api_server"}
    if title:
        payload["title"] = title

    r = None
    for attempt in range(4):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
                r = await client.post(
                    f"{_gateway_base(profile)}/api/sessions",
                    headers=_gateway_headers(profile),
                    json=payload,
                )
        except httpx.HTTPError as exc:
            # Transport faults (refused, timeout, DNS) are not HTTPException: they
            # used to escape as a 500 and leave a ghost row listed.
            raise HTTPException(status_code=502, detail=f"gateway indisponível: {type(exc).__name__}")
        if r.status_code in (200, 201):
            return
        if r.status_code == 503 and attempt < 3:
            await asyncio.sleep(2.0)  # home do profile inicializando
            continue
        break

    if r is None:
        raise HTTPException(status_code=502, detail="gateway indisponível")
    if r.status_code == 503:
        raise HTTPException(
            status_code=400,
            detail="profile ainda não inicializado (state.db ausente)",
        )
    if r.status_code == 500:
        # Runtime com autoridade apontando para store perdido (D-A): o arquivo
        # pode existir e o home continuar quebrado.
        raise HTTPException(
            status_code=400,
            detail="profile sem estado — home do profile precisa ser reinicializado",
        )
    if r.status_code == 400:
        detail = "pedido recusado pelo Hermes"
        try:
            body = r.json()
            err = body.get("error") if isinstance(body, dict) else None
            msg = (err or {}).get("message") if isinstance(err, dict) else None
            if msg:
                detail = f"Hermes recusou a sessão: {msg}"
        except Exception:
            pass
        raise HTTPException(status_code=400, detail=detail)
    raise HTTPException(
        status_code=502,
        detail=f"Hermes session create failed ({r.status_code})",
    )


async def _remote_messages(profile: str, session_id: str, limit: int, offset: int) -> dict:
    # `order=latest`: sending `limit` without it makes the gateway serve the
    # OLDEST page (default_page = requested_limit is None).
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
            r = await client.get(
                f"{_gateway_base(profile)}/api/sessions/{session_id}/messages",
                headers=_gateway_headers(profile),
                params={"limit": limit, "offset": offset, "order": "latest"},
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"gateway indisponível: {type(exc).__name__}")
    if r.status_code == 404:
        raise HTTPException(status_code=404, detail="Sessão não existe no Hermes")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Hermes messages failed ({r.status_code})")
    data = r.json()
    out = []
    for m in data.get("data") or []:
        role = m.get("role")
        if role not in ("user", "assistant", "tool", "system"):
            continue
        tool_calls = m.get("tool_calls")
        if isinstance(tool_calls, str):
            try:
                import json as _json
                tool_calls = _json.loads(tool_calls)
            except Exception:
                pass
        out.append({
            "role": role,
            "content": m.get("content") or "",
            "timestamp": m.get("timestamp"),
            "tool_name": m.get("tool_name"),
            # thinking/tool calls fazem parte do transcript que a UI mostra
            "reasoning_content": m.get("reasoning_content") or m.get("reasoning"),
            "tool_calls": tool_calls,
            "display_kind": m.get("display_kind"),
        })
    return {"data": out, "pagination": data.get("pagination") or {}}


async def _patch_remote_session(row: dict, *, archived: bool | None = None,
                                 title: str | None = None) -> None:
    """Espelha metadados no gateway (archived/title). Best-effort.

    A verdade para bloquear turnos é o estado local (stream responde 409 em
    sessão arquivada), então uma falha aqui não derruba a operação — mas o
    rename/archive no dashboard do Hermes fica consistente quando dá.
    """
    body: dict = {}
    if archived is not None:
        body["archived"] = archived
    if title is not None:
        body["title"] = title
    if not body:
        return
    if channel_mode():
        return
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0)) as client:
            r = await client.patch(
                f"{_gateway_base(row['profile'])}/api/sessions/{row['hermes_id']}",
                headers=_gateway_headers(row["profile"]),
                json=body,
            )
        if r.status_code not in (200, 404):
            logger.warning("gateway PATCH %s falhou (%s)", row["hermes_id"], r.status_code)
    except (httpx.HTTPError, HTTPException) as exc:
        logger.warning("gateway PATCH %s indisponível: %s", row["hermes_id"], type(exc).__name__)


def _owned_or_404(session_id: str, user: dict) -> dict:
    row = chat_sessions.get_owned(session_id, user["user_id"])
    if row is None:
        # 404 (not 403): another user's session must not even be confirmed to exist.
        raise HTTPException(status_code=404, detail="Sessão não encontrada")
    return row


@router.get("/api/chat/sessions")
async def list_chat_sessions(
    include_archived: bool = False,
    all: bool = False,
    user: dict = Depends(require_auth),
):
    chat_sessions.init_db()
    if all:
        # Suporte: admin vê todas, com o dono explícito (auditável no log).
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Admin access required")
        rows = chat_sessions.list_all(include_archived=include_archived)
        data = [{**chat_sessions.public(r), "user_id": r["user_id"]} for r in rows]
        return {"data": data}
    rows = chat_sessions.list_for_user(user["user_id"], include_archived=include_archived)
    return {"data": [chat_sessions.public(r) for r in rows]}


@router.post("/api/chat/sessions")
async def create_chat_session(body: dict, user: dict = Depends(require_auth)):
    chat_sessions.init_db()
    # Admin pode escolher o profile explicitamente (teste/suporte) — inclusive
    # uma conta admin fora do mapa. A validação (charset + diretório) continua.
    requested = body.get("profile")
    if user.get("role") == "admin" and isinstance(requested, str) and requested.strip():
        profile = _validate_profile(requested.strip())
    else:
        # Perfil vem do usuário logado; sem mapeamento NÃO tem chat (403).
        try:
            profile = chat_sessions.profile_for_user(user["user_id"], user["username"])
        except chat_sessions.ProfileConfigError:
            raise HTTPException(status_code=503, detail="mapeamento de profiles inválido no servidor")
        if profile is None:
            raise HTTPException(status_code=403, detail="Chat não habilitado para este usuário")
        profile = _validate_profile(profile)
    title = body.get("title")
    if title is not None and not isinstance(title, str):
        raise HTTPException(status_code=400, detail="title must be a string")

    if user.get("role") == "admin" and profile != "default":
        # dropdown do admin: prepara o home (state.db) e provisiona a chave na
        # primeira conversa — sem isso o profile recém-criado não abre sessão.
        _ensure_profile_home(profile)
        _ensure_profile_key(profile)
        _hot_serve_profile(profile)

    row = chat_sessions.create(user["user_id"], profile, title=title)
    try:
        # O título já foi limpo/capado em 100 por chat_sessions.create; mandar o
        # valor cru fazia o gateway rejeitar (>100) e a sessão nascer arquivada.
        await _create_remote_session(profile, row["hermes_id"], row["title"])
    except HTTPException:
        chat_sessions.set_archived(row["id"], user["user_id"], True)  # não deixa sessão órfã na lista
        raise
    return chat_sessions.public(row)


@router.patch("/api/chat/sessions/{session_id}")
async def patch_chat_session(session_id: str, body: dict, user: dict = Depends(require_auth)):
    row = _owned_or_404(session_id, user)
    if "title" in body:
        if not isinstance(body["title"], str):
            raise HTTPException(status_code=400, detail="title must be a string")
        updated_row = chat_sessions.rename(session_id, user["user_id"], body["title"])
        if updated_row is None:
            raise HTTPException(status_code=400, detail="Título vazio")
        await _patch_remote_session(row, title=updated_row["title"])
    if "archived" in body:
        if not isinstance(body["archived"], bool):
            raise HTTPException(status_code=400, detail="archived must be a boolean")
        chat_sessions.set_archived(session_id, user["user_id"], body["archived"])
        await _patch_remote_session(row, archived=body["archived"])
    updated = chat_sessions.get_owned(session_id, user["user_id"])
    assert updated is not None
    return chat_sessions.public(updated)


@router.delete("/api/chat/sessions/{session_id}")
async def delete_chat_session(session_id: str, user: dict = Depends(require_auth)):
    """Arquiva (soft delete): local e no gateway (best-effort).

    Local primeiro: mesmo que o gateway esteja fora, a sessão para de aceitar
    turnos (o stream responde 409 para arquivadas).
    """
    row = _owned_or_404(session_id, user)
    updated = chat_sessions.set_archived(session_id, user["user_id"], True)
    assert updated is not None
    await _patch_remote_session(row, archived=True)
    return chat_sessions.public(updated)


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
    if channel_mode():
        data = chat_transcript.list_messages(session_id, limit, offset)
        return {"data": data, "pagination": {"total": len(data), "limit": limit, "offset": offset}}
    return await _remote_messages(row["profile"], row["hermes_id"], limit, offset)


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _channel_media_root() -> str:
    return os.environ.get("AGENTOS_CHANNEL_MEDIA_ROOT") or os.path.join(
        settings.AGENTOS_DATA_DIR, "agentos", "uploads")


def _channel_media_paths(raw: object) -> list[str]:
    if not isinstance(raw, list):
        raise HTTPException(status_code=400, detail="media_urls inválido")
    root = os.path.realpath(_channel_media_root())
    out: list[str] = []
    for item in raw[:10]:
        if not isinstance(item, str) or not item:
            raise HTTPException(status_code=400, detail="media_urls inválido")
        real = os.path.realpath(item)
        if real != root and not real.startswith(root + os.sep):
            raise HTTPException(status_code=400, detail="anexo fora do diretório permitido")
        if not os.path.isfile(real):
            raise HTTPException(status_code=400, detail="anexo não encontrado")
        out.append(real)
    return out


async def _channel_turn_stream(row: dict, user: dict, body: dict):
    """Translate agentos-channel frames to the existing Chat.tsx SSE contract."""
    message = body.get("message") or body.get("input") or ""
    if not isinstance(message, str):
        raise HTTPException(status_code=400, detail="Mensagem inválida")
    media_urls = _channel_media_paths(body.get("media_urls") or [])
    if not message.strip() and not media_urls:
        raise HTTPException(status_code=400, detail="Mensagem vazia")
    media_types = body.get("media_types") if isinstance(body.get("media_types"), list) else []
    media_names = body.get("media_filenames") if isinstance(body.get("media_filenames"), list) else []
    if not media_types:
        media_types = [mimetypes.guess_type(path)[0] or "application/octet-stream"
                       for path in media_urls]
    if not media_names:
        media_names = [os.path.basename(path) for path in media_urls]

    session_id = row["id"]
    thread_id = row["hermes_id"]
    client = get_client()
    turn_attachments: list[dict] = []

    async def persist_frame(frame: dict) -> None:
        # This callback runs in the ChannelClient dispatcher, independent of the
        # SSE consumer.  A refresh/Stop therefore cannot lose the final answer:
        # the transcript is written even when the queue is already gone.
        kind = frame.get("type")
        if kind == "attachment":
            turn_attachments.append({k: frame.get(k) for k in
                                     ("kind", "name", "mime", "caption", "path", "url")})
        elif kind == "final":
            chat_transcript.append(
                session_id, "assistant", frame.get("text") or "",
                {"attachments": list(turn_attachments)} if turn_attachments else None)

    turn_lock = await _acquire_turn_lock(session_id)
    try:
        queue = await client.send_turn(
            thread_id, user_id=f"agentos:{user['user_id']}",
            user_name=user["username"], text=message,
            media_urls=media_urls, media_types=media_types,
            media_filenames=media_names, profile=row.get("profile"),
            on_frame=persist_frame)
    except RuntimeError:
        turn_lock.release()
        raise HTTPException(status_code=409, detail="Turno já em andamento nesta sessão")
    except Exception as exc:
        turn_lock.release()
        raise HTTPException(status_code=502, detail=f"canal indisponível: {type(exc).__name__}")

    chat_sessions.touch(session_id, title=chat_sessions.title_from_message(message or "Anexo"))
    chat_transcript.append(session_id, "user", message or "[anexo]")

    async def gen():
        attachments: list[dict] = []
        try:
            async for frame in client.frames(thread_id, queue):
                kind = frame.get("type")
                if kind == "delta":
                    yield _sse("assistant.delta", {"delta": frame.get("text") or ""})
                elif kind == "thinking":
                    yield _sse("tool.progress", {"tool_name": "_thinking",
                                                 "delta": frame.get("text") or ""})
                elif kind == "commentary":
                    yield _sse("assistant.commentary", {"text": frame.get("text") or ""})
                elif kind == "tool":
                    event = "tool.started" if frame.get("event") == "started" else (
                        "tool.completed" if frame.get("ok") else "tool.failed")
                    yield _sse(event, {"tool_name": frame.get("name") or "tool",
                                       "preview": frame.get("preview") or "",
                                       "index": frame.get("index")})
                elif kind == "attachment":
                    attachments.append({k: frame.get(k) for k in
                                        ("kind", "name", "mime", "caption", "path", "url")})
                    yield _sse("assistant.attachment",
                               {**attachments[-1], "message_id": frame.get("message_id")})
                elif kind == "approval":
                    yield _sse("approval.card", frame)
                elif kind == "approval_result":
                    yield _sse("approval.result", frame)
                elif kind == "approval_retired":
                    yield _sse("approval.retired", frame)
                elif kind == "final":
                    yield _sse("assistant.final", {"text": frame.get("text") or ""})
                    return
                elif kind == "error":
                    yield _sse("error", {"code": frame.get("code"),
                                         "message": frame.get("message") or "erro no canal"})
                    return
        finally:
            if turn_lock.locked():
                turn_lock.release()

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive",
                 "X-Accel-Buffering": "no"})


@router.post("/api/chat/sessions/{session_id}/stream")
async def chat_session_stream(session_id: str, body: dict, user: dict = Depends(require_auth)):
    """Turno SSE na sessão: identidade do JWT + author para a memória."""
    row = _owned_or_404(session_id, user)
    if row["archived"]:
        raise HTTPException(status_code=409, detail="Sessão arquivada")
    if channel_mode():
        return await _channel_turn_stream(row, user, body)
    message = body.get("message") or body.get("input")
    if not isinstance(message, str) or not message.strip():
        raise HTTPException(status_code=400, detail="Mensagem vazia")

    payload = {
        "message": message,
        "author": {"id": user["username"], "name": user["username"]},
        # Camada 1.5 do plano: o agente sabe com quem fala, sem depender do
        # `author` (que o pin de peer descarta para a memória).
        # Nome vai para a camada de SISTEMA: qualquer coisa fora do vocabulário
        # seguro vira "_" (um username malicioso não injeta instrução).
        "system_message": (
            f"Você fala com {_safe_username(user['username'])} (perfil {row['profile']}). "
            "Trate essa pessoa como a usuária desta conversa."
        ),
    }
    headers = _gateway_headers(row["profile"])
    headers["X-Hermes-Session-Key"] = row["session_key"]

    turn_lock = await _acquire_turn_lock(session_id)
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
            await resp.aread()
            await client.aclose()
            # Nunca repassar 401/403 do gateway como se fosse sessão expirada
            # do AgentOS (o cliente deslogaria), nem vazar corpo upstream.
            mapped = 404 if resp.status_code == 404 else 502
            raise HTTPException(
                status_code=mapped,
                detail=f"Falha ao executar o turno no Hermes ({resp.status_code})",
            )
            turn_lock.release()
        # Só depois de o gateway aceitar o turno: semear título e bump updated_at.
        chat_sessions.touch(session_id, title=chat_sessions.title_from_message(message))

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
                if turn_lock.locked():
                    turn_lock.release()

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
        if turn_lock.locked():
            turn_lock.release()
        raise
    except Exception:
        await client.aclose()
        if turn_lock.locked():
            turn_lock.release()
        raise HTTPException(status_code=502, detail="Hermes API unreachable")


_UPLOAD_EXTS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg",
    ".pdf", ".txt", ".md", ".csv", ".json", ".doc", ".docx", ".odt", ".rtf",
    ".mp3", ".wav", ".ogg", ".m4a", ".webm", ".mp4", ".mov",
}


@router.post("/api/chat/uploads")
async def chat_upload(file: UploadFile = File(...), user: dict = Depends(require_auth)):
    """Store a browser attachment under the channel's confined upload root."""
    name = os.path.basename(file.filename or "anexo")
    ext = os.path.splitext(name)[1].lower()
    if ext not in _UPLOAD_EXTS:
        raise HTTPException(status_code=400, detail="Tipo de anexo não permitido")
    root = os.path.realpath(_channel_media_root())
    os.makedirs(root, exist_ok=True)
    stored = os.path.join(root, f"{user['user_id']}-{secrets.token_hex(16)}{ext}")
    total = 0
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    try:
        fd = os.open(stored, flags, 0o600)
        with os.fdopen(fd, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > 25 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="Anexo muito grande")
                out.write(chunk)
    except HTTPException:
        try:
            os.unlink(stored)
        except OSError:
            pass
        raise
    except OSError:
        raise HTTPException(status_code=500, detail="Falha ao salvar anexo")
    # Derive the type from the allowlisted extension, never trust the browser's
    # declared content type (an HTML body renamed .png must not be served as HTML).
    mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
    return {"path": stored, "name": name, "mime": mime, "size": total}


@router.get("/api/chat/uploads/{stored_name}")
async def chat_upload_read(stored_name: str, user: dict = Depends(require_auth)):
    """Serve an uploaded attachment; only names directly under the upload root."""
    if os.path.basename(stored_name) != stored_name:
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    path = os.path.join(os.path.realpath(_channel_media_root()), stored_name)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Anexo não encontrado")
    return FileResponse(
        path, media_type=mimetypes.guess_type(path)[0] or "application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff",
                 "Content-Security-Policy": "default-src 'none'; sandbox"})


@router.post("/api/chat/approvals")
async def chat_approval(body: dict, user: dict = Depends(require_auth)):
    """Forward a card answer to the plugin; the gateway resolves the primitive."""
    if not channel_mode():
        raise HTTPException(status_code=404, detail="Aprovação disponível apenas no modo plugin")
    session_id = str(body.get("session_id") or "")
    prompt_id = str(body.get("prompt_id") or "")
    option_id = str(body.get("option_id") or "")
    text = body.get("text") if isinstance(body.get("text"), str) else ""
    if not session_id or not prompt_id or not option_id:
        raise HTTPException(status_code=400, detail="prompt/opção inválidos")
    row = _owned_or_404(session_id, user)
    try:
        await get_client().approve(row["hermes_id"], prompt_id, option_id, text)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"canal indisponível: {type(exc).__name__}")
    return {"status": "forwarded"}


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
