"""In-memory live bus: fight + timer events broadcast to SSE/WS subscribers."""
from __future__ import annotations
import asyncio
import time
from collections import defaultdict

_subs: dict[int, set[asyncio.Queue]] = defaultdict(set)
_timers: dict[int, dict] = {}  # match_id -> {action, duration_sec, ends_at|None, updated_at}

def publish(tournament_id: int, event: dict) -> None:
    for q in list(_subs.get(tournament_id, set())):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            pass

def subscribe(tournament_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=100)
    _subs[tournament_id].add(q)
    return q

def unsubscribe(tournament_id: int, q: asyncio.Queue) -> None:
    _subs[tournament_id].discard(q)

def set_timer(match_id: int, action: str, duration_sec: int = 180) -> dict:
    """start|pause|reset the referee timer for a match. Returns serializable state."""
    now = time.time()
    if action == "start":
        state = {"action": "running", "duration_sec": duration_sec, "ends_at": now + duration_sec, "updated_at": now}
    elif action == "pause":
        prev = _timers.get(match_id, {})
        remaining = max((prev.get("ends_at") or now) - now, 0) if prev.get("action") == "running" else prev.get("remaining_sec", duration_sec)
        state = {"action": "paused", "duration_sec": duration_sec, "remaining_sec": int(remaining), "ends_at": None, "updated_at": now}
    else:  # reset
        state = {"action": "idle", "duration_sec": duration_sec, "ends_at": None, "updated_at": now}
    state["match_id"] = match_id
    _timers[match_id] = state
    return state

def get_timer(match_id: int) -> dict | None:
    return _timers.get(match_id)
