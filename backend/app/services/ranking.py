"""Configurable ranking: points for win / medals."""
from __future__ import annotations
from sqlalchemy import or_
from sqlalchemy.orm import Session
from app.models.club_athlete import Athlete
from app.models.competition import BracketMatch

POINTS = {"win": 3, "champion": 10, "finalist": 6, "semifinalist": 3}

def recalc_athlete(db: Session, athlete_id: int, points_cfg: dict = POINTS) -> Athlete:
    a = db.get(Athlete, athlete_id)
    if not a:
        raise ValueError("Athlete not found")
    wins = db.query(BracketMatch).filter_by(winner_id=athlete_id, status="finished").count()
    participated = db.query(BracketMatch).filter(
        BracketMatch.status == "finished",
        or_(BracketMatch.athlete_a_id == athlete_id, BracketMatch.athlete_b_id == athlete_id)).count()
    titles = db.query(BracketMatch).filter_by(winner_id=athlete_id, status="finished", next_match_id=None).count()
    a.wins = wins
    a.losses = max(participated - wins, 0)
    a.points = wins * points_cfg["win"] + titles * points_cfg["champion"]
    # P0: flush only — the caller commits once, so bracket advancement and
    # ranking points land in a single transaction (no more commit-per-fighter).
    db.flush()
    return a

def recalc_match_participants(db: Session, match: BracketMatch, *, commit: bool = False) -> None:
    """Auto-update ranking for both fighters after a fight is finished."""
    for aid in {match.athlete_a_id, match.athlete_b_id} - {None}:
        recalc_athlete(db, aid)
    if commit:
        db.commit()
