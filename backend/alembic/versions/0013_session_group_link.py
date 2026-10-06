"""Training schedule group link D2 P3: nullable TrainingSession.group_id.

Idempotent: column + index created only when missing. No backfill — all
existing sessions stay club-wide (NULL), which remains valid. No data rewritten.

Revision ID: 0013_session_group_link
Revises: 0012_training_groups
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0013_session_group_link"
down_revision: str | None = "0012_training_groups"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("training_sessions")} \
        if "training_sessions" in insp.get_table_names() else set()
    if "training_sessions" in insp.get_table_names() and "group_id" not in cols:
        op.add_column("training_sessions", sa.Column(
            "group_id", sa.Integer(),
            sa.ForeignKey("training_groups.id", ondelete="SET NULL"),
            nullable=True))
    idx = {i["name"] for i in insp.get_indexes("training_sessions")} \
        if "training_sessions" in insp.get_table_names() else set()
    if "ix_training_sessions_group_id" not in idx and \
            "training_sessions" in insp.get_table_names():
        op.create_index("ix_training_sessions_group_id", "training_sessions",
                        ["group_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    idx = {i["name"] for i in insp.get_indexes("training_sessions")} \
        if "training_sessions" in insp.get_table_names() else set()
    if "ix_training_sessions_group_id" in idx:
        op.drop_index("ix_training_sessions_group_id", table_name="training_sessions")
    cols = {c["name"] for c in insp.get_columns("training_sessions")} \
        if "training_sessions" in insp.get_table_names() else set()
    if "group_id" in cols:
        op.drop_column("training_sessions", "group_id")
