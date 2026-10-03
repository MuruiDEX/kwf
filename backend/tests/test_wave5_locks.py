"""Wave 5: stage locks — brackets immutable in live/finished, registration
closed, move locked once brackets exist."""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password


def _mkuser(email, role):
    s = TestSession()
    if not s.query(User).filter_by(email=email).first():
        s.add(User(email=email, password_hash=hash_password("pw123456"),
                   full_name=role, role=role))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _setup(email="w5lock@kwf.org"):
    org = _mkuser(email, "organizer")
    coach = _mkuser("w5lockcoach@kwf.org", "coach")
    tid = client.post("/api/tournaments", json={"name": "Lock Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    mk = lambda n, w0, w1: client.post(
        f"/api/tournaments/{tid}/categories",
        json={"name": n, "gender": "male", "age_min": 18, "age_max": 40,
              "weight_min": w0, "weight_max": w1}, headers=org).json()["id"]
    c1, c2 = mk("C1", 60, 70), mk("C2", 70, 90)
    aids = []
    for i in range(4):
        aid = client.post("/api/athletes", json={"first_name": "Lk", "last_name": f"A{i}",
                                                "gender": "male", "birth_year": 2000,
                                                "weight_kg": 68, "country": "KZ"},
                          headers=coach).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": c1}, headers=coach)
    return org, coach, tid, c1, c2, aids


def _to_live(org, tid):
    client.post(f"/api/tournaments/{tid}/status", json={"status": "registration"}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    assert client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org).status_code == 200


def test_gen_add_move_locked_in_live():
    org, coach, tid, c1, c2, aids = _setup()
    _to_live(org, tid)
    # regen would wipe results -> 409
    assert client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org).status_code == 409
    # late registration (single + bulk) -> 409
    aid = client.post("/api/athletes", json={"first_name": "Lk", "last_name": "Late",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 68, "country": "KZ"},
                      headers=coach).json()["id"]
    assert client.post(f"/api/tournaments/{tid}/registrations",
                       json={"athlete_id": aid, "category_id": c1},
                       headers=coach).status_code == 409
    assert client.post(f"/api/tournaments/{tid}/registrations/bulk",
                       json={"items": [{"athlete_id": aid, "category_id": c1}]},
                       headers=coach).status_code == 409
    # move in live -> 409
    rid = client.get(f"/api/tournaments/{tid}/registrations", headers=org).json()["items"][0]["id"]
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                       json={"category_id": c2}, headers=org).status_code == 409
    # ...but weigh-in/check-in/finish still work (operational in live)
    assert client.post(f"/api/tournaments/{tid}/weigh-in/{rid}",
                       json={"weigh_in_kg": 68}, headers=org).status_code == 200
    assert client.post(f"/api/tournaments/{tid}/check-in/{rid}",
                       json={"checked_in": True}, headers=org).status_code == 200


def test_move_locked_once_bracket_exists_even_before_live():
    org, coach, tid, c1, c2, aids = _setup("w5lock2@kwf.org")
    # brackets generated while still in upcoming: moves now forbidden
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    rid = client.get(f"/api/tournaments/{tid}/registrations", headers=org).json()["items"][0]["id"]
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                       json={"category_id": c2}, headers=org).status_code == 409
    # ...while status changes and finishes still work
    client.post(f"/api/tournaments/{tid}/status", json={"status": "registration"}, headers=org)
    assert client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org).status_code == 200
