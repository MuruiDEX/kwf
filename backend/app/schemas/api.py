from __future__ import annotations
from datetime import date
from pydantic import BaseModel, Field, field_validator

class TournamentIn(BaseModel):
    name: str = Field(min_length=3, max_length=255)
    city: str = ""
    country: str = ""
    organization: str = "KWF"
    start_date: date
    status: str = "upcoming"
    type: str = "championship"
    tatami_count: int = Field(default=2, ge=1, le=12)

    @field_validator("status")
    @classmethod
    def _create_status(cls, v: str) -> str:
        # Lifecycle guards live in POST /{tid}/status; creating a tournament
        # directly as live/finished would bypass them.
        if v not in ("upcoming", "registration"):
            raise ValueError("New tournaments start as upcoming or registration")
        return v

class CategoryIn(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    gender: str = Field(default="male", pattern="^(male|female)$")
    age_min: int = Field(default=18, ge=4, le=99)
    age_max: int = Field(default=99, ge=4, le=99)
    weight_min: float = Field(default=0, ge=0, le=500)
    weight_max: float = Field(default=500, ge=0, le=500)
    level: str = "open"
    fight_duration_sec: int = Field(default=180, ge=30, le=900)

    @field_validator("age_max")
    @classmethod
    def _age_order(cls, v: int, info) -> int:
        # P1: an inverted range would make every weigh-in "over/under" and
        # confuse autofix — reject at the boundary with a clear 422.
        if info.data.get("age_min") is not None and v < info.data["age_min"]:
            raise ValueError("age_max must be >= age_min")
        return v

    @field_validator("weight_max")
    @classmethod
    def _weight_order(cls, v: float, info) -> float:
        if info.data.get("weight_min") is not None and v < info.data["weight_min"]:
            raise ValueError("weight_max must be >= weight_min")
        return v

class RegistrationIn(BaseModel):
    athlete_id: int = Field(gt=0)
    category_id: int = Field(gt=0)

class WeighIn(BaseModel):
    weigh_in_kg: float = Field(ge=20, le=250)

class CheckIn(BaseModel):
    checked_in: bool = True

class StatusChange(BaseModel):
    status: str = Field(pattern="^(upcoming|registration|live|finished)$")

class FinishFight(BaseModel):
    winner_id: int
    score_a: int = Field(default=0, ge=0, le=99)
    score_b: int = Field(default=0, ge=0, le=99)

class TimerIn(BaseModel):
    action: str = Field(pattern="^(start|pause|reset)$")
    duration_sec: int = Field(default=180, ge=30, le=600)

class AthleteIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=128)
    last_name: str = Field(min_length=1, max_length=128)
    gender: str = Field(default="male", pattern="^(male|female)$")
    birth_year: int = Field(ge=1920, le=2030)
    weight_kg: float = Field(default=0, ge=0, le=500)
    level: str = "novice"
    country: str = ""
    club_id: int | None = None

class ClubIn(BaseModel):
    name: str = Field(min_length=2, max_length=255)
    country: str = ""
    city: str = ""
    coach_name: str = ""

class NewsIn(BaseModel):
    title: str = Field(min_length=3, max_length=255)
    # URL slug: letters (incl. RU/KK for existing editor output), digits, hyphen.
    # Dots/slashes/spaces rejected so slugs can't confuse the /news/{slug} route.
    slug: str = Field(min_length=2, max_length=128, pattern=r"^[\w][\w-]*$")
    excerpt: str = ""
    body: str = ""
    category: str = "events"
