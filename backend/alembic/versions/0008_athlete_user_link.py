"""Wave 4: athlete identity link (athletes.user_id) for self-registration.

Idempotent (same style as 0002/0007): column added only when missing.
Nullable + unique (1:1 user<->athlete) — no backfill, existing rows keep
working. No data rewritten.

Revision ID: 0008_athlete_user_link
Revises: 0007_registration_status
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0008_athlete_user_link"
down_revision: str | None = "0007_registration_status"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("athletes")}
    if "user_id" not in cols:
        op.add_column("athletes",
                      sa.Column("user_id", sa.Integer(),
                                sa.ForeignKey("users.id", ondelete="SET NULL"),
                                nullable=True))
    idx = {i["name"] for i in insp.get_indexes("athletes")}
    if "ix_athletes_user_id" not in idx:
        op.create_index("ix_athletes_user_id", "athletes", ["user_id"],
                        unique=True)


def downgrade() -> None:
    op.drop_index("ix_athletes_user_id", table_name="athletes")
    with op.batch_alter_table("athletes") as batch:
        batch.drop_column("user_id")
