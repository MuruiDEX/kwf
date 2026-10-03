"""Wave 2: club report — roster, tournaments, medals from real rows."""
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


def test_club_report_json_pdf_xlsx():
    org = _mkuser("w2reporg@kwf.org", "organizer")
    coach = _mkuser("w2repcoach@kwf.org", "coach")
    club = client.post("/api/clubs", json={"name": "Rep Club", "country": "KZ",
                                           "city": "Almaty", "coach_name": "RC"},
                       headers=org).json()
    cid = club["id"]
    # two athletes, both attached to the club (organizer may attach anywhere)
    aids = []
    for i in range(2):
        aid = client.post("/api/athletes",
                          json={"first_name": "Rep", "last_name": f"A{i}",
                                "gender": "male", "birth_year": 2000,
                                "weight_kg": 68, "country": "KZ", "club_id": cid},
                          headers=org).json()["id"]
        aids.append(aid)
    tid = client.post("/api/tournaments", json={"name": "Rep Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    for aid in aids:
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=coach)
    rep = client.get(f"/api/clubs/{cid}/report").json()
    assert rep["club"]["name"] == "Rep Club"
    assert rep["stats"]["athletes"] == 2
    assert rep["stats"]["participations"] == 2
    assert len(rep["tournaments"]) == 1 and rep["tournaments"][0]["participants"] == 2
    assert len(rep["roster"]) == 2
    pdf = client.get(f"/api/clubs/{cid}/report.pdf")
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
    xlsx = client.get(f"/api/clubs/{cid}/report.xlsx")
    assert xlsx.status_code == 200
    assert xlsx.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument")
    assert client.get("/api/clubs/999999/report").status_code == 404
