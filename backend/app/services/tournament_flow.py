"""Tournament lifecycle transitions (moved out of the endpoint thin layer)."""
from __future__ import annotations
from sqlalchemy.orm import Session
from app.models.tournament import Tournament
from app.models.competition import Bracket, BracketMatch

FLOW = ["upcoming", "registration", "live", "finished"]


class FlowError(ValueError):
    """Carries bilingual messages; the endpoint picks by Accept-Language."""

    def __init__(self, ru: str, kk: str):
        super().__init__(ru)
        self.ru = ru
        self.kk = kk


def plan_transition(db: Session, t: Tournament, target: str) -> None:
    """Validate a status change and apply it. Raises FlowError on guard breach."""
    cur = FLOW.index(t.status) if t.status in FLOW else 0
    nxt = FLOW.index(target)
    if nxt <= cur:
        raise FlowError(f"Нельзя вернуться со статуса '{t.status}' на '{target}'",
                        f"'{t.status}' мәртебесінен '{target}' мәртебесіне оралуға болмайды")
    if nxt > cur + 1:
        raise FlowError("Статусы переключаются только по порядку",
                        "Мәртебелер тек ретімен ауысады")
    bids = [b.id for b in db.query(Bracket).filter_by(tournament_id=t.id).all()]
    if target == "live" and not bids:
        raise FlowError("Нельзя начать турнир без сеток: сначала сгенерируйте сетки",
                        "Торларсыз турнирді бастауға болмайды: алдымен торларды құрыңыз")
    if target == "finished" and bids:
        pending = db.query(BracketMatch).filter(
            BracketMatch.bracket_id.in_(bids),
            BracketMatch.status.in_(["scheduled", "live"])).count()
        if pending:
            raise FlowError(f"Нельзя завершить: осталось {pending} незавершённых боёв",
                            f"Аяқтауға болмайды: {pending} аяқталмаған жекпе-жек қалды")
    t.status = target
    db.commit()
