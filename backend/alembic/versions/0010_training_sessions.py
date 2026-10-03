"""Coach training sessions (club schedule): minimal lessons CRUD backing.

Idempotent: table created only when missing. No data rewritten.

Revision ID: 0010_training_sessions
Revises: 0009_user_roles
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0010_training_sessions"
down_revision: str | None = "0009_user_roles"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "training_sessions" not in insp.get_table_names():
        op.create_table(
            "training_sessions",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("club_id", sa.Integer, sa.ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("coach_id", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True),
            sa.Column("title", sa.String(255), nullable=False, default=""),
            sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False, index=True),
            sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("note", sa.String(512), nullable=False, default=""),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        )


def downgrade() -> None:
    op.drop_table("training_sessions")
