from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, Index, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base

class Registration(Base):
    __tablename__ = "registrations"
    __table_args__ = (UniqueConstraint("tournament_id", "athlete_id", "category_id", name="uq_reg"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    athlete_id: Mapped[int] = mapped_column(ForeignKey("athletes.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("tournament_categories.id", ondelete="CASCADE"), index=True)
    seed: Mapped[int | None] = mapped_column(Integer, nullable=True)
    checked_in: Mapped[bool] = mapped_column(default=False)
    weigh_in_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
    weigh_in_status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|ok|over|under
    # Wave 3: moderation workflow (default approved = previous auto-accept).
    status: Mapped[str] = mapped_column(String(16), default="approved")  # pending|approved|rejected|withdrawn
    review_note: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class Tatami(Base):
    __tablename__ = "tatamis"
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64))  # Tatami 1
    referee_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

class Bracket(Base):
    __tablename__ = "brackets"
    __table_args__ = (UniqueConstraint("tournament_id", "category_id", name="uq_bracket_tournament_category"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("tournament_categories.id", ondelete="CASCADE"), index=True)
    size: Mapped[int] = mapped_column(Integer)  # 4|8|16|32|64|128
    format: Mapped[str] = mapped_column(String(32), default="single_elimination")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

class BracketMatch(Base):
    __tablename__ = "bracket_matches"
    __table_args__ = (
        Index("ix_bracket_round_pos", "bracket_id", "round_no", "position"),
        Index("ix_bracket_status", "bracket_id", "status"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    bracket_id: Mapped[int] = mapped_column(ForeignKey("brackets.id", ondelete="CASCADE"), index=True)
    round_no: Mapped[int] = mapped_column(Integer, index=True)  # 1 = first round
    position: Mapped[int] = mapped_column(Integer)  # position within round
    athlete_a_id: Mapped[int | None] = mapped_column(ForeignKey("athletes.id", ondelete="SET NULL"), nullable=True, index=True)
    athlete_b_id: Mapped[int | None] = mapped_column(ForeignKey("athletes.id", ondelete="SET NULL"), nullable=True, index=True)
    winner_id: Mapped[int | None] = mapped_column(ForeignKey("athletes.id", ondelete="SET NULL"), nullable=True, index=True)
    score_a: Mapped[int] = mapped_column(Integer, default=0)
    score_b: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="scheduled", index=True)  # scheduled|live|finished|bye
    tatami_id: Mapped[int | None] = mapped_column(ForeignKey("tatamis.id", ondelete="SET NULL"), nullable=True, index=True)
    order_in_tatami: Mapped[int] = mapped_column(Integer, default=0)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    next_match_id: Mapped[int | None] = mapped_column(ForeignKey("bracket_matches.id", ondelete="SET NULL"), nullable=True, index=True)
