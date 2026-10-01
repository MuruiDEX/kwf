from __future__ import annotations
from datetime import datetime, date
from sqlalchemy import String, Integer, Float, Date, DateTime, ForeignKey, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base

class Tournament(Base):
    __tablename__ = "tournaments"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    city: Mapped[str] = mapped_column(String(128), default="", index=True)
    country: Mapped[str] = mapped_column(String(64), default="", index=True)
    organization: Mapped[str] = mapped_column(String(128), default="KWF")
    start_date: Mapped[date] = mapped_column(Date, index=True)
    status: Mapped[str] = mapped_column(String(32), default="upcoming", index=True)  # upcoming|registration|live|finished
    type: Mapped[str] = mapped_column(String(64), default="championship")
    tatami_count: Mapped[int] = mapped_column(Integer, default=2)
    strict_eligibility: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    categories: Mapped[list["TournamentCategory"]] = relationship(back_populates="tournament", cascade="all, delete-orphan")

class TournamentCategory(Base):
    __tablename__ = "tournament_categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    tournament_id: Mapped[int] = mapped_column(ForeignKey("tournaments.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))  # e.g. Men -70kg
    gender: Mapped[str] = mapped_column(String(16), default="male")
    age_min: Mapped[int] = mapped_column(Integer, default=18)
    age_max: Mapped[int] = mapped_column(Integer, default=99)
    weight_min: Mapped[float] = mapped_column(Float, default=0)
    weight_max: Mapped[float] = mapped_column(Float, default=999)
    level: Mapped[str] = mapped_column(String(32), default="open")
    fight_duration_sec: Mapped[int] = mapped_column(Integer, default=180)
    tournament: Mapped["Tournament"] = relationship(back_populates="categories")
