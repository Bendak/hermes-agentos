import asyncio

from backend.channel_client import ChannelClient
from backend.channel_turn import ChannelTurnRecorder


def test_recorder_persists_thinking_tools_and_final():
    rows = []
    rec = ChannelTurnRecorder("s1", lambda *args: rows.append(args))
    rec.on_frame({"type": "thinking", "text": "linha 1\n"})
    rec.on_frame({"type": "thinking", "text": "linha 2\n"})
    rec.on_frame({"type": "tool", "event": "started", "index": 1,
                  "name": "ha_get_state", "preview": "entity_id=..."})
    rec.on_frame({"type": "tool", "event": "finished", "index": 1, "ok": True})
    rec.on_frame({"type": "final", "text": "pronto"})

    assert len(rows) == 1
    session, role, content, meta = rows[0]
    assert (session, role, content) == ("s1", "assistant", "pronto")
    assert meta["reasoning_content"] == "linha 1\nlinha 2\n"
    assert meta["tool_calls"][0]["function"] == {
        "name": "ha_get_state", "arguments": "entity_id=..."}


def test_recorder_persists_terminal_error_and_does_not_duplicate():
    rows = []
    rec = ChannelTurnRecorder("s2", lambda *args: rows.append(args))
    rec.on_frame({"type": "thinking", "text": "pensando"})
    rec.on_frame({"type": "error", "code": "turn_failed", "message": "falhou"})
    rec.on_frame({"type": "final", "text": "não deveria"})

    assert len(rows) == 1
    _, role, content, meta = rows[0]
    assert (role, content) == ("assistant", "falhou")
    assert meta["reasoning_content"] == "pensando"
    assert meta["error"] == {"code": "turn_failed", "message": "falhou"}


def test_recorder_keeps_legitimate_suffix_lines():
    rows = []
    rec = ChannelTurnRecorder("s3", lambda *args: rows.append(args))
    for text in ("ok", "next", "ok"):
        rec.on_frame({"type": "thinking", "text": text})
    rec.on_frame({"type": "final", "text": "fim"})
    assert rows[0][3]["reasoning_content"] == "oknextok"


def test_frames_cancel_keeps_turn_lock_until_terminal():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        lock = asyncio.Lock()
        await lock.acquire()
        queue = asyncio.Queue()
        queue._agentos_lock = lock
        client._queues["t"] = queue
        client._callbacks["t"] = lambda frame: None
        gen = client.frames("t", queue, timeout=30)
        task = asyncio.create_task(gen.__anext__())
        await asyncio.sleep(0)
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert lock.locked()
        # The queue stays registered while the remote turn is still live;
        # otherwise a terminal arriving later cannot release the lock.
        assert client._queues.get("t") is queue
        await client._dispatch({"type": "final", "thread_id": "t", "text": "ok"})
        assert not lock.locked()
        assert "t" not in client._queues

    asyncio.run(run())


def test_frames_timeout_keeps_turn_open_for_late_final():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        lock = asyncio.Lock()
        await lock.acquire()
        queue = asyncio.Queue()
        queue._agentos_lock = lock
        client._queues["t"] = queue
        client._callbacks["t"] = lambda frame: None
        gen = client.frames("t", queue, timeout=0.01)
        frame = await gen.__anext__()
        assert frame["type"] == "error"
        assert frame["code"] == "timeout"
        # The remote turn may still finish: keep its callback/queue/lock.
        assert lock.locked()
        assert client._queues.get("t") is queue
        assert "t" in client._callbacks

    asyncio.run(run())


def test_dispatch_terminal_releases_and_unregisters_before_return():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        lock = asyncio.Lock()
        await lock.acquire()
        queue = asyncio.Queue()
        queue._agentos_lock = lock
        seen = []
        client._queues["t"] = queue
        client._callbacks["t"] = lambda frame: seen.append(frame)
        await client._dispatch({"type": "final", "thread_id": "t", "text": "ok"})
        assert seen and seen[0]["type"] == "final"
        assert not lock.locked()
        assert "t" not in client._callbacks
        assert "t" not in client._queues
        assert (await queue.get())["type"] == "final"

    asyncio.run(run())


def test_old_frames_does_not_pop_a_new_turn_queue():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        lock = asyncio.Lock()
        await lock.acquire()
        old = asyncio.Queue()
        old._agentos_lock = lock
        client._queues["t"] = old
        client._callbacks["t"] = lambda frame: None
        task = asyncio.create_task(client.frames("t", old, timeout=30).__anext__())
        await asyncio.sleep(0)
        new = asyncio.Queue()
        client._queues["t"] = new
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        assert client._queues.get("t") is new
        assert lock.locked()

    asyncio.run(run())


def test_recorder_keeps_started_tool_when_finish_is_missing():
    rows = []
    rec = ChannelTurnRecorder("s4", lambda *args: rows.append(args))
    rec.on_frame({"type": "tool", "event": "started", "index": 7,
                  "name": "ha_get_state", "preview": "entity_id=..."})
    rec.on_frame({"type": "final", "text": "fim"})
    tools = rows[0][3]["tool_calls"]
    assert tools[0]["function"]["name"] == "ha_get_state"
    assert tools[0]["function"]["arguments"] == "entity_id=..."


def test_transcript_exposes_error_metadata():
    from backend import chat_transcript
    sid = "error-meta-test"
    chat_transcript.clear(sid)
    chat_transcript.append(sid, "assistant", "falhou",
                           {"error": {"code": "turn_failed", "message": "falhou"}})
    row = chat_transcript.list_messages(sid)[0]
    assert row["error"] == {"code": "turn_failed", "message": "falhou"}


def test_force_release_clears_stuck_turn():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        lock = asyncio.Lock()
        await lock.acquire()
        queue = asyncio.Queue()
        queue._agentos_lock = lock
        client._queues["t"] = queue
        client._callbacks["t"] = lambda frame: None
        assert client.force_release("t") is True
        assert not lock.locked()
        assert "t" not in client._queues
        assert "t" not in client._callbacks
        assert client.force_release("t") is False

    asyncio.run(run())


def test_channel_turn_stream_persists_after_user_row(monkeypatch):
    import backend.chat as chat

    rows = []
    frames = [
        {"type": "thinking", "text": "raciocínio"},
        {"type": "tool", "event": "started", "index": 1,
         "name": "ha_get_state", "preview": "entity_id=x"},
        {"type": "tool", "event": "finished", "index": 1, "ok": True},
        {"type": "final", "text": "resposta"},
    ]

    class FakeClient:
        def __init__(self):
            self.queue = asyncio.Queue()

        async def send_turn(self, thread_id, *, on_frame=None, **kwargs):
            for frame in frames:
                if on_frame is not None:
                    await on_frame(frame)
                self.queue.put_nowait(frame)
            return self.queue

        async def frames(self, thread_id, queue, timeout=300):
            while True:
                frame = await queue.get()
                yield frame
                if frame.get("type") in ("final", "error"):
                    return

        def release(self, queue):
            return None

    fake = FakeClient()
    monkeypatch.setattr(chat, "get_client", lambda: fake)
    monkeypatch.setattr(chat.chat_sessions, "touch", lambda *a, **k: None)
    monkeypatch.setattr(chat.chat_transcript, "append",
                        lambda *args, **kwargs: rows.append((args, kwargs)))

    async def run():
        response = await chat._channel_turn_stream(
            {"id": "s", "hermes_id": "t", "profile": "default"},
            {"user_id": 1, "username": "user_a"},
            {"message": "oi"},
        )
        async for _ in response.body_iterator:
            pass

    asyncio.run(run())
    assert [row[0][1] for row in rows] == ["user", "assistant"]
    assert rows[0][1].get("meta") is None
    assert rows[1][0][3]["reasoning_content"] == "raciocínio"
    assert rows[1][0][3]["tool_calls"][0]["function"]["name"] == "ha_get_state"


def test_terminal_without_queue_does_not_release_foreign_lock():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        lock = asyncio.Lock()
        await lock.acquire()
        client._turn_locks["t"] = lock
        await client._dispatch({"type": "final", "thread_id": "t", "text": "stray"})
        assert lock.locked()

    asyncio.run(run())


def test_force_release_requires_matching_turn_id():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        lock = asyncio.Lock()
        await lock.acquire()
        queue = asyncio.Queue()
        queue._agentos_lock = lock
        queue._agentos_turn_id = "turn-a"
        client._queues["t"] = queue
        client._callbacks["t"] = lambda frame: None
        assert client.force_release("t", "turn-b") is False
        assert client._queues.get("t") is queue
        assert lock.locked()
        assert client.force_release("t", "turn-a") is True
        assert not lock.locked()
        assert "t" not in client._queues

    asyncio.run(run())


def test_transcript_exposes_turn_id_on_user_row():
    from backend import chat_transcript
    sid = "turn-id-test"
    chat_transcript.clear(sid)
    chat_transcript.append(sid, "user", "oi", meta={"turn_id": "turn-123"})
    row = chat_transcript.list_messages(sid)[0]
    assert row["turn_id"] == "turn-123"


def test_force_release_refuses_live_consumer_without_force():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        lock = asyncio.Lock()
        await lock.acquire()
        queue = asyncio.Queue()
        queue._agentos_lock = lock
        queue._agentos_turn_id = "turn-live"
        queue._agentos_consumer_active = True
        client._queues["t"] = queue
        client._callbacks["t"] = lambda frame: None
        assert client.force_release("t", "turn-live") is False
        assert lock.locked()
        assert client.force_release("t", "turn-live", force=True) is True
        assert not lock.locked()

    asyncio.run(run())


def test_transcript_tail_returns_latest_rows():
    from backend import chat_transcript
    sid = "tail-test"
    chat_transcript.clear(sid)
    for i in range(205):
        chat_transcript.append(sid, "user", f"m{i}")
    rows = chat_transcript.list_messages(sid, limit=200, tail=True)
    assert len(rows) == 200
    assert rows[0]["content"] == "m5"
    assert rows[-1]["content"] == "m204"


def test_late_thinking_updates_already_flushed_row():
    updates = []

    def append(session, role, content, meta):
        return 7

    def update(row_id, patch):
        updates.append((row_id, patch))

    rec = ChannelTurnRecorder("s-late", append, update)
    rec.on_frame({"type": "final", "text": "resposta"})
    rec.on_frame({"type": "thinking", "text": "raciocínio tardio"})
    assert updates[-1][0] == 7
    assert updates[-1][1]["reasoning_content"] == "raciocínio tardio"


def test_transcript_update_meta_merges_fields():
    from backend import chat_transcript
    sid = "update-meta-test"
    chat_transcript.clear(sid)
    row_id = chat_transcript.append(sid, "assistant", "ok", {"tool_calls": [1]})
    chat_transcript.update_meta(row_id, {"reasoning_content": "late"})
    row = chat_transcript.list_messages(sid)[0]
    assert row["reasoning_content"] == "late"
    assert row["tool_calls"] == [1]


def test_late_frame_after_terminal_reaches_original_callback():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        lock = asyncio.Lock()
        await lock.acquire()
        queue = asyncio.Queue()
        queue._agentos_lock = lock
        queue._agentos_turn_id = "turn-a"
        seen = []
        client._queues["t"] = queue
        client._callbacks["t"] = lambda frame: seen.append(frame)
        await client._dispatch({"type": "final", "thread_id": "t",
                                "turn_id": "turn-a", "text": "ok"})
        assert not lock.locked()
        assert "t" not in client._queues
        await client._dispatch({"type": "thinking", "thread_id": "t",
                                "turn_id": "turn-a", "text": "late"})
        assert [f["type"] for f in seen] == ["final", "thinking"]

    asyncio.run(run())


def test_late_frame_does_not_leak_into_a_new_turn_callback():
    async def run():
        client = ChannelClient(url="ws://unused", token="")
        old_seen, new_seen = [], []
        old_queue = asyncio.Queue()
        old_queue._agentos_turn_id = "turn-old"
        client._queues["t"] = old_queue
        client._callbacks["t"] = lambda frame: old_seen.append(frame)
        await client._dispatch({"type": "final", "thread_id": "t",
                                "turn_id": "turn-old", "text": "old"})
        new_queue = asyncio.Queue()
        new_queue._agentos_turn_id = "turn-new"
        client._queues["t"] = new_queue
        client._callbacks["t"] = lambda frame: new_seen.append(frame)
        await client._dispatch({"type": "thinking", "thread_id": "t",
                                "turn_id": "turn-old", "text": "straggler"})
        assert [f["type"] for f in old_seen] == ["final", "thinking"]
        assert new_seen == []

    asyncio.run(run())


def test_late_thinking_does_not_duplicate_unfinished_tools():
    updates = []

    def append(session, role, content, meta):
        return 9

    def update(row_id, patch):
        updates.append(patch)

    rec = ChannelTurnRecorder("s-dup", append, update)
    rec.on_frame({"type": "tool", "event": "started", "name": "x",
                  "preview": "p", "index": 1})
    rec.on_frame({"type": "final", "text": "ok"})
    rec.on_frame({"type": "thinking", "text": "late"})
    assert len(updates[-1]["tool_calls"]) == 1
