"""Guardian links C1 (guardian relationship core): relationship table only.

Idempotent: table + indexes created only when missing. No data rewritten.
Grants no access by itself — authorization is wired in C2.

Revision ID: 0011_guardian_links
Revises: 0010_training_sessions
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0011_guardian_links"
down_revision: str | None = "0010_training_sessions"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "guardian_links" not in insp.get_table_names():
        op.create_table(
            "guardian_links",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("guardian_user_id", sa.Integer,
                      sa.ForeignKey("users.id", ondelete="CASCADE"),
                      nullable=False, index=True),
            sa.Column("athlete_id", sa.Integer,
                      sa.ForeignKey("athletes.id", ondelete="CASCADE"),
                      nullable=False, index=True),
            sa.Column("status", sa.String(16), nullable=False,
                      server_default="pending", index=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now()),
            sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("decided_by", sa.Integer,
                      sa.ForeignKey("users.id", ondelete="SET NULL"),
                      nullable=True),
            sa.UniqueConstraint("guardian_user_id", "athlete_id",
                                name="uq_guardian_athlete"),
        )
    idx = {i["name"] for i in insp.get_indexes("guardian_links")} \
        if "guardian_links" in insp.get_table_names() else set()
    if "ix_guardian_links_guardian" not in idx:
        op.create_index("ix_guardian_links_guardian", "guardian_links",
                        ["guardian_user_id"])
    if "ix_guardian_links_athlete" not in idx:
        op.create_index("ix_guardian_links_athlete", "guardian_links",
                        ["athlete_id"])
    if "ix_guardian_links_status" not in idx:
        op.create_index("ix_guardian_links_status", "guardian_links",
                        ["status"])


def downgrade() -> None:
    op.drop_table("guardian_links")
