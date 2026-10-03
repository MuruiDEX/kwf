"""Wave 1: podium diplomas 1-3 — bulk issue idempotent, registry, re-download."""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password


def _org(email="wave1pod@kwf.org"):
    s = TestSession()
    if not s.query(User).filter_by(email=email).first():
        s.add(User(email=email, password_hash=hash_password("pw123456"),
                   full_name="o", role="organizer"))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _tournament_with_bracket(org, name="Pod Cup"):
    tid = client.post("/api/tournaments", json={"name": name, "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aids = []
    for i in range(4):
        aid = client.post("/api/athletes",
                          json={"first_name": "Под", "last_name": f"Иумов{i}",
                                "gender": "male", "birth_year": 2000,
                                "weight_kg": 68, "country": "KZ"},
                          headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=org)
    assert client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org).status_code == 200
    return tid, cat, aids


def _finish_all(org, tid):
    ref_h = _org("wave1podref@kwf.org")
    # referee role needed for finish on foreign tournament; promote direct
    s = TestSession()
    u = s.query(User).filter_by(email="wave1podref@kwf.org").first()
    u.role = "referee"
    s.commit()
    s.close()
    for _ in range(3):
        br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
        pending = [m for m in br if m["status"] not in ("bye", "finished") and m["a"] and m["b"]]
        if not pending:
            break
        m = pending[0]
        r = client.post(f"/api/tournaments/matches/{m['id']}/finish",
                        json={"winner_id": m["a"], "score_a": 1, "score_b": 0},
                        headers=ref_h)
        assert r.status_code == 200, r.text


def test_podium_places_and_bulk_issue_idempotent():
    org = _org()
    tid, _, _ = _tournament_with_bracket(org)
    _finish_all(org, tid)
    pod = client.get(f"/api/tournaments/{tid}/podium").json()
    assert len(pod) == 1
    assert pod[0]["gold"] and pod[0]["silver"]
    assert len(pod[0]["bronze"]) == 2  # both semifinal losers
    ids = {pod[0]["gold"]["id"], pod[0]["silver"]["id"],
           *[b["id"] for b in pod[0]["bronze"]]}
    assert len(ids) == 4  # distinct athletes
    r = client.post(f"/api/tournaments/{tid}/documents/issue-podium", headers=org)
    assert r.status_code == 200, r.text
    assert len(r.json()["issued"]) == 4
    assert r.json()["skipped"] == 0
    places = sorted(x["place"] for x in r.json()["issued"])
    assert places == ["1", "2", "3", "3"]
    # second run issues nothing new (idempotent)
    r2 = client.post(f"/api/tournaments/{tid}/documents/issue-podium", headers=org)
    assert r2.json()["issued"] == [] and r2.json()["skipped"] == 4
    # registry lists them; each re-downloads as PDF
    docs = client.get(f"/api/tournaments/{tid}/documents", headers=org).json()
    assert len(docs) == 4
    for d in docs:
        pdf = client.get(f"/api/documents/{d['code']}/certificate.pdf")
        assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"


def test_podium_unfinished_category_yields_nothing():
    org = _org("wave1pod2@kwf.org")
    tid, _, _ = _tournament_with_bracket(org, name="Pod Cup 2")
    assert client.get(f"/api/tournaments/{tid}/podium").json() == []
    r = client.post(f"/api/tournaments/{tid}/documents/issue-podium", headers=org)
    assert r.json() == {"issued": [], "skipped": 0}
