"""Bracket generation + atomic fight finalization."""
from __future__ import annotations
from sqlalchemy.orm import Session
from app.models.competition import Bracket, BracketMatch
from app.services.seeding import assign_seeds, next_power_of_two

def generate_bracket(db: Session, tournament_id: int, category_id: int, athlete_ids_by_strength: list[int]) -> Bracket:
    # cleanup old
    for b in db.query(Bracket).filter_by(tournament_id=tournament_id, category_id=category_id).all():
        db.query(BracketMatch).filter_by(bracket_id=b.id).delete()
        db.delete(b)
    db.flush()
    size = next_power_of_two(max(len(athlete_ids_by_strength), 4))
    bracket = Bracket(tournament_id=tournament_id, category_id=category_id, size=size)
    db.add(bracket)
    db.flush()
    slots = assign_seeds(athlete_ids_by_strength, size)
    rounds = size.bit_length() - 1
    # create matches per round
    match_ids: dict[tuple[int, int], int] = {}
    for r in range(1, rounds + 1):
        count = size // (2 ** r)
        for pos in range(count):
            m = BracketMatch(bracket_id=bracket.id, round_no=r, position=pos)
            if r == 1:
                a = slots[pos * 2]
                b = slots[pos * 2 + 1]
                m.athlete_a_id, m.athlete_b_id = a, b
                if (a is None) != (b is None):
                    m.status = "bye"
                    m.winner_id = a if b is None else b
                elif a is None and b is None:
                    m.status = "bye"
            db.add(m)
            db.flush()
            match_ids[(r, pos)] = m.id
    # link next matches
    for r in range(1, rounds):
        count = size // (2 ** r)
        for pos in range(count):
            m = db.get(BracketMatch, match_ids[(r, pos)])
            m.next_match_id = match_ids[(r + 1, pos // 2)]
    # auto-propagate byes
    for r in range(1, rounds):
        count = size // (2 ** r)
        for pos in range(count):
            m = db.get(BracketMatch, match_ids[(r, pos)])
            if m.status == "bye" and m.winner_id and m.next_match_id:
                nxt = db.get(BracketMatch, m.next_match_id)
                if nxt.athlete_a_id is None:
                    nxt.athlete_a_id = m.winner_id
                elif nxt.athlete_b_id is None:
                    nxt.athlete_b_id = m.winner_id
    # P0: flush only — gen_brackets endpoint commits once for all categories,
    # so a concurrent regeneration either wins entirely or rolls back (unique
    # constraint uq_bracket_tournament_category), never half-applies.
    db.flush()
    return bracket

class MatchConflict(ValueError):
    """Correction blocked: a downstream fight is already finished."""


def finish_fight(
    db: Session, match_id: int, winner_id: int, score_a: int = 0, score_b: int = 0
) -> tuple[BracketMatch, str]:
    """Transactional finish with idempotency + safe correction.

    Returns (match, outcome) where outcome is:
      "finished"  — first decision, winner advanced downstream;
      "repeated"  — identical finish replayed, no state change (idempotent no-op);
      "corrected" — winner changed while downstream is still pending; the
                    downstream slot holding the previous winner is fixed.
    Raises MatchConflict when the downstream fight is already finished — the
    caller must revert downstream first instead of silently forking the bracket.
    P0: flushes only — the caller commits once together with ranking updates,
    so bracket + points are atomic; the caller publishes live events after.
    """
    m = db.get(BracketMatch, match_id)
    if not m:
        raise ValueError("Match not found")
    if winner_id not in (m.athlete_a_id, m.athlete_b_id):
        raise ValueError("Winner must be a participant")
    if (m.status == "finished" and m.winner_id == winner_id
            and m.score_a == score_a and m.score_b == score_b):
        return m, "repeated"
    prev_winner = m.winner_id if m.status == "finished" else None
    correcting = prev_winner is not None and prev_winner != winner_id
    if correcting and m.next_match_id:
        nxt = db.get(BracketMatch, m.next_match_id)
        if nxt is not None and nxt.status == "finished":
            raise MatchConflict("Downstream fight already finished - revert it first")
        if nxt is not None:
            if nxt.athlete_a_id == prev_winner:
                nxt.athlete_a_id = winner_id
            elif nxt.athlete_b_id == prev_winner:
                nxt.athlete_b_id = winner_id
    m.winner_id = winner_id
    m.score_a, m.score_b = score_a, score_b
    m.status = "finished"
    if m.next_match_id:
        nxt = db.get(BracketMatch, m.next_match_id)
        if nxt:
            if nxt.athlete_a_id is None:
                nxt.athlete_a_id = winner_id
            elif nxt.athlete_b_id is None and nxt.athlete_a_id != winner_id:
                nxt.athlete_b_id = winner_id
            # else: downstream slot already occupied — never overwrite silently.
    db.flush()
    db.refresh(m)
    return m, ("corrected" if correcting else "finished")
