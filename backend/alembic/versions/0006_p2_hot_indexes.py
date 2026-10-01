"""P2: hot-path indexes for ranking/schedule/profile lookups.

All confirmed by real access paths:
- bracket_matches.athlete_a/b/winner_id: ranking recalc, results, club titles
- bracket_matches.tatami_id/scheduled_at: schedule ordering + live queue
- bracket_matches.next_match_id: bracket traversal (placement, finish propagation)
- athletes.created_by: athlete scope checks + mine= filters
- news.author_id: FK lookup

Idempotent: each index is created only when missing. No data rewritten.

Revision ID: 0006_p2_hot_indexes
Revises: 0005_p0_bracket_unique
"""
from __future__ import annotations
from alembic import op
import sqlalchemy as sa

revision: str = "0006_p2_hot_indexes"
down_revision: str | None = "0005_p0_bracket_unique"
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None

INDEXES: list[tuple[str, str, list[str]]] = [
    ("ix_bracket_matches_athlete_a_id", "bracket_matches", ["athlete_a_id"]),
    ("ix_bracket_matches_athlete_b_id", "bracket_matches", ["athlete_b_id"]),
    ("ix_bracket_matches_winner_id", "bracket_matches", ["winner_id"]),
    ("ix_bracket_matches_tatami_id", "bracket_matches", ["tatami_id"]),
    ("ix_bracket_matches_scheduled_at", "bracket_matches", ["scheduled_at"]),
    ("ix_bracket_matches_next_match_id", "bracket_matches", ["next_match_id"]),
    ("ix_athletes_created_by", "athletes", ["created_by"]),
    ("ix_news_author_id", "news", ["author_id"]),
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
