from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, ForeignKey, DateTime, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base


class TrainingGroup(Base):
    """Coach training squad within one club (D2 P2).

    Managed by the club owner (or admin) only — organizer's `athletes.manage`
    alone does not manage groups. Archived groups stay readable but frozen.
    """
    __tablename__ = "training_groups"
    id: Mapped[int] = mapped_column(primary_key=True)
    club_id: Mapped[int] = mapped_column(
        ForeignKey("clubs.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128), index=True)
    level: Mapped[str] = mapped_column(String(32), default="")
    age_min: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    age_max: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())


class TrainingGroupMember(Base):
    """M:N athlete <-> group membership (D2 P2).

    An athlete may belong to several squads; the pair is unique. Both FKs
    CASCADE (athlete/group deleted -> membership gone); adder is provenance.
    """
    __tablename__ = "training_group_members"
    __table_args__ = (
        UniqueConstraint("group_id", "athlete_id", name="uq_group_member"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    group_id: Mapped[int] = mapped_column(
        ForeignKey("training_groups.id", ondelete="CASCADE"), index=True)
    athlete_id: Mapped[int] = mapped_column(
        ForeignKey("athletes.id", ondelete="CASCADE"), index=True)
    added_by: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, default=None)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
