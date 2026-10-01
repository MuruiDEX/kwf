"""RBAC grants table: per-user extra permissions (admin-managed).

Idempotent: table + constraints are created only when missing.
No data rewritten.
Revision ID: 0004_rbac_grants
Revises: 0003_p1_indexes
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0004_rbac_grants"
down_revision: str | None = "0003_p1_indexes"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "user_permissions" not in insp.get_table_names():
        op.create_table(
            "user_permissions",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("permission", sa.String(64), nullable=False, index=True),
            sa.Column("granted_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("user_id", "permission", name="uq_user_permission"),
        )


def downgrade() -> None:
    op.drop_table("user_permissions")
