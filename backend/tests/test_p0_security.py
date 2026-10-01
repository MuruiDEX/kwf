"""P0 regression net: ownership scope, finish idempotency/correction, public/protected split.

Written BEFORE the fix (must show red), implementation must turn them green
without breaking the existing 23 tests.
"""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password

_N = [0]


def _mkuser(role):
    _N[0] += 1
    email = f"p0{_N[0]}_{role}@kwf.org"
    if role in ("organizer", "admin"):
        s = TestSession()
        s.add(User(email=email, password_hash=hash_password("pw123456"), full_name=role, role=role))
        s.commit()
        s.close()
    else:
        client.post("/api/auth/register", json={"email": email, "password": "pw123456",
                                                "full_name": role, "role": role})
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _tournament(org, name):
    tid = client.post("/api/tournaments", json={"name": name, "city": "A", "country": "KZ",
                                                "start_date": "2026-12-01", "tatami_count": 1},
                      headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18, "age_max": 40,
                            "weight_min": 60, "weight_max": 70}, headers=org).json()["id"]
    return tid, cat


def _athlete(org, last, weight=68.0):
    return client.post("/api/athletes", json={"first_name": "P0", "last_name": last, "gender": "male",
                                              "birth_year": 2000, "weight_kg": weight,
                                              "country": "KZ"}, headers=org).json()["id"]


def _reg(org, tid, cat, last, weight=68.0):
    aid = _athlete(org, last, weight)
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": cat}, headers=org).json()["id"]
    return aid, rid


def test_organizer_cannot_mutate_foreign_tournament():
    org_a, org_b = _mkuser("organizer"), _mkuser("organizer")
    tid, cat = _tournament(org_a, "P0 Foreign Cup")
    aid, rid = _reg(org_a, tid, cat, "Foreign0")

    # all cross-tournament mutations must be forbidden
    assert client.post(f"/api/tournaments/{tid}/categories",
                       json={"name": "Foreign Cat", "gender": "male"}, headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/registrations",
                       json={"athlete_id": aid, "category_id": cat}, headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/weigh-in/{rid}",
                       json={"weigh_in_kg": 65}, headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/check-in/{rid}",
                       json={"checked_in": True}, headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/status",
                       json={"status": "registration"}, headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/schedule/generate", headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/validate/autofix", headers=org_b).status_code == 403
    assert client.get(f"/api/tournaments/{tid}/export/participants.csv", headers=org_b).status_code == 403
    assert client.post("/api/documents/issue",
                       params={"athlete_id": aid, "tournament_id": tid}, headers=org_b).status_code == 403
    # public detail page still open
    assert client.get(f"/api/tournaments/{tid}").status_code == 200


def test_public_reads_stay_open():
    org = _mkuser("organizer")
    tid, cat = _tournament(org, "P0 Public Cup")
    _reg(org, tid, cat, "Public0")
    _reg(org, tid, cat, "Public1")
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    assert client.get("/api/tournaments").status_code == 200
    assert client.get(f"/api/tournaments/{tid}").status_code == 200
    assert client.get(f"/api/tournaments/{tid}/brackets").status_code == 200
    assert client.get(f"/api/tournaments/{tid}/results").status_code == 200
    assert client.get(f"/api/tournaments/{tid}/report").status_code == 200
    assert client.get(f"/api/tournaments/{tid}/live").status_code == 200
    assert client.get(f"/api/tournaments/{tid}/validate").status_code == 200
    assert client.get(f"/api/tournaments/{tid}/conflicts").status_code == 200
    assert client.get("/api/rankings").status_code == 200
    assert client.get("/api/athletes").status_code == 200
    assert client.get("/api/news").status_code == 200


def test_registrations_weighin_redacted_for_anonymous():
    org = _mkuser("organizer")
    tid, cat = _tournament(org, "P0 Redact Cup")
    _aid, rid = _reg(org, tid, cat, "Redact0")
    assert client.post(f"/api/tournaments/{tid}/weigh-in/{rid}",
                       json={"weigh_in_kg": 65}, headers=org).status_code == 200
    client.cookies.clear()  # TestClient keeps the login cookie: drop it for a true anonymous read
    anon = [r for r in client.get(f"/api/tournaments/{tid}/registrations").json()["items"] if r["id"] == rid][0]
    assert anon["weigh_in_kg"] is None, "exact weight is PII, must be hidden from anonymous"
    staff = [r for r in client.get(f"/api/tournaments/{tid}/registrations", headers=org).json()["items"]
             if r["id"] == rid][0]
    assert staff["weigh_in_kg"] == 65


def test_finish_scoped_to_owner_but_referee_global():
    org_a, org_b, ref = _mkuser("organizer"), _mkuser("organizer"), _mkuser("referee")
    tid, cat = _tournament(org_a, "P0 Scope Cup")
    for i in ("Scope0", "Scope1", "Scope2", "Scope3"):
        _reg(org_a, tid, cat, i)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org_a)
    br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    m = [x for x in br if x["round"] == 1 and x["status"] != "bye"][0]
    # foreign organizer cannot finish
    r = client.post(f"/api/tournaments/matches/{m['id']}/finish",
                    json={"winner_id": m["a"], "score_a": 1, "score_b": 0}, headers=org_b)
    assert r.status_code == 403, r.text
    # referee (official) can
    r = client.post(f"/api/tournaments/matches/{m['id']}/finish",
                    json={"winner_id": m["a"], "score_a": 1, "score_b": 0}, headers=ref)
    assert r.status_code == 200, r.text


def test_finish_idempotent_and_correction():
    org, ref = _mkuser("organizer"), _mkuser("referee")
    tid, cat = _tournament(org, "P0 Idem Cup")
    for i in ("Idem0", "Idem1", "Idem2", "Idem3"):
        _reg(org, tid, cat, i)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    semi = [x for x in br if x["round"] == 1 and x["status"] != "bye"][0]
    a, b = semi["a"], semi["b"]
    body = {"winner_id": a, "score_a": 2, "score_b": 0}
    assert client.post(f"/api/tournaments/matches/{semi['id']}/finish", json=body, headers=ref).status_code == 200
    # repeat identical finish: idempotent, must not corrupt downstream slot
    r = client.post(f"/api/tournaments/matches/{semi['id']}/finish", json=body, headers=ref)
    assert r.status_code == 200, r.text
    nxt = [x for x in client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
           if x["id"] == r.json()["next"]][0]
    assert list(filter(None, (nxt["a"], nxt["b"]))).count(a) == 1
    # correction to the other winner before downstream finished: downstream slot fixed
    r = client.post(f"/api/tournaments/matches/{semi['id']}/finish",
                    json={"winner_id": b, "score_a": 0, "score_b": 3}, headers=ref)
    assert r.status_code == 200, r.text
    nxt = [x for x in client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
           if x["id"] == r.json()["next"]][0]
    assert b in (nxt["a"], nxt["b"]) and a not in (nxt["a"], nxt["b"])
    # finish downstream, then correction must be blocked (would create conflict)
    assert client.post(f"/api/tournaments/matches/{nxt['id']}/finish",
                       json={"winner_id": b, "score_a": 1, "score_b": 0}, headers=ref).status_code == 200
    r = client.post(f"/api/tournaments/matches/{semi['id']}/finish",
                    json={"winner_id": a, "score_a": 5, "score_b": 0}, headers=ref)
    assert r.status_code == 409, r.text


def test_create_tournament_rejects_live_status():
    org = _mkuser("organizer")
    r = client.post("/api/tournaments", json={"name": "P0 Sneaky Cup", "start_date": "2026-12-01",
                                              "status": "live"}, headers=org)
    assert r.status_code == 422, r.text


def test_register_long_password_rejected():
    r = client.post("/api/auth/register", json={"email": "p0long@kwf.org", "password": "x" * 100,
                                                "full_name": "long", "role": "public"})
    assert r.status_code == 400, r.text


def test_import_partial_errors_keep_good_rows():
    org = _mkuser("organizer")
    tid, cat = _tournament(org, "P0 Import Cup")
    before = len(client.get(f"/api/tournaments/{tid}/registrations").json()["items"])
    rows = (f"first_name,last_name,gender,birth_year,weight_kg,category_id\n"
            f"Imp,Good0,male,2000,68,{cat}\n"
            f"Broken,,male,2000,68,{cat}\n"
            f"Imp,Good1,male,2000,68,{cat}\n")
    r = client.post(f"/api/tournaments/{tid}/registrations/import",
                    files={"file": ("imp.csv", rows, "text/csv")}, headers=org)
    assert r.status_code == 200, r.text
    assert r.json()["imported"] == 2 and len(r.json()["errors"]) == 1, r.text
    after = len(client.get(f"/api/tournaments/{tid}/registrations").json()["items"])
    assert after - before == 2, "good rows before a bad row must survive (savepoint per row)"


def test_news_slug_immutable_on_update():
    org = _mkuser("organizer")
    slug = f"p0-news-{_N[0]}"
    nid = client.post("/api/news", json={"title": "P0 news", "slug": slug,
                                         "excerpt": "e", "body": "b"}, headers=org).json()["id"]
    r = client.put(f"/api/news/{nid}", json={"title": "P0 news upd", "slug": "hijacked",
                                             "excerpt": "e", "body": "b"}, headers=org)
    assert r.status_code == 200, r.text
    assert client.get(f"/api/news/{slug}").status_code == 200
    assert client.get("/api/news/hijacked").status_code == 404


def test_create_athlete_unknown_club_rejected():
    org = _mkuser("organizer")
    r = client.post("/api/athletes", json={"first_name": "P0", "last_name": "NoClub",
                                           "gender": "male", "birth_year": 2000,
                                           "weight_kg": 68, "club_id": 999999}, headers=org)
    assert r.status_code == 400, r.text
