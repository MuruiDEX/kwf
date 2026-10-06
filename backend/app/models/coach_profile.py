from __future__ import annotations
from datetime import datetime
from sqlalchemy import String, Integer, Boolean, ForeignKey, DateTime, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.db import Base


class CoachProfile(Base):
    """Optional public-facing coach profile (Coach 2.0 P1).

    One row per user at most (user_id UNIQUE); identity (name) stays on
    User.full_name — this table holds profile-only content. Rows are created
    lazily on first self read/edit, never for unrelated users. No social,
    payment, or verification fields (is_active on User is NOT verification).
    """
    __tablename__ = "coach_profiles"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    bio: Mapped[str] = mapped_column(Text, default="")
    city: Mapped[str] = mapped_column(String(128), default="")
    country: Mapped[str] = mapped_column(String(64), default="")
    specialization: Mapped[str] = mapped_column(String(128), default="")
    experience_years: Mapped[int | None] = mapped_column(Integer, nullable=True, default=None)
    avatar_path: Mapped[str | None] = mapped_column(String(255), nullable=True, default=None)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
