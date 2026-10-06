"""Shared isolated test database: ONE engine for all test modules.

Background: each module previously created its own in-memory engine while
`app.dependency_overrides` is global (last import wins), so API calls and
direct-DB setup could hit different databases. Single source of truth here.
"""
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.core.db as dbmod
from app.main import app

engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)


@event.listens_for(engine, "connect")
def _sqlite_fk_on(dbapi_conn, _record):
    # Same as app/core/db.py: enforce FKs (CASCADE / SET NULL) on sqlite so
    # tests observe production (PostgreSQL) semantics.
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestSession = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

def override_db():
    s = TestSession()
    try:
        yield s
    finally:
        s.close()

app.dependency_overrides[dbmod.get_db] = override_db
dbmod.Base.metadata.create_all(bind=engine)
client = TestClient(app)
