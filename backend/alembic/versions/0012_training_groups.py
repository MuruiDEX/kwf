"""Training groups D2 P2 (coach squads + M:N membership).

Idempotent: tables + indexes created only when missing. No data rewritten.

Revision ID: 0012_training_groups
Revises: 0011_guardian_links
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0012_training_groups"
down_revision: str | None = "0011_guardian_links"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = insp.get_table_names()
    if "training_groups" not in tables:
        op.create_table(
            "training_groups",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("club_id", sa.Integer,
                      sa.ForeignKey("clubs.id", ondelete="CASCADE"),
                      nullable=False, index=True),
            sa.Column("name", sa.String(128), nullable=False, index=True),
            sa.Column("level", sa.String(32), nullable=False, server_default=""),
            sa.Column("age_min", sa.Integer, nullable=True),
            sa.Column("age_max", sa.Integer, nullable=True),
            sa.Column("is_active", sa.Boolean, nullable=False,
                      server_default=sa.true(), index=True),
            sa.Column("created_by", sa.Integer,
                      sa.ForeignKey("users.id", ondelete="SET NULL"),
                      nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now()),
        )
    if "training_group_members" not in tables:
        op.create_table(
            "training_group_members",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("group_id", sa.Integer,
                      sa.ForeignKey("training_groups.id", ondelete="CASCADE"),
                      nullable=False, index=True),
            sa.Column("athlete_id", sa.Integer,
                      sa.ForeignKey("athletes.id", ondelete="CASCADE"),
                      nullable=False, index=True),
            sa.Column("added_by", sa.Integer,
                      sa.ForeignKey("users.id", ondelete="SET NULL"),
                      nullable=True),
            sa.Column("added_at", sa.DateTime(timezone=True),
                      server_default=sa.func.now()),
            sa.UniqueConstraint("group_id", "athlete_id",
                                name="uq_group_member"),
        )
    idx = {i["name"] for i in insp.get_indexes("training_groups")} \
        if "training_groups" in insp.get_table_names() else set()
    if "ix_training_groups_club" not in idx and "training_groups" in insp.get_table_names():
        op.create_index("ix_training_groups_club", "training_groups", ["club_id"])
    if "ix_training_groups_active" not in idx and "training_groups" in insp.get_table_names():
        op.create_index("ix_training_groups_active", "training_groups", ["is_active"])
    midx = {i["name"] for i in insp.get_indexes("training_group_members")} \
        if "training_group_members" in insp.get_table_names() else set()
    if "ix_group_members_group" not in midx and "training_group_members" in insp.get_table_names():
        op.create_index("ix_group_members_group", "training_group_members", ["group_id"])
    if "ix_group_members_athlete" not in midx and "training_group_members" in insp.get_table_names():
        op.create_index("ix_group_members_athlete", "training_group_members", ["athlete_id"])


def downgrade() -> None:
    op.drop_table("training_group_members")
    op.drop_table("training_groups")
