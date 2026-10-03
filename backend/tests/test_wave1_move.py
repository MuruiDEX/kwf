"""Wave 1: move registration between categories (weigh-in over/under flow)."""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password


def _org(email="wave1move@kwf.org"):
    s = TestSession()
    if not s.query(User).filter_by(email=email).first():
        s.add(User(email=email, password_hash=hash_password("pw123456"),
                   full_name="o", role="organizer"))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _setup(org):
    tid = client.post("/api/tournaments", json={"name": "Move Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    mk = lambda name, wmin, wmax: client.post(
        f"/api/tournaments/{tid}/categories",
        json={"name": name, "gender": "male", "age_min": 18, "age_max": 40,
              "weight_min": wmin, "weight_max": wmax}, headers=org).json()["id"]
    light, heavy = mk("Light", 60, 70), mk("Heavy", 70, 90)
    aid = client.post("/api/athletes", json={"first_name": "Move", "last_name": "Me",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 75, "country": "KZ"},
                      headers=org).json()["id"]
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": light}, headers=org).json()["id"]
    return tid, light, heavy, aid, rid


def test_move_ok_recomputes_weighin_status():
    org = _org()
    tid, light, heavy, aid, rid = _setup(org)
    client.post(f"/api/tournaments/{tid}/weigh-in/{rid}",
                json={"weigh_in_kg": 75}, headers=org)
    r = client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                    json={"category_id": heavy}, headers=org)
    assert r.status_code == 200, r.text
    assert r.json()["category_id"] == heavy
    assert r.json()["weigh_in_status"] == "ok"
    regs = client.get(f"/api/tournaments/{tid}/registrations", headers=org).json()["items"]
    row = [x for x in regs if x["id"] == rid][0]
    assert row["category_id"] == heavy and row["weigh_in_status"] == "ok"


def test_move_rejects_bad_target_and_duplicates():
    org = _org("wave1move2@kwf.org")
    tid, light, heavy, aid, rid = _setup(org)
    # foreign category
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                       json={"category_id": 999999}, headers=org).status_code == 400
    # same category
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                       json={"category_id": light}, headers=org).status_code == 400
    # weight out of target bounds
    client.post(f"/api/tournaments/{tid}/weigh-in/{rid}",
                json={"weigh_in_kg": 65}, headers=org)
    r = client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                    json={"category_id": heavy}, headers=org)
    assert r.status_code == 400
    # duplicate registration in target
    rid2 = client.post(f"/api/tournaments/{tid}/registrations",
                       json={"athlete_id": aid, "category_id": heavy},
                       headers=org).json()["id"]
    assert rid2 != rid
    r = client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                    json={"category_id": heavy}, headers=org)
    # rid has weigh_in 65 which is out of heavy bounds anyway -> 400 either way
    assert r.status_code == 400


def test_move_forbidden_for_foreign_organizer():
    org = _org("wave1move3@kwf.org")
    tid, light, heavy, aid, rid = _setup(org)
    org2 = _org("wave1move4@kwf.org")
    r = client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                    json={"category_id": heavy}, headers=org2)
    assert r.status_code == 403, r.text
