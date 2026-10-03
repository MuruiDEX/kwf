"""Wave 3: tournament + category PUT with stage/usage safety guards."""
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


def _tournament(org, name="Upd Cup", tatamis=2):
    tid = client.post("/api/tournaments", json={"name": name, "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": tatamis}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    return tid, cat


def test_tournament_put_ok_and_guards():
    org = _mkuser("w3upd@kwf.org", "organizer")
    tid, _ = _tournament(org)
    # cosmetic + date edit while upcoming
    r = client.put(f"/api/tournaments/{tid}",
                   json={"name": "Upd Cup Renamed", "city": "B", "start_date": "2027-01-15"},
                   headers=org)
    assert r.status_code == 200, r.text
    t = client.get(f"/api/tournaments/{tid}").json()
    assert t["name"] == "Upd Cup Renamed" and t["city"] == "B"
    # grow tatamis adds rows
    assert client.put(f"/api/tournaments/{tid}", json={"tatami_count": 3}, headers=org).status_code == 200
    assert len(client.get(f"/api/tournaments/{tid}/tatamis", headers=org).json()) == 3
    # shrink back (no brackets yet)
    assert client.put(f"/api/tournaments/{tid}", json={"tatami_count": 1}, headers=org).status_code == 200
    assert len(client.get(f"/api/tournaments/{tid}/tatamis", headers=org).json()) == 1
    # foreign organizer -> 403, athlete -> 403, guest -> 401
    # (names must pass min_length=3 so validation doesn't mask the guards)
    org_b = _mkuser("w3updB@kwf.org", "organizer")
    assert client.put(f"/api/tournaments/{tid}", json={"name": "Xyz"}, headers=org_b).status_code == 403
    ath = _mkuser("w3updath@kwf.org", "athlete")
    assert client.put(f"/api/tournaments/{tid}", json={"name": "Xyz"}, headers=ath).status_code == 403
    client.cookies.clear()
    assert client.put(f"/api/tournaments/{tid}", json={"name": "Xyz"}).status_code == 401
    assert client.put("/api/tournaments/999999", json={"name": "Xyz"}, headers=org).status_code == 404


def test_tournament_put_stage_locks():
    org = _mkuser("w3upd2@kwf.org", "organizer")
    coach = _mkuser("w3updcoach@kwf.org", "coach")
    tid, _ = _tournament(org, name="Lock Cup")
    aids = []
    for i in range(2):
        aid = client.post("/api/athletes", json={"first_name": "L", "last_name": f"K{i}",
                                                "gender": "male", "birth_year": 2000,
                                                "weight_kg": 68, "country": "KZ"},
                          headers=coach).json()["id"]
        aids.append(aid)
    # need category: reuse helper? it created one; fetch regs via bulk-less single
    cats = client.get(f"/api/tournaments/{tid}").json()["categories"]
    for aid in aids:
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cats[0]["id"]}, headers=coach)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    # tatami shrink locked once brackets exist
    assert client.put(f"/api/tournaments/{tid}", json={"tatami_count": 1}, headers=org).status_code == 409
    # cosmetic still fine pre-live
    assert client.put(f"/api/tournaments/{tid}", json={"name": "Lock Cup v2"}, headers=org).status_code == 200
    client.post(f"/api/tournaments/{tid}/status", json={"status": "registration"}, headers=org)
    client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org)
    # live: dates/type/tatamis locked, name still editable
    assert client.put(f"/api/tournaments/{tid}", json={"start_date": "2028-01-01"}, headers=org).status_code == 409
    assert client.put(f"/api/tournaments/{tid}", json={"type": "cup"}, headers=org).status_code == 409
    assert client.put(f"/api/tournaments/{tid}", json={"name": "Lock Cup Live"}, headers=org).status_code == 200


def test_category_put_ok_and_bounds_lock():
    org = _mkuser("w3cat@kwf.org", "organizer")
    tid, cid = _tournament(org, name="Cat Cup")
    body = {"name": "M70 Pro", "gender": "male", "age_min": 18, "age_max": 40,
            "weight_min": 60, "weight_max": 70, "level": "advanced",
            "fight_duration_sec": 120}
    # free category: full replace ok
    r = client.put(f"/api/tournaments/{tid}/categories/{cid}", json=body, headers=org)
    assert r.status_code == 200, r.text
    cats = client.get(f"/api/tournaments/{tid}").json()["categories"]
    assert cats[0]["name"] == "M70 Pro"
    # register an athlete -> bounds locked, name still free
    coach = _mkuser("w3catcoach@kwf.org", "coach")
    aid = client.post("/api/athletes", json={"first_name": "C", "last_name": "K",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 68, "country": "KZ"},
                      headers=coach).json()["id"]
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aid, "category_id": cid}, headers=coach)
    bad = dict(body, weight_max=75)
    assert client.put(f"/api/tournaments/{tid}/categories/{cid}", json=bad,
                      headers=org).status_code == 409
    bad_gender = dict(body, gender="female")
    assert client.put(f"/api/tournaments/{tid}/categories/{cid}", json=bad_gender,
                      headers=org).status_code == 409
    assert client.put(f"/api/tournaments/{tid}/categories/{cid}", json=dict(body, name="M70 X"),
                      headers=org).status_code == 200
    # foreign tournament / unknown category
    assert client.put(f"/api/tournaments/{tid}/categories/999999", json=body,
                      headers=org).status_code == 404
    org_b = _mkuser("w3catB@kwf.org", "organizer")
    assert client.put(f"/api/tournaments/{tid}/categories/{cid}", json=body,
                      headers=org_b).status_code == 403
