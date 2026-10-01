"""Smart validation checklist + safe auto-fix. Bilingual (ru/kk)."""
from __future__ import annotations
from sqlalchemy.orm import Session
from app.models.competition import Bracket, BracketMatch, Registration
from app.models.tournament import TournamentCategory
from app.services.schedule import detect_conflicts

def _t(kk: bool, ru: str, kk_s: str) -> str:
    return kk_s if kk else ru

def validate_tournament(db: Session, tournament_id: int, lang: str = "ru") -> list[dict]:
    kk = lang.lower().startswith("kk")
    checks: list[dict] = []
    cats = db.query(TournamentCategory).filter_by(tournament_id=tournament_id).all()
    regs = db.query(Registration).filter_by(tournament_id=tournament_id).all()
    checks.append({"key": "categories", "ok": len(cats) > 0,
                   "message": _t(kk, "Категории заданы" if cats else "Нет категорий",
                                 "Санаттар көрсетілген" if cats else "Санаттар жоқ")})
    checks.append({"key": "registrations", "ok": len(regs) > 0,
                   "message": _t(kk, f"Зарегистрировано: {len(regs)}", f"Тіркелгендер: {len(regs)}")})
    not_weighed = [r for r in regs if r.weigh_in_status == "pending"]
    checks.append({"key": "weighin", "ok": len(not_weighed) == 0, "level": "warning" if not_weighed else "ok",
                   "message": _t(kk, f"Не взвешены: {len(not_weighed)}" if not_weighed else "Взвешивание завершено",
                                 f"Өлшенбегендер: {len(not_weighed)}" if not_weighed else "Салмақ өлшеу аяқталды"),
                   "count": len(not_weighed)})
    brackets = db.query(Bracket).filter_by(tournament_id=tournament_id).all()
    checks.append({"key": "brackets", "ok": len(brackets) > 0,
                   "message": _t(kk, f"Сеток создано: {len(brackets)}" if brackets else "Сетки не созданы",
                                 f"Торлар құрылды: {len(brackets)}" if brackets else "Торлар құрылмаған")})
    for c in cats:
        n = len([r for r in regs if r.category_id == c.id])
        if n < 2:
            checks.append({"key": f"cat-{c.id}", "ok": False, "level": "warning",
                           "message": _t(kk, f"В категории «{c.name}» только {n}: рассмотрите объединение",
                                         f"«{c.name}» санатында тек {n}: біріктіруді қарастырыңыз"),
                           "suggestion": _t(kk, "Объединить с ближайшей весовой категорией",
                                            "Жақын салмақ санатымен біріктіріңіз")})
    conflicts = detect_conflicts(db, tournament_id, lang=lang)
    checks.append({"key": "conflicts", "ok": len(conflicts) == 0, "level": "warning" if conflicts else "ok",
                   "message": _t(kk, f"Конфликтов расписания: {len(conflicts)}" if conflicts else "Конфликтов нет",
                                 f"Кесте қайшылықтары: {len(conflicts)}" if conflicts else "Қайшылықтар жоқ"),
                   "items": conflicts[:10]})
    return checks

def weighin_status(weight_kg: float, weight_min: float, weight_max: float) -> str:
    """Single source of truth for weigh-in bucketing (P2 dedup: previously the
    same ternary lived in tournaments.weigh_in and here, inviting divergence)."""
    return "ok" if weight_min <= weight_kg <= weight_max else ("over" if weight_kg > weight_max else "under")

def autofix_weighin_status(db: Session, tournament_id: int) -> int:
    """Safe fix: recompute weigh-in status from category bounds. Returns fixed count."""
    regs = db.query(Registration).filter_by(tournament_id=tournament_id).all()
    fixed = 0
    for r in regs:
        if r.weigh_in_kg is None:
            continue
        cat = db.get(TournamentCategory, r.category_id)
        if not cat:
            continue
        want = weighin_status(r.weigh_in_kg, cat.weight_min, cat.weight_max)
        if r.weigh_in_status != want:
            r.weigh_in_status = want
            fixed += 1
    db.commit()
    return fixed
