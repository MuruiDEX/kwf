from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase
from app.core.config import settings

connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}

engine = create_engine(settings.database_url, connect_args=connect_args, future=True)
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
