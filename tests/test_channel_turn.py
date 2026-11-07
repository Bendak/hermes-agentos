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
