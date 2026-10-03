"""Wave 5: IDOR/ownership spot-checks across Wave 1-4 endpoints."""
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


def _setup(email="w5idor@kwf.org"):
    org = _mkuser(email, "organizer")
    coach = _mkuser("w5idorcoach@kwf.org", "coach")
    tid = client.post("/api/tournaments", json={"name": "Idor Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aid = client.post("/api/athletes", json={"first_name": "Id", "last_name": "Or",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 68, "country": "KZ"},
                      headers=coach).json()["id"]
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": cat}, headers=coach).json()["id"]
    cat2 = client.post(f"/api/tournaments/{tid}/categories",
                       json={"name": "M80", "gender": "male", "age_min": 18,
                             "age_max": 40, "weight_min": 60, "weight_max": 80},
                       headers=org).json()["id"]
    return org, coach, tid, cat, aid, rid, cat2


def test_idor_matrix():
    org, coach, tid, cat, aid, rid, cat2 = _setup()
    org_b = _mkuser("w5idorB@kwf.org", "organizer")
    ref = _mkuser("w5idorref@kwf.org", "referee")
    ath = _mkuser("w5idorath@kwf.org", "athlete")
    client.cookies.clear()
    G = None  # guest = no headers

    # tatamis list: owner 200, foreign organizer 403, coach 403, guest 401
    assert client.get(f"/api/tournaments/{tid}/tatamis", headers=org).status_code == 200
    assert client.get(f"/api/tournaments/{tid}/tatamis", headers=org_b).status_code == 403
    assert client.get(f"/api/tournaments/{tid}/tatamis", headers=coach).status_code == 403
    assert client.get(f"/api/tournaments/{tid}/tatamis", headers=G).status_code == 401
    # referees directory: organizer 200, coach 403
    assert client.get("/api/referees", headers=org).status_code == 200
    assert client.get("/api/referees", headers=coach).status_code == 403
    # my assignments: referee 200, coach 403, guest 401
    assert client.get("/api/tournaments/referee/assignments", headers=ref).status_code == 200
    assert client.get("/api/tournaments/referee/assignments", headers=coach).status_code == 403
    assert client.get("/api/tournaments/referee/assignments", headers=G).status_code == 401
    # tournament documents registry: owner 200, foreign 403
    assert client.get(f"/api/tournaments/{tid}/documents", headers=org).status_code == 200
    assert client.get(f"/api/tournaments/{tid}/documents", headers=org_b).status_code == 403
    # athlete documents: login required (guest 401), unknown athlete 404
    assert client.get(f"/api/athletes/{aid}/documents", headers=G).status_code == 401
    assert client.get(f"/api/athletes/{aid}/documents", headers=coach).status_code == 200
    assert client.get("/api/athletes/999999/documents", headers=coach).status_code == 404
    # spravki data/pdf: foreign coach 403 (scope), unknown athlete 404
    coach2 = _mkuser("w5idorcoach2@kwf.org", "coach")
    assert client.get("/api/spravki/data", params={"athlete_id": aid}, headers=coach2).status_code == 403
    code = client.post("/api/spravki/issue", params={"template": "attendance", "athlete_id": aid},
                       json={"fields": {"period": "nov"}}, headers=coach).json()["code"]
    # Wave 7: unknown and foreign codes both 404 (no existence oracle,
    # same pattern as notification read).
    assert client.get(f"/api/spravki/{code}.pdf", headers=coach2).status_code == 404
    assert client.get(f"/api/spravki/{code}.pdf", headers=coach).status_code == 200
    # my registrations/athlete: guest 401, user without link gets [] / null
    # (clear jar: _mkuser logins above set cookies, Bearer headers don't replace them)
    client.cookies.clear()
    assert client.get("/api/me/registrations", headers=G).status_code == 401
    assert client.get("/api/me/registrations", headers=ath).json() == []
    assert client.get("/api/me/athlete", headers=ath).json() is None
    # bulk-status: referee 403 (no tournaments.manage)
    assert client.post(f"/api/tournaments/{tid}/registrations/bulk-status",
                       json={"ids": [rid], "status": "approved"}, headers=ref).status_code == 403
    # move: referee as tournament official passes guards (global official role,
    # same as weigh-in); move to the SAME category is a 400 validation case
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                       json={"category_id": cat2}, headers=ref).status_code == 200
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/move",
                       json={"category_id": cat2}, headers=ref).status_code == 400
    # notifications: foreign read -> 404 (no oracle), read-all only own
    notes = client.get("/api/notifications", headers=org).json()["items"]
    if notes:
        assert client.post(f"/api/notifications/{notes[0]['id']}/read", headers=coach2).status_code == 404
