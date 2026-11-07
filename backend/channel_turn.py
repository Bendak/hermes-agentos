"""Accumulate one channel turn into the local chat transcript.

The gateway emits a small event stream per turn (thinking, tool, attachment,
final/error).  The live Chat.tsx panel is ephemeral; this recorder keeps the
same information on the assistant row so a reload still shows reasoning and
tool cards.  It is deliberately independent from the SSE consumer: a refresh
or a closed tab must not lose a completed turn.
"""

from __future__ import annotations

from typing import Any, Callable, Optional


class ChannelTurnRecorder:
    def __init__(self, session_id: str,
                 append: Callable[[str, str, str, Optional[dict]], Any]):
        self.session_id = session_id
        self._append = append
        self.thinking_text = ""
        self.turn_tools: list[dict] = []
        self.attachments: list[dict] = []
        self.active_tools: dict[int, tuple[str, str]] = {}
        self.done = False

    def on_frame(self, frame: dict[str, Any]) -> None:
        if self.done:
            return
        kind = frame.get("type")
        if kind == "thinking":
            # The plugin emits one frame per new progress line.  Do not try
            # to dedupe by suffix: two legitimate lines can share a suffix.
            text = frame.get("text") or ""
            if text:
                self.thinking_text += text
        elif kind == "tool" and frame.get("event") == "started":
            index = frame.get("index")
            if index is not None:
                self.active_tools[int(index)] = (
                    frame.get("name") or "tool", frame.get("preview") or "")
        elif kind == "tool" and frame.get("event") == "finished":
            index = frame.get("index")
            stored = self.active_tools.pop(int(index), None) if index is not None else None
            name = (stored[0] if stored else frame.get("name")) or "tool"
            preview = (stored[1] if stored else frame.get("preview")) or ""
            self.turn_tools.append({
                "function": {"name": name, "arguments": preview},
            })
        elif kind == "attachment":
            self.attachments.append({
                key: frame.get(key) for key in
                ("kind", "name", "mime", "caption", "path", "url")
            })
        elif kind == "final":
            self._flush(frame.get("text") or "")
        elif kind == "error":
            code = frame.get("code")
            message = frame.get("message") or "Erro no turno"
            self._flush(message, error={"code": code, "message": message})

    def _flush(self, text: str, error: Optional[dict] = None) -> None:
        if self.done:
            return
        meta: dict[str, Any] = {}
        if self.thinking_text:
            meta["reasoning_content"] = self.thinking_text
        if self.turn_tools:
            meta["tool_calls"] = list(self.turn_tools)
        if self.attachments:
            meta["attachments"] = list(self.attachments)
        if error:
            meta["error"] = error
        self._append(self.session_id, "assistant", text, meta or None)
        self.done = True
