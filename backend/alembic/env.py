"""Alembic env: single source of truth is app.models metadata + settings.DATABASE_URL."""
from __future__ import annotations
from alembic import context
from app.core.config import settings
from app.core.db import Base
import app.models.user, app.models.club_athlete, app.models.tournament  # noqa: F401
import app.models.competition, app.models.misc  # noqa: F401

config = context.config
# An explicitly provided URL (tests, ops overrides) wins over settings.
if not config.get_main_option("sqlalchemy.url"):
    config.set_main_option("sqlalchemy.url", settings.database_url)
target_metadata = Base.metadata


def _url() -> str:
    return config.get_main_option("sqlalchemy.url")


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata,
                      literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    from sqlalchemy import create_engine

    url = _url()
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args, future=True)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
