"""P1 query indexes (all confirmed by real access paths: bracket ordering,
status filters, FK lookups in batched queries).

Idempotent: each index is created only when missing. No data rewritten.

Revision ID: 0003_p1_indexes
Revises: 0002_p1_columns
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0003_p1_indexes"
down_revision: str | None = "0002_p1_columns"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

INDEXES: list[tuple[str, str, list[str]]] = [
    ("ix_bracket_round_pos", "bracket_matches", ["bracket_id", "round_no", "position"]),
    ("ix_bracket_status", "bracket_matches", ["bracket_id", "status"]),
    ("ix_athletes_club_id", "athletes", ["club_id"]),
    ("ix_tournaments_created_by", "tournaments", ["created_by"]),
    ("ix_tatamis_referee_id", "tatamis", ["referee_id"]),
    ("ix_audit_log_actor_id", "audit_log", ["actor_id"]),
    ("ix_documents_athlete_id", "documents", ["athlete_id"]),
    ("ix_documents_tournament_id", "documents", ["tournament_id"]),
]


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for name, table, columns in INDEXES:
        existing = {i["name"] for i in insp.get_indexes(table)}
        if name in existing:
            continue
        op.create_index(name, table, columns)


def downgrade() -> None:
    for name, table, _columns in INDEXES:
        op.drop_index(name, table_name=table)
