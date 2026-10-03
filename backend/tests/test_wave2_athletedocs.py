"""Wave 2: athlete documents list (public kinds only, spravka excluded)."""
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


def test_athlete_docs_lists_public_kinds_and_hides_spravka():
    org = _mkuser("w2docorg@kwf.org", "organizer")
    coach = _mkuser("w2doccoach@kwf.org", "coach")
    tid = client.post("/api/tournaments", json={"name": "Doc Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aid = client.post("/api/athletes", json={"first_name": "Doc", "last_name": "Kid",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 68, "country": "KZ"},
                      headers=coach).json()["id"]
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aid, "category_id": cat}, headers=coach)
    d = client.post("/api/documents/issue",
                    params={"athlete_id": aid, "tournament_id": tid,
                            "kind": "diploma", "place": "1", "category": "M70"},
                    headers=org)
    assert d.status_code == 200, d.text
    s = client.post("/api/spravki/issue",
                    params={"template": "attendance", "athlete_id": aid},
                    json={"fields": {"period": "nov"}}, headers=coach)
    assert s.status_code == 200, s.text
    # guest (no auth) cannot list
    client.cookies.clear()
    assert client.get(f"/api/athletes/{aid}/documents").status_code == 401
    # any logged-in user sees the diploma but NOT the spravka
    docs = client.get(f"/api/athletes/{aid}/documents", headers=coach).json()
    kinds = [x["kind"] for x in docs]
    assert kinds == ["diploma"]
    assert docs[0]["tournament"] == "Doc Cup" and docs[0]["place"] == "1"
    # unknown athlete -> 404
    assert client.get("/api/athletes/999999/documents", headers=coach).status_code == 404
