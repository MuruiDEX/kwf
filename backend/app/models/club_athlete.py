from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base

class Club(Base):
    __tablename__ = "clubs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    country: Mapped[str] = mapped_column(String(64), default="", index=True)
    city: Mapped[str] = mapped_column(String(128), default="")
    coach_name: Mapped[str] = mapped_column(String(255), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    logo_path: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    athletes: Mapped[list["Athlete"]] = relationship(back_populates="club")

class Athlete(Base):
    __tablename__ = "athletes"
    id: Mapped[int] = mapped_column(primary_key=True)
    first_name: Mapped[str] = mapped_column(String(128), index=True)
    last_name: Mapped[str] = mapped_column(String(128), index=True)
    gender: Mapped[str] = mapped_column(String(16), default="male", index=True)  # male|female
    birth_year: Mapped[int] = mapped_column(Integer, index=True)
    weight_kg: Mapped[float] = mapped_column(Float, default=0)
    level: Mapped[str] = mapped_column(String(32), default="novice")  # novice|advanced|elite
    country: Mapped[str] = mapped_column(String(64), default="", index=True)
    club_id: Mapped[int | None] = mapped_column(ForeignKey("clubs.id", ondelete="SET NULL"), nullable=True, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None, index=True)
    # Wave 4: identity link for athlete self-service (claim profile -> apply/withdraw).
    # Nullable + unique (1:1); existing rows keep working unlinked.
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None, unique=True, index=True)
    points: Mapped[int] = mapped_column(Integer, default=0, index=True)  # ranking points cache
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    club: Mapped["Club | None"] = relationship(back_populates="athletes")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"


class TrainingSession(Base):
    """Multi-role wave: minimal club training session (coach schedule).

    Scoped by club ownership (club.owner_id), not by role string — so a
    coach+organizer keeps full trainer functionality either way.

    D2 P3: optional link to one of the club's training groups (NULL =
    club-wide session). SET NULL so archiving/deleting a group never deletes
    planned sessions.
    """
    __tablename__ = "training_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    club_id: Mapped[int] = mapped_column(ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("training_groups.id", ondelete="SET NULL"),
        nullable=True, default=None, index=True)
    coach_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    note: Mapped[str] = mapped_column(String(512), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
