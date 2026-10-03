"""B1: public age/weight bands derived from category bounds.

Exact birth_year / weight_kg never leave the backend in public responses.
The display strings below are computed server-side from the athlete's
latest relevant PUBLIC registration:

- only status == "approved" counts (pending/rejected/withdrawn are not
  public sporting facts);
- newest tournament first (start_date DESC, id DESC tiebreak);
- no approved regs (or category gone) -> ("—", "—"), never guess.

No migration, no new columns: TournamentCategory bounds are the source.
"""
from __future__ import annotations
from sqlalchemy.orm import Session
from app.models.competition import Registration
from app.models.tournament import Tournament, TournamentCategory

DASH = "—"


def _num(x) -> str:
    if x is None:
        return "?"
    f = float(x)
    return str(int(f)) if f.is_integer() else str(f)


def format_age_group(age_min, age_max) -> str:
    """U-group label from category age bounds (public metadata)."""
    try:
        lo, hi = int(age_min), int(age_max)
    except (TypeError, ValueError):
        return DASH
    if hi < 99:
        return f"U{hi}"
    if lo >= 18:
        return "18+"
    return "OPEN"


def format_weight_class(wmin, wmax) -> str:
    """Weight-class label from category weight bounds (public metadata)."""
    if wmin is None or wmax is None:
        return DASH
    return f"{_num(wmin)}-{_num(wmax)} кг"


def bands_for_category(cat: TournamentCategory | None) -> tuple[str, str]:
    if cat is None:
        return DASH, DASH
    return format_age_group(cat.age_min, cat.age_max), format_weight_class(cat.weight_min, cat.weight_max)


def latest_public_category(db: Session, athlete_id: int) -> TournamentCategory | None:
    """Newest approved registration's category (tournament start_date DESC,
    registration id DESC). None when there is no relevant public reg."""
    row = (db.query(TournamentCategory)
           .join(Registration, Registration.category_id == TournamentCategory.id)
           .join(Tournament, Registration.tournament_id == Tournament.id)
           .filter(Registration.athlete_id == athlete_id,
                   Registration.status == "approved")
           .order_by(Tournament.start_date.desc(), Registration.id.desc())
           .first())
    return row


def latest_public_categories_bulk(db: Session, athlete_ids: list[int]) -> dict[int, TournamentCategory | None]:
    """Batched variant (no N+1): first row per athlete wins under the same
    ordering as latest_public_category."""
    out: dict[int, TournamentCategory | None] = {aid: None for aid in athlete_ids}
    if not athlete_ids:
        return out
    rows = (db.query(Registration.athlete_id, TournamentCategory)
            .join(TournamentCategory, Registration.category_id == TournamentCategory.id)
            .join(Tournament, Registration.tournament_id == Tournament.id)
            .filter(Registration.athlete_id.in_(athlete_ids),
                    Registration.status == "approved")
            .order_by(Tournament.start_date.desc(), Registration.id.desc())
            .all())
    for aid, cat in rows:
        if out.get(aid) is None:
            out[aid] = cat
    return out


def public_bands(db: Session, athlete_id: int) -> tuple[str, str]:
    return bands_for_category(latest_public_category(db, athlete_id))
