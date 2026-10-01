"""Registration business rules (moved out of the endpoint thin layer)."""
from __future__ import annotations
from datetime import datetime
from app.models.club_athlete import Athlete
from app.models.tournament import TournamentCategory


def eligibility_warnings(a: Athlete, c: TournamentCategory) -> list[str]:
    """Warnings, not a hard block: organizers decide (strict mode is a P2 option)."""
    warnings: list[str] = []
    age = datetime.now().year - a.birth_year
    if not (c.age_min <= age <= c.age_max):
        warnings.append(f"Age {age} outside {c.age_min}-{c.age_max}")
    if not (c.weight_min <= (a.weight_kg or 0) <= c.weight_max):
        warnings.append(f"Weight {a.weight_kg}kg outside {c.weight_min}-{c.weight_max}kg")
    if a.gender != c.gender:
        warnings.append("Gender mismatch")
    return warnings
