"""P0: one bracket per (tournament, category) — prevents concurrent
regeneration from silently duplicating brackets (last-writer-wins data loss).

Idempotent: constraint is created only when missing. No data rewritten;
pre-existing duplicates (should not exist — generation deletes old first)
would fail the upgrade loudly instead of corrupting silently.

Revision ID: 0005_p0_bracket_unique
Revises: 0004_rbac_grants
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0005_p0_bracket_unique"
down_revision: str | None = "0004_rbac_grants"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = {c["name"] for c in insp.get_unique_constraints("brackets")}
    if "uq_bracket_tournament_category" not in existing:
        if bind.dialect.name == "sqlite":
            # Wave 8: SQLite has no ALTER ... ADD CONSTRAINT. Batch mode
            # recreates the table (copy-and-move, data preserved) instead.
            # PostgreSQL keeps the plain ALTER (valid there).
            with op.batch_alter_table("brackets") as batch:
                batch.create_unique_constraint(
                    "uq_bracket_tournament_category", ["tournament_id", "category_id"]
                )
        else:
            op.create_unique_constraint(
                "uq_bracket_tournament_category", "brackets", ["tournament_id", "category_id"]
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("brackets") as batch:
            batch.drop_constraint("uq_bracket_tournament_category", type_="unique")
    else:
        op.drop_constraint("uq_bracket_tournament_category", "brackets", type_="unique")
