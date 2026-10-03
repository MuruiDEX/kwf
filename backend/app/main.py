from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from app.core.config import settings
from app.core.db import Base, engine
import app.models.user, app.models.club_athlete, app.models.tournament, app.models.competition, app.models.misc
from app.api import auth, tournaments, core, live, exports, admin, spravki, training
from app.core.ratelimit import RateLimitMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        resp = await call_next(request)
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        return resp

from contextlib import asynccontextmanager
from pathlib import Path

def run_db_migrations() -> None:
    """Alembic upgrade head. Baseline (0001) is create_all-equivalent with
    checkfirst, 0002+ are idempotent — safe on existing databases, no data loss."""
    from alembic import command
    from alembic.config import Config

    root = Path(__file__).resolve().parent.parent
    cfg = Config(str(root / "alembic.ini"))
    cfg.set_main_option("script_location", str(root / "alembic"))
    command.upgrade(cfg, "head")

@asynccontextmanager
async def lifespan(app: FastAPI):
    run_db_migrations()
    yield

app = FastAPI(title="KWF Tournament Platform", version="0.1.0", docs_url="/api/docs", lifespan=lifespan)

app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RateLimitMiddleware)

app.include_router(auth.router)
app.include_router(tournaments.router)
app.include_router(core.router)
app.include_router(live.router)
app.include_router(exports.router)
app.include_router(admin.router)
app.include_router(spravki.router)
app.include_router(training.router)

@app.get("/api/health")
def health():
    # Liveness + DB reachability for orchestrators (migrations already run
    # in lifespan; a lost DB after startup must still surface here).
    try:
        from sqlalchemy import text
        from app.core.db import SessionLocal
        db = SessionLocal()
        try:
            db.execute(text("SELECT 1"))
            return {"ok": True, "db": True}
        finally:
            db.close()
    except Exception:
        return {"ok": False, "db": False}
