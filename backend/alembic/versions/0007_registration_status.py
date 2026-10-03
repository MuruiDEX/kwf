"""Wave 3: registration status workflow (pending/approved/rejected/withdrawn).

Idempotent (same style as 0002): columns added only when missing.
Existing rows backfill to 'approved' — previous behavior was auto-accept,
so old data and running flows keep working. No data rewritten otherwise.

Revision ID: 0007_registration_status
Revises: 0006_p2_hot_indexes
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0007_registration_status"
down_revision: str | None = "0006_p2_hot_indexes"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

COLUMNS: list[tuple[str, sa.types.TypeEngine, str | None]] = [
    ("status", sa.String(16), "approved"),
    ("review_note", sa.String(255), ""),
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = {c["name"] for c in insp.get_columns("registrations")}
    for column, coltype, server_default in COLUMNS:
        if column in existing:
            continue
        op.add_column("registrations",
                      sa.Column(column, coltype, nullable=False,
                                server_default=server_default))
    # Backfill rows created before the default existed.
    op.execute(sa.text("UPDATE registrations SET status='approved' WHERE status IS NULL OR status=''"))
    op.execute(sa.text("UPDATE registrations SET review_note='' WHERE review_note IS NULL"))


def downgrade() -> None:
    for column, *_ in COLUMNS:
        with op.batch_alter_table("registrations") as batch:
            batch.drop_column(column)
