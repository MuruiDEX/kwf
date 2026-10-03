"""Wave 2: read-all + checkin/moved events to the athlete's coach."""
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


def test_read_all_and_coach_events():
    org = _mkuser("w2ntorg@kwf.org", "organizer")
    coach = _mkuser("w2ntcoach@kwf.org", "coach")
    tid = client.post("/api/tournaments", json={"name": "Nt Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    mk = lambda n, w0, w1: client.post(
        f"/api/tournaments/{tid}/categories",
        json={"name": n, "gender": "male", "age_min": 18, "age_max": 40,
              "weight_min": w0, "weight_max": w1}, headers=org).json()["id"]
    c1, c2 = mk("C1", 60, 70), mk("C2", 70, 90)
    aid = client.post("/api/athletes", json={"first_name": "Nt", "last_name": "Kid",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 75, "country": "KZ"},
                      headers=coach).json()["id"]
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": c1}, headers=coach).json()["id"]
    # check-in by organizer -> coach notified (actor != coach)
    client.post(f"/api/tournaments/{tid}/check-in/{rid}",
                json={"checked_in": True}, headers=org)
    notes = client.get("/api/notifications", headers=coach).json()
    assert any(n["type"] == "checkin" for n in notes["items"])
    assert notes["unread"] >= 1
    # move by organizer -> coach notified
    client.post(f"/api/tournaments/{tid}/weigh-in/{rid}",
                json={"weigh_in_kg": 75}, headers=org)
    client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                json={"category_id": c2}, headers=org)
    assert any(n["type"] == "moved" for n in
               client.get("/api/notifications", headers=coach).json()["items"])
    # read-all clears everything atomically
    r = client.post("/api/notifications/read-all", headers=coach)
    assert r.status_code == 200 and r.json()["marked"] >= 2
    assert client.get("/api/notifications", headers=coach).json()["unread"] == 0
    # read-all is idempotent
    assert client.post("/api/notifications/read-all", headers=coach).json()["marked"] == 0
