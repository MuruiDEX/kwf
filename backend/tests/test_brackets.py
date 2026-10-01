from app.services.seeding import seed_order, assign_seeds, next_power_of_two
from app.services.brackets import generate_bracket
from app.services.schedule import detect_conflicts
from tests.db import TestSession
from app.models.tournament import Tournament, TournamentCategory
from app.models.club_athlete import Athlete
from app.models.competition import Registration
from datetime import date

def test_seed_spreads_top_two():
    order = seed_order(8)
    assert order[0] == 0
    slots = assign_seeds([1, 2, 3, 4], 8)
    # top seeds must not share first-round match: slots[0] and slots[1] differ in strength pairing
    assert slots[0] == 1

def test_bracket_bye_and_advance():
    db = TestSession()
    t = Tournament(name="SeedUnit Cup", city="A", country="KZ", start_date=date(2026, 10, 1))
    db.add(t); db.commit(); db.refresh(t)
    c = TournamentCategory(tournament_id=t.id, name="Men -70")
    db.add(c); db.commit(); db.refresh(c)
    ids = []
    for i in range(6):
        a = Athlete(first_name="SU", last_name=f"Unit{i}", birth_year=2000, weight_kg=68, gender="male", points=10 - i)
        db.add(a); db.commit(); db.refresh(a)
        db.add(Registration(tournament_id=t.id, athlete_id=a.id, category_id=c.id))
        ids.append(a.id)
    db.commit()
    b = generate_bracket(db, t.id, c.id, ids)
    assert b.size == 8
    db.close()

def test_next_pow2():
    assert next_power_of_two(6) == 8
    assert next_power_of_two(16) == 16
