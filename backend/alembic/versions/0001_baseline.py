"""Baseline: current schema exactly as Base.metadata (no data changes).

Safe on existing databases: create_all(checkfirst=True) only adds missing
tables/indexes, never alters or drops. Replaces the old lifespan create_all
and the ad-hoc migrate_p1.py flow (whose columns are covered by 0002).

Revision ID: 0001_baseline
Revises:
"""
from __future__ import annotations
from alembic import op
import app.models.user, app.models.club_athlete, app.models.tournament  # noqa: F401
import app.models.competition, app.models.misc  # noqa: F401
from app.core.db import Base

revision: str = "0001_baseline"
down_revision: str | None = None
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    Base.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade() -> None:
    pass  # baseline is not reversible by design; restore from backup instead.
