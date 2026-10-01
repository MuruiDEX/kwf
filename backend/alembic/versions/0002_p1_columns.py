"""P1 ownership columns (ports migrate_p1.py): clubs.owner_id,
athletes.created_by, tournaments.strict_eligibility.

Idempotent: each ADD COLUMN runs only when the column is missing, so upgrade
head on a database migrated by the old script is a no-op. New columns are
nullable/with default — old rows keep working, no data rewritten.

Revision ID: 0002_p1_columns
Revises: 0001_baseline
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0002_p1_columns"
down_revision: str | None = "0001_baseline"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

COLUMNS: list[tuple[str, str, sa.types.TypeEngine, str | None]] = [
    ("clubs", "owner_id", sa.Integer(), None),
    ("athletes", "created_by", sa.Integer(), None),
    ("tournaments", "strict_eligibility", sa.Boolean(), "0"),
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for table, column, coltype, server_default in COLUMNS:
        existing = {c["name"] for c in insp.get_columns(table)}
        if column in existing:
            continue
        op.add_column(table, sa.Column(column, coltype, nullable=True, server_default=server_default))


def downgrade() -> None:
    for table, column, *_ in COLUMNS:
        with op.batch_alter_table(table) as batch:
            batch.drop_column(column)
