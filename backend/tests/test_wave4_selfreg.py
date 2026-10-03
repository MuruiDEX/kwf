"""Wave 4: athlete self-registration via identity link (claim)."""
from tests.db import client, TestSession
from app.models.user import User
from app.models.club_athlete import Athlete
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


def _setup(email="w4self@kwf.org", ath_email="w4selfath@kwf.org"):
    org = _mkuser(email, "organizer")
    coach = _mkuser("w4selfcoach@kwf.org", "coach")
    ath = _mkuser(ath_email, "athlete")
    tid = client.post("/api/tournaments", json={"name": "Self Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    mine = client.post("/api/athletes", json={"first_name": "Self", "last_name": "Kid",
                                             "gender": "male", "birth_year": 2000,
                                             "weight_kg": 68, "country": "KZ"},
                       headers=coach).json()["id"]
    other = client.post("/api/athletes", json={"first_name": "Other", "last_name": "Kid",
                                              "gender": "male", "birth_year": 2000,
                                              "weight_kg": 68, "country": "KZ"},
                        headers=coach).json()["id"]
    return org, coach, ath, tid, cat, mine, other


def test_claim_and_self_register():
    org, coach, ath, tid, cat, mine, other = _setup()
    # unclaimed: 403 with clear message
    r = client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": mine, "category_id": cat}, headers=ath)
    assert r.status_code == 403, r.text
    # claim unknown -> 404; claim ok
    assert client.post("/api/athletes/999999/claim", headers=ath).status_code == 404
    assert client.post(f"/api/athletes/{mine}/claim", headers=ath).json() == {"ok": True, "athlete_id": mine}
    # idempotent re-claim by same user
    assert client.post(f"/api/athletes/{mine}/claim", headers=ath).status_code == 200
    # self registration works
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": mine, "category_id": cat},
                      headers=ath).json()["id"]
    # duplicate -> 400
    assert client.post(f"/api/tournaments/{tid}/registrations",
                       json={"athlete_id": mine, "category_id": cat},
                       headers=ath).status_code == 400
    # foreign athlete -> 403 even though profile exists
    assert client.post(f"/api/tournaments/{tid}/registrations",
                       json={"athlete_id": other, "category_id": cat},
                       headers=ath).status_code == 403
    # invalid category -> 400
    assert client.post(f"/api/tournaments/{tid}/registrations",
                       json={"athlete_id": mine, "category_id": 999999},
                       headers=ath).status_code == 400
    # foreign tournament: athlete registers openly (same as coach rule)
    tid2 = client.post("/api/tournaments", json={"name": "Self Cup 2", "city": "B",
                                                 "country": "KZ", "start_date": "2026-12-02",
                                                 "tatami_count": 1}, headers=org).json()["id"]
    cat2 = client.post(f"/api/tournaments/{tid2}/categories",
                       json={"name": "M70", "gender": "male", "age_min": 18,
                             "age_max": 40, "weight_min": 60, "weight_max": 70},
                       headers=org).json()["id"]
    assert client.post(f"/api/tournaments/{tid2}/registrations",
                       json={"athlete_id": mine, "category_id": cat2},
                       headers=ath).status_code == 200
    # status visible to self, invisible to anonymous
    rows = client.get(f"/api/tournaments/{tid}/registrations", headers=ath).json()["items"]
    assert [x for x in rows if x["id"] == rid][0]["status"] == "approved"
    client.cookies.clear()
    anon = client.get(f"/api/tournaments/{tid}/registrations").json()["items"]
    assert all(x["status"] is None for x in anon)
    # withdraw own approved registration
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/status",
                       json={"status": "withdrawn"}, headers=ath).status_code == 200
    # withdrawn excluded from brackets
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    br = client.get(f"/api/tournaments/{tid}/brackets").json()
    got = set()
    for b in br:
        got |= {m["a"] for m in b["matches"]} | {m["b"] for m in b["matches"]}
    got.discard(None)
    assert mine not in got


def test_claim_conflicts():
    _, _, ath, _, _, mine, other = _setup("w4self2@kwf.org", "w4selfathB@kwf.org")
    ath2 = _mkuser("w4selfath2@kwf.org", "athlete")
    assert client.post(f"/api/athletes/{mine}/claim", headers=ath).status_code == 200
    # second user cannot steal the profile
    assert client.post(f"/api/athletes/{mine}/claim", headers=ath2).status_code == 409
    # user linked to one profile cannot claim another
    assert client.post(f"/api/athletes/{other}/claim", headers=ath).status_code == 400
    # second user CAN claim the free profile
    assert client.post(f"/api/athletes/{other}/claim", headers=ath2).status_code == 200


def test_bulk_status_and_locks():
    org, coach, _, _, _, _, _ = _setup("w4self3@kwf.org")
    tid = client.post("/api/tournaments", json={"name": "Bulk St Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    rids = []
    for i in range(2):
        aid = client.post("/api/athletes", json={"first_name": "Bs", "last_name": f"K{i}",
                                                "gender": "male", "birth_year": 2000,
                                                "weight_kg": 68, "country": "KZ"},
                          headers=coach).json()["id"]
        rids.append(client.post(f"/api/tournaments/{tid}/registrations",
                                json={"athlete_id": aid, "category_id": cat},
                                headers=coach).json()["id"])
    # bulk reject + unknown id
    r = client.post(f"/api/tournaments/{tid}/registrations/bulk-status",
                    json={"ids": rids + [999999], "status": "rejected",
                          "note": "docs"}, headers=org)
    assert r.status_code == 200, r.text
    assert r.json()["updated"] == rids
    assert r.json()["errors"] == [{"id": 999999, "error": "Not found"}]
    # foreign organizer -> 403
    org_b = _mkuser("w4selfB@kwf.org", "organizer")
    assert client.post(f"/api/tournaments/{tid}/registrations/bulk-status",
                       json={"ids": rids, "status": "approved"},
                       headers=org_b).status_code == 403
    # lock in live
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    client.post(f"/api/tournaments/{tid}/status", json={"status": "registration"}, headers=org)
    # brackets need >=2 approved: re-approve first
    client.post(f"/api/tournaments/{tid}/registrations/bulk-status",
                json={"ids": rids, "status": "approved"}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org)
    assert client.post(f"/api/tournaments/{tid}/registrations/bulk-status",
                       json={"ids": rids, "status": "approved"},
                       headers=org).status_code == 409
