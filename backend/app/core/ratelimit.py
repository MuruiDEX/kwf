"""In-memory sliding-window rate limiting (§30). No external deps; per-process.
For multi-worker prod, replace store with Redis."""
from __future__ import annotations
import time
from collections import defaultdict, deque
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

# path prefix -> (max_requests, window_seconds)
# Auth stays tight (brute force); mutation endpoints get generous caps so normal
# organizer/referee flows never trip, while runaway clients still get cut off.
RULES: list[tuple[str, int, int]] = [
    ("/api/auth/login", 10, 60),
    ("/api/auth/register", 10, 60),
    ("/api/auth/avatar", 30, 60),
    ("/api/documents/verify", 30, 60),
    ("/api/tournaments/matches/", 120, 60),
    ("/api/tournaments", 120, 60),
    ("/api/search", 60, 60),
    ("/api/public/", 60, 60),
    # B1: public enumeration surface. Detail (trailing slash) is cheaper
    # browsing than full-list scans, hence the generous bucket. Order
    # matters (first match wins): detail rules before their list rules.
    ("/api/athletes/", 120, 60),
    ("/api/athletes", 60, 60),
    ("/api/clubs/", 120, 60),
    ("/api/clubs", 60, 60),
    ("/api/rankings", 60, 60),
    ("/api/documents/issue", 30, 60),
    # Wave 7: certificate.pdf renders a PDF per hit (cheap QR-DoS otherwise).
    # Placed after the specific rules above (first match wins), same budget.
    ("/api/documents", 30, 60),
]

_store: dict[str, deque[float]] = defaultdict(deque)

def _key(client_ip: str, route: str) -> str:
    return f"{client_ip}|{route}"

def is_allowed(key: str, limit: int, window: int, now: float | None = None) -> bool:
    now = now if now is not None else time.time()
    dq = _store[key]
    while dq and dq[0] <= now - window:
        dq.popleft()
    if len(dq) >= limit:
        return False
    dq.append(now)
    return True

def reset() -> None:
    _store.clear()

class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        path = request.url.path
        for prefix, limit, window in RULES:
            # verify endpoint is GET, auth endpoints are POST
            method_ok = (request.method == "POST") if prefix.startswith("/api/auth") else True
            if path.startswith(prefix) and method_ok:
                ip = request.client.host if request.client else "unknown"
                if not is_allowed(_key(ip, prefix), limit, window):
                    kk = request.headers.get("Accept-Language", "").lower().startswith("kk")
                    msg = "Өте көп әрекет. Бір минут күтіңіз." if kk else "Слишком много попыток. Подождите минуту."
                    return JSONResponse({"detail": msg}, status_code=429)
                break
        return await call_next(request)
