from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, ForeignKey, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base

# C1: guardian relationship core. A GuardianLink is a relationship between a
# guardian user and an athlete (M:N: one guardian -> many athletes, one
# athlete -> many guardians). Statuses are set server-side only; no CHECK
# constraint (consistent with other status columns in this codebase).
# The link itself grants ZERO athlete-data access in C1 — even `approved`
# authorizes nothing until C2 wires explicit read scope.
GUARDIAN_STATUSES: tuple[str, ...] = ("pending", "approved", "rejected", "revoked")


class GuardianLink(Base):
    __tablename__ = "guardian_links"
    __table_args__ = (
        UniqueConstraint("guardian_user_id", "athlete_id", name="uq_guardian_athlete"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    guardian_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True)
    athlete_id: Mapped[int] = mapped_column(
        ForeignKey("athletes.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, default=None)
    decided_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None)
