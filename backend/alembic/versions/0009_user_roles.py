"""Multi-role: user_roles association + backfill from primary role.

Idempotent: table created only when missing; backfill inserts only roles
absent for each user (safe re-run, preserves manually added secondaries).
No data rewritten otherwise.

Revision ID: 0009_user_roles
Revises: 0008_athlete_user_link
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0009_user_roles"
down_revision: str | None = "0008_athlete_user_link"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "user_roles" not in insp.get_table_names():
        op.create_table(
            "user_roles",
            sa.Column("id", sa.Integer, primary_key=True),
            sa.Column("user_id", sa.Integer, sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
            sa.Column("role", sa.String(32), nullable=False, index=True),
            sa.Column("granted_by", sa.Integer, sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.UniqueConstraint("user_id", "role", name="uq_user_role"),
        )
    # Backfill: every existing primary role becomes a set member. NOT EXISTS
    # keeps manually added secondaries and makes re-runs no-ops.
    op.execute(sa.text(
        "INSERT INTO user_roles (user_id, role) "
        "SELECT u.id, u.role FROM users u "
        "WHERE NOT EXISTS (SELECT 1 FROM user_roles r "
        "WHERE r.user_id = u.id AND r.role = u.role)"
    ))


def downgrade() -> None:
    op.drop_table("user_roles")
