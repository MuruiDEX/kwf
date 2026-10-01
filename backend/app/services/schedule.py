"""Schedule: round-robin matches across tatamis with rest-time conflict detection."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from sqlalchemy.orm import Session
from app.models.competition import BracketMatch, Bracket, Tatami

FIGHT_SEC = 180
BREAK_SEC = 60
MIN_REST_SEC = 5 * 60

def generate_schedule(db: Session, tournament_id: int, start: datetime, fight_sec: int = FIGHT_SEC, break_sec: int = BREAK_SEC) -> list[BracketMatch]:
    tatamis = db.query(Tatami).filter_by(tournament_id=tournament_id).order_by(Tatami.id).all()
    if not tatamis:
        for i in range(2):
            t = Tatami(tournament_id=tournament_id, name=f"Tatami {i+1}")
            db.add(t)
        db.commit()
        tatamis = db.query(Tatami).filter_by(tournament_id=tournament_id).order_by(Tatami.id).all()
    bracket_ids = [b.id for b in db.query(Bracket).filter_by(tournament_id=tournament_id).all()]
    matches = db.query(BracketMatch).filter(BracketMatch.bracket_id.in_(bracket_ids), BracketMatch.status != "bye").order_by(BracketMatch.round_no, BracketMatch.id).all() if bracket_ids else []
    cursor = {t.id: start for t in tatamis}
    counters = {t.id: 0 for t in tatamis}
    idx = 0
    for m in matches:
        t = tatamis[idx % len(tatamis)]
        m.tatami_id = t.id
        m.order_in_tatami = counters[t.id]
        m.scheduled_at = cursor[t.id]
        cursor[t.id] = cursor[t.id] + timedelta(seconds=fight_sec + break_sec)
        counters[t.id] += 1
        idx += 1
    db.commit()
    return matches

def detect_conflicts(db: Session, tournament_id: int, min_rest_sec: int = MIN_REST_SEC, lang: str = "ru") -> list[dict]:
    kk = lang.lower().startswith("kk")
    bracket_ids = [b.id for b in db.query(Bracket).filter_by(tournament_id=tournament_id).all()]
    if not bracket_ids:
        return []
    matches = db.query(BracketMatch).filter(BracketMatch.bracket_id.in_(bracket_ids), BracketMatch.scheduled_at.isnot(None)).order_by(BracketMatch.scheduled_at).all()
    last_seen: dict[int, datetime] = {}
    conflicts: list[dict] = []
    for m in matches:
        for aid in (m.athlete_a_id, m.athlete_b_id):
            if aid is None:
                continue
            prev = last_seen.get(aid)
            if prev and m.scheduled_at and (m.scheduled_at - prev).total_seconds() < min_rest_sec:
                gap = int((m.scheduled_at - prev).total_seconds() // 60)
                conflicts.append({
                    "type": "short_rest",
                    "athlete_id": aid,
                    "match_id": m.id,
                    "gap_min": gap,
                    "message": (f"Спортшы {aid} {gap} мин кейін қайта шығады." if kk
                                else f"Спортсмен {aid} снова выходит через {gap} мин."),
                    "suggestion": ("Бойлардың бірін татамиде 1–2 орынға жылжытыңыз." if kk
                                   else "Перенесите один из боёв на 1–2 позиции позже на его татами."),
                })
            if m.scheduled_at:
                last_seen[aid] = m.scheduled_at
    return conflicts
