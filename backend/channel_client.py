"""WebSocket client for the Hermes agentos-channel platform plugin.

AgentOS still serves the legacy HTTP path while ``AGENTOS_CHANNEL=http``.  In
``plugin`` mode the backend sends turns over this client and translates the
plugin's structured frames into the SSE contract consumed by Chat.tsx.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from typing import Any, AsyncIterator, Optional

import websockets

from backend.config import settings

logger = logging.getLogger(__name__)

_TERMINAL = {"final", "error"}


def _env(name: str, default: str = "") -> str:
    value = os.environ.get(name)
    if value:
        return value.strip()
    # same-container fallback: Hermes .env is the canonical secret location
    path = os.path.join(settings.AGENTOS_DATA_DIR, ".env")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line.startswith("export "):
                    line = line[7:].lstrip()
                if line.startswith(name + "="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return default


class ChannelClient:
    def __init__(self, url: Optional[str] = None, token: Optional[str] = None):
        self.url = url or _env("AGENTOS_CHANNEL_URL", "ws://127.0.0.1:9130/ws")
        self.token = token or _env("AGENTOS_CHANNEL_TOKEN")
        self._ws = None
        self._task: Optional[asyncio.Task] = None
        self._send_lock = asyncio.Lock()
        self._queues: dict[str, asyncio.Queue] = {}
        self._callbacks: dict[str, Any] = {}
        self._threads: set[str] = set()
        self._last_seq: dict[str, int] = {}
        self._closed = False
        self._connected = asyncio.Event()
        self._turn_locks: dict[str, asyncio.Lock] = {}

    @property
    def connected(self) -> bool:
        return self._ws is not None

    async def start(self) -> None:
        if self._task is None:
            self._closed = False
            self._task = asyncio.create_task(self._run(), name="agentos-channel-client")

    async def close(self) -> None:
        self._closed = True
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:
                pass
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None

    async def _run(self) -> None:
        backoff = 1.0
        while not self._closed:
            try:
                headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
                try:
                    ws = await websockets.connect(self.url, additional_headers=headers,
                                                  max_size=4 * 1024 * 1024, ping_interval=20)
                except TypeError:
                    ws = await websockets.connect(self.url, extra_headers=headers,
                                                  max_size=4 * 1024 * 1024, ping_interval=20)
                self._ws = ws
                self._connected.set()
                backoff = 1.0
                if self._threads:
                    await ws.send(json.dumps({"type": "hello", "threads": sorted(self._threads)}))
                    for thread_id, seq in self._last_seq.items():
                        if thread_id in self._threads:
                            await ws.send(json.dumps({"type": "resume",
                                                      "thread_id": thread_id,
                                                      "last_seq": seq}))
                async for raw in ws:
                    try:
                        frame = json.loads(raw)
                    except (TypeError, ValueError):
                        continue
                    if isinstance(frame, dict):
                        await self._dispatch(frame)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.debug("agentos channel disconnected: %s", exc)
            finally:
                self._connected.clear()
                self._ws = None
            if self._closed:
                break
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30.0)

    async def _dispatch(self, frame: dict[str, Any]) -> None:
        thread_id = str(frame.get("thread_id") or "")
        if not thread_id:
            # Only a legacy turn-scoped invalid_message may be rescued when
            # exactly one turn is waiting. Approval/resume errors are not turn
            # errors and must never terminate an unrelated session.
            if (frame.get("type") == "error"
                    and frame.get("code") == "invalid_message"
                    and len(self._queues) == 1):
                waiting = next(iter(self._queues))
                await self._queues[waiting].put(frame)
                self._callbacks.pop(waiting, None)
            return
        self._last_seq[thread_id] = max(self._last_seq.get(thread_id, 0),
                                        int(frame.get("seq") or 0))
        callback = self._callbacks.get(thread_id)
        if callback is not None:
            try:
                result = callback(frame)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                logger.warning("agentos channel frame callback failed", exc_info=True)
        queue = self._queues.get(thread_id)
        if queue is not None:
            await queue.put(frame)
        if frame.get("type") in _TERMINAL:
            self._callbacks.pop(thread_id, None)

    async def _ensure(self) -> None:
        if self._task is None:
            await self.start()
        if self.connected:
            return
        await asyncio.wait_for(self._connected.wait(), timeout=10.0)

    async def _send(self, frame: dict[str, Any]) -> None:
        await self._ensure()
        async with self._send_lock:
            if self._ws is None:
                raise RuntimeError("agentos channel disconnected")
            await self._ws.send(json.dumps(frame, ensure_ascii=False))

    async def send_turn(self, thread_id: str, *, user_id: str, user_name: str,
                        text: str, message_id: Optional[str] = None,
                        media_urls: Optional[list[str]] = None,
                        media_types: Optional[list[str]] = None,
                        media_filenames: Optional[list[str]] = None,
                        profile: Optional[str] = None,
                        on_frame: Optional[Any] = None) -> asyncio.Queue:
        lock = self._turn_locks.setdefault(thread_id, asyncio.Lock())
        if lock.locked():
            raise RuntimeError("turn_already_running")
        await lock.acquire()
        if thread_id not in self._threads:
            self._threads.add(thread_id)
            if self.connected:
                try:
                    await self._send_hello({thread_id})
                except Exception:
                    pass
        queue: asyncio.Queue = asyncio.Queue()
        self._queues[thread_id] = queue
        if on_frame is not None:
            self._callbacks[thread_id] = on_frame
        frame = {
            "type": "message", "thread_id": thread_id, "user_id": user_id,
            "user_name": user_name, "text": text,
            "message_id": message_id or f"agentos-{uuid.uuid4().hex}",
            "media_urls": media_urls or [], "media_types": media_types or [],
            "media_filenames": media_filenames or [],
        }
        if profile and profile != "default":
            frame["profile"] = profile
        try:
            await self._send(frame)
        except Exception:
            self._queues.pop(thread_id, None)
            self._callbacks.pop(thread_id, None)
            lock.release()
            raise
        # Attach the lock to the queue so the SSE generator can release it
        # exactly once in its finally block.
        queue._agentos_lock = lock  # type: ignore[attr-defined]
        return queue

    async def _send_hello(self, threads: set[str]) -> None:
        await self._send({"type": "hello", "threads": sorted(threads)})

    def release(self, queue: asyncio.Queue) -> None:
        lock = getattr(queue, "_agentos_lock", None)
        if lock is not None and lock.locked():
            lock.release()

    async def frames(self, thread_id: str, queue: asyncio.Queue,
                     timeout: float = 300.0) -> AsyncIterator[dict[str, Any]]:
        try:
            while True:
                frame = await asyncio.wait_for(queue.get(), timeout=timeout)
                yield frame
                if frame.get("type") in _TERMINAL:
                    return
        except asyncio.TimeoutError:
            yield {"type": "error", "code": "timeout",
                   "message": "AgentOS channel turn timed out"}
        finally:
            self._queues.pop(thread_id, None)
            self.release(queue)

    async def approve(self, thread_id: str, prompt_id: str, option_id: str,
                      text: str = "") -> None:
        await self._send({"type": "approval", "thread_id": thread_id,
                          "prompt_id": prompt_id, "option_id": option_id,
                          "text": text})


_client: Optional[ChannelClient] = None


def get_client() -> ChannelClient:
    global _client
    if _client is None:
        _client = ChannelClient()
    return _client


def channel_mode() -> bool:
    return _env("AGENTOS_CHANNEL", "http").lower() == "plugin"
