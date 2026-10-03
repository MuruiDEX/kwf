"""Wave 2: bulk registration — one operation, per-row errors, same guards."""
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


def _setup(email="w2bulk@kwf.org"):
    org = _mkuser(email, "organizer")
    coach = _mkuser("w2bulkcoach@kwf.org", "coach")
    tid = client.post("/api/tournaments", json={"name": "Bulk Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aids = []
    for i in range(3):
        aid = client.post("/api/athletes",
                          json={"first_name": "Bulk", "last_name": f"A{i}",
                                "gender": "male", "birth_year": 2000,
                                "weight_kg": 68, "country": "KZ"},
                          headers=coach).json()["id"]
        aids.append(aid)
    return org, coach, tid, cat, aids


def test_bulk_ok_and_partial_errors():
    org, coach, tid, cat, aids = _setup()
    items = [{"athlete_id": a, "category_id": cat} for a in aids]
    items.append({"athlete_id": aids[0], "category_id": cat})  # dup row
    items.append({"athlete_id": 999999, "category_id": cat})  # bad athlete
    r = client.post(f"/api/tournaments/{tid}/registrations/bulk",
                    json={"items": items}, headers=coach)
    assert r.status_code == 200, r.text
    j = r.json()
    assert len(j["registered"]) == 3
    assert len(j["errors"]) == 2
    assert all("warnings" in x for x in j["registered"])
    # owner got a bulk notification
    notes = client.get("/api/notifications", headers=org).json()["items"]
    assert any(n["type"] == "registration" and "Bulk" in n["message"] for n in notes)


def test_bulk_guards_same_as_single():
    org, coach, tid, cat, aids = _setup("w2bulk2@kwf.org")
    items = [{"athlete_id": aids[0], "category_id": cat}]
    # Wave 4 contract: athlete role may bulk-register ONLY the claimed
    # profile (row-level); foreign rows fail individually, good rows survive.
    ath = _mkuser("w2bulkath@kwf.org", "athlete")
    r = client.post(f"/api/tournaments/{tid}/registrations/bulk",
                    json={"items": items}, headers=ath)
    assert r.status_code == 200, r.text
    assert r.json()["registered"] == [] and len(r.json()["errors"]) == 1
    # after claiming, the same call registers
    assert client.post(f"/api/athletes/{aids[0]}/claim", headers=ath).status_code == 200
    r = client.post(f"/api/tournaments/{tid}/registrations/bulk",
                    json={"items": items}, headers=ath)
    assert len(r.json()["registered"]) == 1, r.text
    # foreign organizer cannot touch чужой турнир
    org2 = _mkuser("w2bulkorg2@kwf.org", "organizer")
    assert client.post(f"/api/tournaments/{tid}/registrations/bulk",
                       json={"items": items}, headers=org2).status_code == 403
    # empty list rejected by schema
    assert client.post(f"/api/tournaments/{tid}/registrations/bulk",
                       json={"items": []}, headers=coach).status_code == 422
