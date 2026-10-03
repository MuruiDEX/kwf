"""Wave 1: printable sheets (weigh-in / start protocol / tatami schedule)."""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password


def _org(email="wave1print@kwf.org"):
    s = TestSession()
    if not s.query(User).filter_by(email=email).first():
        s.add(User(email=email, password_hash=hash_password("pw123456"),
                   full_name="o", role="organizer"))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _tid(org, name="Print Cup"):
    tid = client.post("/api/tournaments", json={"name": name, "city": "Астана",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "Ерлер 70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    for i in range(2):
        aid = client.post("/api/athletes",
                          json={"first_name": "Батыр", "last_name": f"Әлі{i}",
                                "gender": "male", "birth_year": 2000,
                                "weight_kg": 68, "country": "KZ"},
                          headers=org).json()["id"]
        rid = client.post(f"/api/tournaments/{tid}/registrations",
                          json={"athlete_id": aid, "category_id": cat},
                          headers=org).json()["id"]
        client.post(f"/api/tournaments/{tid}/weigh-in/{rid}",
                    json={"weigh_in_kg": 68}, headers=org)
    return tid


def test_print_sheets_pdf_and_forbidden_for_foreign():
    org = _org()
    tid = _tid(org)
    for path in ["weighin.pdf", "start-protocol.pdf", "schedule.pdf"]:
        r = client.get(f"/api/tournaments/{tid}/export/{path}", headers=org)
        assert r.status_code == 200, (path, r.text)
        assert r.content[:5] == b"%PDF-"
        assert len(r.content) > 1500, path
    org2 = _org("wave1print2@kwf.org")
    r = client.get(f"/api/tournaments/{tid}/export/weighin.pdf", headers=org2)
    assert r.status_code == 403, r.text
