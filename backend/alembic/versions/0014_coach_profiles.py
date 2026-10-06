"""Coach 2.0 P1: coach_profiles + club description/logo.

Idempotent: table/columns/indexes created only when missing. Nullable-first,
no backfill, existing rows untouched.

Revision ID: 0014_coach_profiles
Revises: 0013_session_group_link
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0014_coach_profiles"
down_revision: str | None = "0013_session_group_link"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "coach_profiles" not in tables:
        op.create_table(
            "coach_profiles",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("user_id", sa.Integer,
                      sa.ForeignKey("users.id", ondelete="CASCADE"),
                      nullable=False, unique=True, index=True),
            sa.Column("bio", sa.Text, nullable=False, server_default=""),
            sa.Column("city", sa.String(128), nullable=False, server_default=""),
            sa.Column("country", sa.String(64), nullable=False, server_default=""),
            sa.Column("specialization", sa.String(128), nullable=False, server_default=""),
            sa.Column("experience_years", sa.Integer, nullable=True),
            sa.Column("avatar_path", sa.String(255), nullable=True),
            sa.Column("is_public", sa.Boolean, nullable=False,
                      server_default=sa.false(), index=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now()),
        )
    idx = {i["name"] for i in insp.get_indexes("coach_profiles")} \
        if "coach_profiles" in insp.get_table_names() else set()
    if "ix_coach_profiles_public" not in idx and \
            "coach_profiles" in insp.get_table_names():
        op.create_index("ix_coach_profiles_public", "coach_profiles",
                        ["is_public"])
    if "clubs" in tables:
        cols = {c["name"] for c in insp.get_columns("clubs")}
        if "description" not in cols:
            op.add_column("clubs", sa.Column("description", sa.Text(),
                                             nullable=False, server_default=""))
        if "logo_path" not in cols:
            op.add_column("clubs", sa.Column("logo_path", sa.String(255),
                                             nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "clubs" in insp.get_table_names():
        cols = {c["name"] for c in insp.get_columns("clubs")}
        if "logo_path" in cols:
            op.drop_column("clubs", "logo_path")
        if "description" in cols:
            op.drop_column("clubs", "description")
    idx = {i["name"] for i in insp.get_indexes("coach_profiles")} \
        if "coach_profiles" in insp.get_table_names() else set()
    if "ix_coach_profiles_public" in idx:
        op.drop_index("ix_coach_profiles_public", table_name="coach_profiles")
    if "coach_profiles" in insp.get_table_names():
        op.drop_table("coach_profiles")
