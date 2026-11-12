"""Text-to-speech for chat replies.

Default engine is Edge (Microsoft neural voices over the network): zero CPU on
the host and the same voice family the Hermes gateway uses. Kokoro-82M can be
enabled as a local engine; it runs in its own virtualenv at the lowest CPU and
I/O priority and falls back to Edge on any failure.

Configuration (process env, then ``<AGENTOS_DATA_DIR>/.env``):

- ``AGENTOS_TTS_PROVIDER``  ``edge`` (default) | ``kokoro``
- ``AGENTOS_TTS_VOICE``     Edge voice, default ``pt-BR-AntonioNeural``
- ``AGENTOS_KOKORO_PYTHON`` python of a venv with ``kokoro`` + ``soundfile``
- ``AGENTOS_KOKORO_VOICE``  Kokoro voice, default ``pf_dora``
- ``AGENTOS_KOKORO_LANG``   Kokoro language code, default ``p`` (pt-BR)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import os
import re
import tempfile
import weakref
from collections import OrderedDict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from backend.auth import require_auth
from backend.config import _dotenv_value

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_CHARS = 5000
EDGE_TIMEOUT = 60.0  # seconds; the service streams ~5000 chars well under this
DEFAULT_EDGE_VOICE = "pt-BR-AntonioNeural"
_WORKER = os.path.join(os.path.dirname(__file__), "tts_kokoro_worker.py")
_VOICE_RE = re.compile(r"^[A-Za-z0-9_-]{2,64}$")

# Local synthesis is CPU-bound: one at a time keeps the host responsive.
# One lock per event loop (an asyncio.Lock is bound to the loop it waits on).
_kokoro_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = (
    weakref.WeakKeyDictionary())


def _kokoro_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _kokoro_locks.get(loop)
    if lock is None:
        lock = _kokoro_locks[loop] = asyncio.Lock()
    return lock
_cache: "OrderedDict[str, tuple[bytes, str, str]]" = OrderedDict()
_CACHE_MAX = 48


class TTSError(RuntimeError):
    pass


def _setting(name: str, default: str = "") -> str:
    return (os.environ.get(name) or _dotenv_value(name) or default).strip()


# ── text cleanup ────────────────────────────────────────────────────────────
_FENCE = re.compile(r"```.*?(?:```|$)", re.S)
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_URL = re.compile(r"https?://\S+")
_HTML = re.compile(r"<[^>]+>")
_TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{2,}.*$", re.M)
_HEADING = re.compile(r"^\s{0,3}#{1,6}\s*", re.M)
_QUOTE = re.compile(r"^\s*>\s?", re.M)
_BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+", re.M)
_EMPH = re.compile(r"(\*{1,3}|_{1,3}|~~)(?=\S)(.+?)(?<=\S)\1")
_EMOJI = re.compile(
    "[\U0001F000-\U0001FAFF\U00002600-\U000027BF\U0001F1E6-\U0001F1FF"
    "\U00002B00-\U00002BFF\uFE0F\u200D]+"
)


def speakable_text(markdown: str) -> str:
    """Turn a markdown reply into something a voice can read."""
    text = markdown or ""
    text = _FENCE.sub(" (trecho de código omitido) ", text)
    text = _IMAGE.sub(" ", text)
    text = _LINK.sub(r"\1", text)
    text = _URL.sub(" link ", text)
    text = _HTML.sub(" ", text)
    text = _TABLE_RULE.sub("", text)
    text = _HEADING.sub("", text)
    text = _QUOTE.sub("", text)
    text = _BULLET.sub("", text)
    for _ in range(2):
        text = _EMPH.sub(r"\2", text)
    text = text.replace("`", "")
    text = re.sub(r"[ \t]*\|[ \t]*", ", ", text)
    text = _EMOJI.sub(" ", text)
    lines = [re.sub(r"[ \t]+", " ", ln).strip(" ,") for ln in text.splitlines()]
    out = []
    for ln in lines:
        if not ln:
            continue
        # a line without closing punctuation still needs a pause when read
        out.append(ln if ln[-1] in ".!?:;…" else ln + ".")
    return " ".join(out).strip()


# ── engines ─────────────────────────────────────────────────────────────────
async def _edge(text: str, voice: str) -> tuple[bytes, str]:
    try:
        import edge_tts  # type: ignore
    except ImportError as exc:  # pragma: no cover - dependency is declared
        raise TTSError("edge-tts not installed") from exc
    buf = bytearray()

    async def _collect() -> None:
        communicate = edge_tts.Communicate(text, voice)
        async for chunk in communicate.stream():
            if chunk.get("type") == "audio":
                buf.extend(chunk["data"])

    try:
        await asyncio.wait_for(_collect(), timeout=EDGE_TIMEOUT)
    except asyncio.TimeoutError as exc:
        raise TTSError("edge: timeout") from exc
    except Exception as exc:
        raise TTSError(f"edge: {type(exc).__name__}") from exc
    if not buf:
        raise TTSError("edge: empty audio")
    return bytes(buf), "audio/mpeg"


async def _kokoro(text: str, voice: str, lang: str) -> tuple[bytes, str]:
    python = _setting("AGENTOS_KOKORO_PYTHON")
    if not python or not os.path.isfile(python):
        raise TTSError("kokoro: AGENTOS_KOKORO_PYTHON not configured")
    async with _kokoro_lock():
        fd, out = tempfile.mkstemp(suffix=".wav", prefix="agentos-tts-")
        os.close(fd)
        try:
            cmd = [python, _WORKER, "--voice", voice, "--lang", lang, "--out", out]
            for wrapper in (["ionice", "-c", "3"], ["nice", "-n", "19"]):
                if _which(wrapper[0]):
                    cmd = wrapper + cmd
            env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
            if "HF_HUB_CACHE" not in env:
                from backend.config import settings
                hub = _setting("AGENTOS_KOKORO_HF_CACHE") or os.path.join(
                    settings.AGENTOS_DATA_DIR, "home", ".cache", "huggingface", "hub")
                if os.path.isdir(hub):
                    env["HF_HUB_CACHE"] = hub
            proc = await asyncio.create_subprocess_exec(
                *cmd, env=env,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, err = await asyncio.wait_for(proc.communicate(text.encode("utf-8")), timeout=180)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                raise TTSError("kokoro: timeout")
            if proc.returncode != 0:
                tail = (err or b"").decode("utf-8", "replace").strip().splitlines()[-1:] or [""]
                raise TTSError(f"kokoro: exit {proc.returncode} {tail[0][:200]}")
            with open(out, "rb") as fh:
                data = fh.read()
            if not data:
                raise TTSError("kokoro: empty audio")
            return data, "audio/wav"
        finally:
            try:
                os.unlink(out)
            except OSError:
                pass


def _which(name: str) -> bool:
    for d in os.environ.get("PATH", "/usr/bin:/bin").split(os.pathsep):
        if os.access(os.path.join(d, name), os.X_OK):
            return True
    return False


async def synthesize(text: str) -> tuple[bytes, str, str]:
    """Return ``(audio, mime, engine)``; Kokoro failures fall back to Edge."""
    provider = _setting("AGENTOS_TTS_PROVIDER", "edge").lower()
    edge_voice = _setting("AGENTOS_TTS_VOICE", DEFAULT_EDGE_VOICE)
    if not _VOICE_RE.match(edge_voice):
        edge_voice = DEFAULT_EDGE_VOICE
    key_parts = [provider, edge_voice]
    k_voice, k_lang = "pf_dora", "p"
    if provider == "kokoro":
        k_voice = _setting("AGENTOS_KOKORO_VOICE", "pf_dora")
        k_lang = _setting("AGENTOS_KOKORO_LANG", "p")
        if not _VOICE_RE.match(k_voice):
            k_voice = "pf_dora"
        if not re.fullmatch(r"[a-z]", k_lang):
            k_lang = "p"
        key_parts += [k_voice, k_lang]
    key = hashlib.sha256("\x00".join(key_parts + [text]).encode()).hexdigest()
    hit = _cache.get(key)
    if hit:
        _cache.move_to_end(key)
        return hit

    result: tuple[bytes, str, str] | None = None
    if provider == "kokoro":
        try:
            data, mime = await _kokoro(text, k_voice, k_lang)
            result = (data, mime, "kokoro")
        except TTSError as exc:
            logger.warning("kokoro falhou, usando edge: %s", exc)
    if result is None:
        data, mime = await _edge(text, edge_voice)
        result = (data, mime, "edge")

    _cache[key] = result
    while len(_cache) > _CACHE_MAX:
        _cache.popitem(last=False)
    return result


@router.post("/api/tts")
async def tts(body: dict, user: dict = Depends(require_auth)):
    raw = body.get("text") if isinstance(body, dict) else None
    if not isinstance(raw, str):
        raise HTTPException(status_code=400, detail="text must be a string")
    if len(raw) > MAX_CHARS * 4:
        raise HTTPException(status_code=413, detail="texto grande demais")
    text = speakable_text(raw) if body.get("markdown", True) else raw.strip()
    if not text:
        raise HTTPException(status_code=400, detail="nada para ler")
    if len(text) > MAX_CHARS:
        raise HTTPException(status_code=413, detail=f"texto acima de {MAX_CHARS} caracteres")
    try:
        data, mime, engine = await synthesize(text)
    except TTSError as exc:
        raise HTTPException(status_code=502, detail=f"TTS indisponível ({exc})")
    return Response(
        content=data,
        media_type=mime,
        headers={"Cache-Control": "private, max-age=3600", "X-TTS-Engine": engine},
    )
