"""Lets family members watch a call live: every event sent to the elder is mirrored to watchers."""

import asyncio
import random
import string

from fastapi import WebSocket


class Session:
    def __init__(self, sid: str, lang: str):
        self.id = sid
        self.lang = lang
        self.watchers: set[WebSocket] = set()
        self.history: list[dict] = []  # replayed to watchers who join late
        self.live = True

    async def publish(self, msg: dict):
        # Keep history light: drop big audio blobs and stale partials.
        slim = {k: v for k, v in msg.items() if k != "audio"}
        if msg["type"] not in ("partial", "report_audio"):
            self.history.append(slim)
        dead = []
        for ws in list(self.watchers):
            try:
                await ws.send_json(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.watchers.discard(ws)


sessions: dict[str, Session] = {}
_lock = asyncio.Lock()


def new_session_id() -> str:
    return "".join(random.choices(string.ascii_uppercase.replace("O", "").replace("I", "") + "23456789", k=5))


async def open_session(lang: str) -> Session:
    async with _lock:
        sid = new_session_id()
        while sid in sessions:
            sid = new_session_id()
        sessions[sid] = Session(sid, lang)
        # Keep memory bounded on a long-running demo server.
        if len(sessions) > 50:
            for old in [s for s in sessions.values() if not s.live][: len(sessions) - 50]:
                sessions.pop(old.id, None)
        return sessions[sid]
