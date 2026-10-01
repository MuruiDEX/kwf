from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Float, ForeignKey, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.db import Base

class Club(Base):
    __tablename__ = "clubs"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    country: Mapped[str] = mapped_column(String(64), default="", index=True)
    city: Mapped[str] = mapped_column(String(128), default="")
    coach_name: Mapped[str] = mapped_column(String(255), default="")
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
    points: Mapped[int] = mapped_column(Integer, default=0, index=True)  # ranking points cache
    wins: Mapped[int] = mapped_column(Integer, default=0)
    losses: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    club: Mapped["Club | None"] = relationship(back_populates="athletes")

    @property
    def full_name(self) -> str:
        return f"{self.first_name} {self.last_name}"
