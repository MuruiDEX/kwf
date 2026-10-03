"""Wave 6: controlled bracket correction — positive/negative/integrity matrix."""
from tests.db import client, TestSession
from app.models.user import User
from app.models.competition import BracketMatch
from app.models.misc import AuditLog
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


def _setup(email="w6cor@kwf.org", n_ath=4, name="Correct Cup"):
    org = _mkuser(email, "organizer")
    tid = client.post("/api/tournaments", json={"name": name, "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aids = []
    for i in range(n_ath):
        aid = client.post("/api/athletes", json={"first_name": "Cx", "last_name": f"K{i}",
                                                "gender": "male", "birth_year": 2000,
                                                "weight_kg": 68, "country": "KZ"},
                          headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    # spare approved athlete registered AFTER generation: in-category but in
    # no bracket slot — the realistic correction target (no double-booking).
    spare = client.post("/api/athletes", json={"first_name": "Cx", "last_name": "Spare",
                                              "gender": "male", "birth_year": 2000,
                                              "weight_kg": 68, "country": "KZ"},
                        headers=org).json()["id"]
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": spare, "category_id": cat}, headers=org)
    br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    return org, tid, cat, aids, spare, br


def _r1_pending(br):
    return [m for m in br if m["round"] == 1 and m["status"] == "scheduled"
            and m["a"] and m["b"] and not m["winner"]]


def test_positive_correction_with_audit():
    org, tid, cat, aids, spare, br = _setup()
    m = _r1_pending(br)[0]
    old_a, old_b = m["a"], m["b"]
    r = client.post(f"/api/tournaments/matches/{m['id']}/correct",
                    json={"athlete_a_id": old_a, "athlete_b_id": spare,
                          "reason": "seeding typo"}, headers=org)
    assert r.status_code == 200, r.text
    j = r.json()["match"]
    assert (j["a"], j["b"]) == (old_a, spare)
    assert j["status"] == "scheduled" and j["winner"] is None
    # bracket reflects it, nothing else moved
    br2 = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    got = [x for x in br2 if x["id"] == m["id"]][0]
    assert (got["a"], got["b"]) == (old_a, spare)
    assert len(br2) == len(br)
    # audit row with before/after + reason
    rows = TestSession().query(AuditLog).filter_by(entity="match", entity_id=m["id"]).all()
    TestSession().close()
    assert rows, "correction must be audited"
    assert str(old_b) in rows[-1].action and str(spare) in rows[-1].action
    assert "seeding typo" in rows[-1].action


def test_negative_auth_and_scope():
    org, tid, cat, aids, spare, br = _setup("w6cor2@kwf.org", name="Correct Cup 2")
    m = _r1_pending(br)[0]
    body = {"athlete_a_id": m["a"], "athlete_b_id": spare, "reason": "seeding typo"}
    url = f"/api/tournaments/matches/{m['id']}/correct"
    client.cookies.clear()
    assert client.post(url, json=body).status_code == 401
    for role, email in [("athlete", "w6nath@kwf.org"), ("coach", "w6ncoach@kwf.org"),
                        ("referee", "w6nref@kwf.org")]:
        h = _mkuser(email, role)
        assert client.post(url, json=body, headers=h).status_code == 403, role
    org_b = _mkuser("w6corB@kwf.org", "organizer")
    assert client.post(url, json=body, headers=org_b).status_code == 403
    assert client.post("/api/tournaments/matches/999999/correct",
                       json=body, headers=org).status_code == 404


def test_negative_invariants():
    org, tid, cat, aids, spare, br = _setup("w6cor3@kwf.org", name="Correct Cup 3")
    m = _r1_pending(br)[0]
    url = f"/api/tournaments/matches/{m['id']}/correct"
    good = {"athlete_a_id": m["a"], "athlete_b_id": spare, "reason": "seeding typo"}
    # schema violations -> 422; same athlete twice is a bracket invariant -> 409
    assert client.post(url, json={"athlete_a_id": m["a"], "athlete_b_id": m["a"],
                                  "reason": "seeding typo"}, headers=org).status_code == 409
    assert client.post(url, json={"athlete_a_id": m["a"], "athlete_b_id": spare,
                                  "reason": "x"}, headers=org).status_code == 422
    # unknown athlete -> 422
    assert client.post(url, json={"athlete_a_id": m["a"], "athlete_b_id": 999999,
                                  "reason": "seeding typo"}, headers=org).status_code == 422
    # athlete from another category -> 409
    cat2 = client.post(f"/api/tournaments/{tid}/categories",
                       json={"name": "M80", "gender": "male", "age_min": 18,
                             "age_max": 40, "weight_min": 80, "weight_max": 90},
                       headers=org).json()["id"]
    outsider = client.post("/api/athletes", json={"first_name": "Cx", "last_name": "Out",
                                                  "gender": "male", "birth_year": 2000,
                                                  "weight_kg": 85, "country": "KZ"},
                           headers=org).json()["id"]
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": outsider, "category_id": cat2}, headers=org)
    assert client.post(url, json={"athlete_a_id": m["a"], "athlete_b_id": outsider,
                                  "reason": "seeding typo"}, headers=org).status_code == 409
    # duplicate placement (spare is elsewhere after we place them) -> 409
    assert client.post(url, json=good, headers=org).status_code == 200
    other = [x for x in _r1_pending(client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"])
             if x["id"] != m["id"]][0]
    assert client.post(f"/api/tournaments/matches/{other['id']}/correct",
                       json={"athlete_a_id": other["a"], "athlete_b_id": spare,
                             "reason": "second try"}, headers=org).status_code == 409
    # finished match -> 409 and stays untouched
    fin = client.post(f"/api/tournaments/matches/{other['id']}/finish",
                      json={"winner_id": other["a"], "score_a": 1, "score_b": 0}, headers=org)
    assert fin.status_code == 200
    assert client.post(f"/api/tournaments/matches/{other['id']}/correct",
                       json={"athlete_a_id": other["a"], "athlete_b_id": m["a"],
                             "reason": "too late"}, headers=org).status_code == 409
    row = TestSession().get(BracketMatch, other["id"])
    TestSession().close()
    assert row.winner_id == other["a"]
    # bye matches (auto winners propagated at generation) -> 409.
    # Deterministic setup: 3 athletes in a size-4 bracket always leaves byes.
    org2 = _mkuser("w6byorg@kwf.org", "organizer")
    tid2 = client.post("/api/tournaments", json={"name": "Bye Cup", "city": "A",
                                                 "country": "KZ", "start_date": "2026-12-01",
                                                 "tatami_count": 1}, headers=org2).json()["id"]
    catb = client.post(f"/api/tournaments/{tid2}/categories",
                       json={"name": "M70", "gender": "male", "age_min": 18,
                             "age_max": 40, "weight_min": 60, "weight_max": 70},
                       headers=org2).json()["id"]
    for i in range(3):
        ba = client.post("/api/athletes", json={"first_name": "By", "last_name": f"E{i}",
                                                "gender": "male", "birth_year": 2000,
                                                "weight_kg": 68, "country": "KZ"},
                         headers=org2).json()["id"]
        client.post(f"/api/tournaments/{tid2}/registrations",
                    json={"athlete_id": ba, "category_id": catb}, headers=org2)
    client.post(f"/api/tournaments/{tid2}/brackets/generate", headers=org2)
    byes = [x for x in client.get(f"/api/tournaments/{tid2}/brackets").json()[0]["matches"]
            if x["status"] == "bye"]
    assert byes, "size-4 bracket with 3 athletes must contain byes"
    assert client.post(f"/api/tournaments/matches/{byes[0]['id']}/correct",
                       json={"athlete_a_id": aids[0], "athlete_b_id": spare,
                             "reason": "bye edit"}, headers=org2).status_code == 409


def test_negative_round_and_tournament_stage():
    org, tid, cat, aids, spare, br = _setup("w6cor4@kwf.org", name="Correct Cup 4")
    # deeper round (scheduled, awaiting winners) -> 409, never written directly
    deep = [m for m in br if m["round"] > 1][0]
    assert client.post(f"/api/tournaments/matches/{deep['id']}/correct",
                       json={"athlete_a_id": aids[0], "athlete_b_id": spare,
                             "reason": "deep edit"}, headers=org).status_code == 409
    # finished tournament locks everything
    m = _r1_pending(br)[0]
    url = f"/api/tournaments/matches/{m['id']}/correct"
    client.post(f"/api/tournaments/{tid}/status", json={"status": "registration"}, headers=org)
    client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org)
    # finish all to allow close
    for _ in range(3):
        cur = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
        pend = [x for x in cur if x["status"] not in ("bye", "finished") and x["a"] and x["b"]]
        if not pend:
            break
        client.post(f"/api/tournaments/matches/{pend[0]['id']}/finish",
                    json={"winner_id": pend[0]["a"], "score_a": 1, "score_b": 0}, headers=org)
    assert client.post(f"/api/tournaments/{tid}/status", json={"status": "finished"}, headers=org).status_code == 200
    assert client.post(url, json={"athlete_a_id": m["a"], "athlete_b_id": spare,
                                  "reason": "too late"}, headers=org).status_code == 409


def test_integrity_sequential_conflicts_and_no_partial_state():
    org, tid, cat, aids, spare, br = _setup("w6cor5@kwf.org", name="Correct Cup 5")
    m = _r1_pending(br)[0]
    url = f"/api/tournaments/matches/{m['id']}/correct"
    # two conflicting corrections in a row: last wins, both audited, no corruption
    assert client.post(url, json={"athlete_a_id": m["a"], "athlete_b_id": spare,
                                  "reason": "first fix"}, headers=org).status_code == 200
    assert client.post(url, json={"athlete_a_id": spare, "athlete_b_id": m["a"],
                                  "reason": "second fix"}, headers=org).status_code == 200
    rows = TestSession().query(AuditLog).filter_by(entity="match", entity_id=m["id"]).all()
    TestSession().close()
    assert len(rows) == 2
    got = [x for x in client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
           if x["id"] == m["id"]][0]
    assert (got["a"], got["b"]) == (spare, m["a"])
    assert got["status"] == "scheduled" and got["winner"] is None
    # failed correction leaves zero trace (atomic): bad athlete changes nothing
    before = (got["a"], got["b"])
    assert client.post(url, json={"athlete_a_id": got["a"], "athlete_b_id": 999999,
                                  "reason": "bad target"}, headers=org).status_code == 422
    got2 = [x for x in client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
            if x["id"] == m["id"]][0]
    assert (got2["a"], got2["b"]) == before
