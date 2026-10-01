"""E2E per §43: create tournament → athletes → categories → brackets → schedule
→ start → finish fight → winner advances → live → certificate. Uses shared isolated test DB."""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password

def auth_headers(role="organizer"):
    # organizer/admin are granted by admin approval (see test_org.py); tests set them up directly
    email = f"{role}@e2e.org"
    if role in ("organizer", "admin"):
        s = TestSession()
        if not s.query(User).filter_by(email=email).first():
            s.add(User(email=email, password_hash=hash_password("pw123456"), full_name=role, role=role))
            s.commit()
        s.close()
    else:
        client.post("/api/auth/register", json={"email": email, "password": "pw123456",
                                                "full_name": role, "role": role})
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}

def test_e2e_tournament_lifecycle():
    org = auth_headers("organizer")
    # create tournament
    r = client.post("/api/tournaments", json={"name": "E2E Cup", "city": "Astana", "country": "KZ",
                                              "start_date": "2026-12-01", "tatami_count": 1}, headers=org)
    assert r.status_code == 200, r.text
    tid = r.json()["id"]
    # category
    r = client.post(f"/api/tournaments/{tid}/categories",
                    json={"name": "Men -70", "gender": "male", "age_min": 18, "age_max": 40,
                          "weight_min": 60, "weight_max": 70}, headers=org)
    assert r.status_code == 200, r.text
    cat = r.json()["id"]
    # athletes + registrations
    aids = []
    for i in range(4):
        r = client.post("/api/athletes", json={"first_name": "F", "last_name": f"E2E{i}",
                                               "gender": "male", "birth_year": 2000,
                                               "weight_kg": 68, "country": "KZ"}, headers=org)
        assert r.status_code == 200, r.text
        aid = r.json()["id"]
        aids.append(aid)
        r = client.post(f"/api/tournaments/{tid}/registrations",
                        json={"athlete_id": aid, "category_id": cat}, headers=org)
        assert r.status_code == 200, r.text
    # brackets
    r = client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    assert r.status_code == 200 and r.json()[0]["size"] == 4, r.text
    # schedule
    r = client.post(f"/api/tournaments/{tid}/schedule/generate", headers=org)
    assert r.json()["scheduled"] == 3, r.text  # 4 athletes -> 3 fights (2 semi + final)
    # no conflicts expected
    assert client.get(f"/api/tournaments/{tid}/conflicts").json() == []
    # finish first-round fight, winner must advance
    br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    first = [m for m in br if m["round"] == 1 and m["status"] != "bye"][0]
    winner = first["a"]
    ref = auth_headers("referee")
    r = client.post(f"/api/tournaments/matches/{first['id']}/finish",
                    json={"winner_id": winner, "score_a": 2, "score_b": 0}, headers=ref)
    assert r.status_code == 200, r.text
    nxt_id = r.json()["next"]
    br2 = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    nxt = [m for m in br2 if m["id"] == nxt_id][0]
    assert winner in (nxt["a"], nxt["b"]), "winner did not advance"
    # live state reachable
    live = client.get(f"/api/tournaments/{tid}/live").json()
    assert "queue" in live
    # validation runs
    assert isinstance(client.get(f"/api/tournaments/{tid}/validate").json(), list)
    # results + certificate
    assert client.get(f"/api/tournaments/{tid}/results").json()["tournament"] == "E2E Cup"
    r = client.post("/api/documents/issue", params={"athlete_id": winner, "tournament_id": tid,
                                                    "kind": "diploma", "place": "1", "category": "Men -70"},
                    headers=org)
    code = r.json()["code"]
    v = client.get(f"/api/documents/verify/{code}").json()
    assert v["valid"] and v["place"] == "1"
    pdf = client.get(f"/api/documents/{code}/certificate.pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf"
    # exports
    assert client.get(f"/api/tournaments/{tid}/export/participants.csv", headers=org).status_code == 200
    assert client.get(f"/api/tournaments/{tid}/export/participants.xlsx", headers=org).status_code == 200
    # audit log records critical actions
    actions = [a["action"] for a in client.get("/api/audit", headers=org).json()["items"]]
    assert "generated brackets" in actions and "finished fight" in actions
    # permissions: public cannot create tournaments
    r = client.post("/api/tournaments", json={"name": "X", "start_date": "2026-12-02"})
    assert r.status_code in (401, 403)
