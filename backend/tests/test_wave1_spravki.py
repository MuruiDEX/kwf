"""Wave 1: spravki (coach documents) — templates, scoping, issue + PDF."""
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


def _coach_with_athlete(suffix="s1"):
    coach = _mkuser(f"spcoach{suffix}@kwf.org", "coach")
    # athlete without club: scope via created_by == coach (P0 rule)
    aid = client.post("/api/athletes",
                      json={"first_name": "Справкин", "last_name": "Аян",
                            "gender": "male", "birth_year": 2010,
                            "weight_kg": 40, "country": "KZ"},
                      headers=coach).json()["id"]
    return coach, aid


def test_templates_list_requires_athletes_manage():
    coach = _mkuser("sptmpl@kwf.org", "coach")
    r = client.get("/api/spravki/templates?lang=ru", headers=coach)
    assert r.status_code == 200, r.text
    keys = [t["key"] for t in r.json()]
    assert {"school", "participation", "attendance", "trip"} <= set(keys)
    # Wave 7: templates metadata carries no PII — any authenticated user
    # may list (data/issue/pdf stay scoped).
    ath = _mkuser("spnope@kwf.org", "athlete")
    assert client.get("/api/spravki/templates", headers=ath).status_code == 200


def test_data_and_issue_school_spravka():
    coach, aid = _coach_with_athlete("s2")
    d = client.get("/api/spravki/data", params={"athlete_id": aid}, headers=coach)
    assert d.status_code == 200, d.text
    assert d.json()["full_name"] == "Справкин Аян"
    # missing required manual fields -> 400 listing them
    r = client.post("/api/spravki/issue",
                    params={"template": "school", "athlete_id": aid, "lang": "ru"},
                    json={"fields": {}}, headers=coach)
    assert r.status_code == 400 and "birth_date" in r.json()["detail"]
    # full issue
    r = client.post("/api/spravki/issue",
                    params={"template": "school", "athlete_id": aid, "lang": "kk"},
                    json={"fields": {"birth_date": "12.05.2012",
                                     "train_period": "2023 — қазір",
                                     "absence_period": "10.11 — 15.11",
                                     "reason": "Жарыс",
                                     "extra_text": ""}}, headers=coach)
    assert r.status_code == 200, r.text
    code = r.json()["code"]
    pdf = client.get(f"/api/spravki/{code}.pdf", headers=coach)
    assert pdf.status_code == 200
    assert pdf.content[:5] == b"%PDF-"
    assert len(pdf.content) > 2000


def test_spravka_scope_coach_cannot_touch_foreign_athlete():
    coach_a, aid_a = _coach_with_athlete("s3a")
    coach_b, _ = _coach_with_athlete("s3b")
    # data
    r = client.get("/api/spravki/data", params={"athlete_id": aid_a}, headers=coach_b)
    assert r.status_code == 403, r.text
    # issue
    r = client.post("/api/spravki/issue",
                    params={"template": "attendance", "athlete_id": aid_a},
                    json={"fields": {"period": "nov"}}, headers=coach_b)
    assert r.status_code == 403, r.text
    # pdf guessing
    code = client.post("/api/spravki/issue",
                       params={"template": "attendance", "athlete_id": aid_a},
                       json={"fields": {"period": "nov"}}, headers=coach_a).json()["code"]
    assert client.get(f"/api/spravki/{code}.pdf", headers=coach_b).status_code == 404  # Wave 7: no oracle
    # unknown template
    r = client.post("/api/spravki/issue",
                    params={"template": "nope", "athlete_id": aid_a},
                    json={"fields": {}}, headers=coach_a)
    assert r.status_code == 400


def test_participation_needs_tournament_and_registration():
    coach, aid = _coach_with_athlete("s4")
    org = _mkuser("sporg4@kwf.org", "organizer")
    tid = client.post("/api/tournaments", json={"name": "SP Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M40", "gender": "male", "age_min": 10,
                            "age_max": 15, "weight_min": 30, "weight_max": 45},
                      headers=org).json()["id"]
    # no tournament at all -> 400
    r = client.post("/api/spravki/issue",
                    params={"template": "trip", "athlete_id": aid},
                    json={"fields": {"travel_dates": "1-2 dec"}}, headers=coach)
    assert r.status_code == 400
    # register then issue with auto tournament/category
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aid, "category_id": cat}, headers=coach)
    d = client.get("/api/spravki/data", params={"athlete_id": aid, "tournament_id": tid},
                   headers=coach).json()
    assert d["tournament"] == "SP Cup" and d["category"] == "M40"
    r = client.post("/api/spravki/issue",
                    params={"template": "participation", "athlete_id": aid,
                            "tournament_id": tid},
                    json={"fields": {"place": "2"}}, headers=coach)
    assert r.status_code == 200, r.text
