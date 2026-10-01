"""Minimal notifications (§25): only conflicts, weigh-in issues, published results."""
from __future__ import annotations
from sqlalchemy.orm import Session
from app.models.tournament import Tournament
from app.models.competition import Registration
from app.models.misc import Notification
from app.services.schedule import detect_conflicts

def _owner_id(db: Session, tournament_id: int) -> int | None:
    t = db.get(Tournament, tournament_id)
    return t.created_by if t else None

def sync_conflict_notifications(db: Session, tournament_id: int, lang: str = "ru") -> int:
    """Create one notification per schedule conflict for the organizer. Returns count."""
    owner = _owner_id(db, tournament_id)
    if not owner:
        return 0
    conflicts = detect_conflicts(db, tournament_id, lang=lang)
    n = 0
    for c in conflicts:
        kk = lang.lower().startswith("kk")
        msg = (f"Кесте қайшылығы: {c['message']} {c['suggestion']}" if kk
               else f"Конфликт расписания: {c['message']} {c['suggestion']}")
        exists = db.query(Notification).filter_by(user_id=owner, type="conflict", message=msg, is_read=False).first()
        if not exists:
            db.add(Notification(user_id=owner, type="conflict", message=msg,
                                link=f"/tournaments/{tournament_id}?tab=schedule"))
            n += 1
    db.commit()
    return n

def sync_weighin_notifications(db: Session, tournament_id: int, lang: str = "ru") -> int:
    owner = _owner_id(db, tournament_id)
    if not owner:
        return 0
    kk = lang.lower().startswith("kk")
    bad = db.query(Registration).filter_by(tournament_id=tournament_id).filter(
        Registration.weigh_in_status.in_(["over", "under"])).all()
    n = 0
    for r in bad:
        msg = (f"Салмақ мәселесі: №{r.athlete_id} қатысушы — {r.weigh_in_status} ({r.weigh_in_kg} кг)" if kk
               else f"Проблема взвешивания: участник #{r.athlete_id} — {r.weigh_in_status} ({r.weigh_in_kg} кг)")
        exists = db.query(Notification).filter_by(user_id=owner, type="weighin", message=msg, is_read=False).first()
        if not exists:
            db.add(Notification(user_id=owner, type="weighin", message=msg,
                                link=f"/tournaments/{tournament_id}?tab=weighin"))
            n += 1
    db.commit()
    return n
