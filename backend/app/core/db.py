from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, connect_args=connect_args, future=True)

if settings.database_url.startswith("sqlite"):
    # C5: SQLite does not enforce FOREIGN KEYs unless asked per connection.
    # Without this, CASCADE / SET NULL / RESTRICT silently no-op in dev and
    # tests while PostgreSQL enforces them — a dangerous semantic split
    # (orphan guardian_links, dangling decided_by, etc.).
    @event.listens_for(engine, "connect")
    def _sqlite_fk_on(dbapi_conn, _record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

class Base(DeclarativeBase):
    pass

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def escape_like(raw: str, limit: int = 128) -> str:
    """Cap user search input and escape LIKE wildcards so `%`/`_` are literal."""
    q = (raw or "")[:limit]
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
