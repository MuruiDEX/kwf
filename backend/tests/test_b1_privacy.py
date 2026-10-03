"""B1: public serializers privacy + rate limits (TDD).

Contract (B1 planning):
- Public athlete list/detail/roster/rankings expose NO exact birth_year/weight_kg.
- Public uses derived age_group/weight_class from the athlete's latest
  relevant PUBLIC registration (approved only, newest tournament first).
  No approved regs -> "—"/"—" (never guess).
- Tournament created_by hidden from anonymous; ?mine=true for cabinets.
- Scoped exact access via GET /api/athletes/{id}/scoped (coach scope or self).
- Rate limits: athletes list 60/60, detail 120/60, clubs 60/60+120/60,
  rankings 60/60. Production auth limits untouched.
"""
from tests.db import client
from tests.test_p2 import auth_headers, make_tournament

THIS_YEAR = 2026


def _coach():
    return auth_headers("coach")


def _mk_athlete(coach, last="B1Kid", birth=2015, weight=35.0, **kw):
    body = {"first_name": "B1", "last_name": last, "gender": "male",
            "birth_year": birth, "weight_kg": weight, "country": "KZ"}
    body.update(kw)
    r = client.post("/api/athletes", json=body, headers=coach)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _mk_cat_tournament(org, name, age_min=10, age_max=12, wmin=30, wmax=40,
                       start="2026-11-01"):
    tid = client.post("/api/tournaments", json={
        "name": name, "city": "B1City", "country": "KZ",
        "start_date": start}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories", json={
        "name": "U12-35", "gender": "male", "age_min": age_min,
        "age_max": age_max, "weight_min": wmin,
        "weight_max": wmax}, headers=org).json()["id"]
    return tid, cat


def test_public_list_no_exact():
    coach = _coach()
    aid = _mk_athlete(coach)
    items = client.get("/api/athletes").json()["items"]
    row = [a for a in items if a["id"] == aid][0]
    assert "birth_year" not in row, "exact birth year must not leak in public list"
    assert "weight" not in row, "exact weight must not leak in public list"
    assert "user_id" not in row and "created_by" not in row
    # no approved regs yet -> fallback, never guess
    assert row["age_group"] == "—" and row["weight_class"] == "—"


def test_public_detail_no_exact():
    coach = _coach()
    org = auth_headers()
    aid = _mk_athlete(coach)
    tid, cat = _mk_cat_tournament(org, "B1 Detail Cup")
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aid, "category_id": cat}, headers=org)
    prof = client.get(f"/api/athletes/{aid}").json()
    assert "birth_year" not in prof and "weight" not in prof
    assert "user_id" not in prof and "created_by" not in prof
    assert prof["age_group"] == "U12"
    assert prof["weight_class"] == "30-40 кг"
    assert prof["first_name"] == "B1" and prof["history"]


def test_rankings_no_weight():
    coach = _coach()
    _mk_athlete(coach, last="B1Light", weight=35.0)
    _mk_athlete(coach, last="B1Heavy", weight=95.0)
    rows = client.get("/api/rankings").json()["items"]
    assert rows, "rankings must stay public"
    assert all("weight" not in r and "birth_year" not in r for r in rows)
    assert all("user_id" not in r and "created_by" not in r for r in rows)
    # weight filters still work (filter != exposure)
    ids = [r["id"] for r in client.get(
        "/api/rankings?weight_min=30&weight_max=40").json()["items"]]
    names = [r["name"] for r in client.get(
        "/api/rankings?weight_min=30&weight_max=40").json()["items"]]
    assert any("B1Light" in n for n in names)
    assert not any("B1Heavy" in n for n in names)
    assert ids  # filter path exercised


def test_roster_no_exact():
    coach = _coach()
    org = auth_headers()
    aid = _mk_athlete(coach, last="B1Roster")
    tid, cat = _mk_cat_tournament(org, "B1 Roster Cup")
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aid, "category_id": cat}, headers=org)
    client.cookies.clear()
    rows = client.get(f"/api/tournaments/{tid}/registrations").json()["items"]
    assert rows
    r = rows[0]
    for k in ("birth_year", "weight", "seed"):
        assert k not in r, f"{k} must not leak in public roster"
    assert r["age_group"] == "U12" and r["weight_class"] == "30-40 кг"
    assert r["weigh_in_kg"] is None
    assert r["status"] is None and r["review_note"] is None


def test_tournament_no_created_by_anon():
    org = auth_headers()
    tid, _ = make_tournament(org, name="B1 NoOwner Cup")
    client.cookies.clear()  # drop login cookie for a true anonymous read
    anon_list = client.get("/api/tournaments").json()["items"]
    anon_t = [t for t in anon_list if t["id"] == tid][0]
    assert "created_by" not in anon_t
    anon_detail = client.get(f"/api/tournaments/{tid}").json()
    assert "created_by" not in anon_detail
    # authenticated organizer keeps working (cabinet compat)
    own = client.get("/api/tournaments", headers=org).json()["items"]
    assert [t for t in own if t["id"] == tid][0]["created_by"] is not None
    # ?mine=true: own only for owner, 401 anonymous
    mine = client.get("/api/tournaments?mine=true", headers=org).json()["items"]
    assert mine and all(t["created_by"] is not None for t in mine)
    assert client.get("/api/tournaments?mine=true").status_code == 401


def test_scoped_coach_exact():
    coach = _coach()
    other = _coach()
    aid = _mk_athlete(coach, last="B1Scoped")
    r = client.get(f"/api/athletes/{aid}/scoped", headers=coach)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["birth_year"] == 2015 and body["weight"] == 35.0
    assert "created_by" not in body and "user_id" not in body
    # foreign coach (no scope) -> denied, never 200 with exact
    assert client.get(f"/api/athletes/{aid}/scoped", headers=other).status_code in (403, 404)
    # anonymous -> 401
    client.cookies.clear()
    assert client.get(f"/api/athletes/{aid}/scoped").status_code == 401


def test_self_exact_unchanged():
    coach = _coach()
    aid = _mk_athlete(coach, last="B1Self")
    client.post("/api/auth/register", json={
        "email": "b1self@kwf.org", "password": "pw123456",
        "full_name": "B1 Self", "role": "athlete"})
    lr = client.post("/api/auth/login", json={
        "email": "b1self@kwf.org", "password": "pw123456"})
    ath = {"Authorization": f"Bearer {lr.json()['token']}"}
    assert client.post(f"/api/athletes/{aid}/claim", headers=ath).status_code == 200
    me = client.get("/api/me/athlete", headers=ath).json()
    assert me["birth_year"] == 2015 and me["weight"] == 35.0


def test_serializer_consistency():
    coach = _coach()
    org = auth_headers()
    aid = _mk_athlete(coach, last="B1Same")
    tid, cat = _mk_cat_tournament(org, "B1 Same Cup")
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aid, "category_id": cat}, headers=org)
    li = [a for a in client.get("/api/athletes").json()["items"] if a["id"] == aid][0]
    de = client.get(f"/api/athletes/{aid}").json()
    ro = client.get(f"/api/tournaments/{tid}/registrations").json()["items"][0]
    se = client.get("/api/search?q=B1Same").json()
    assert li["name"] == de["name"] == ro["athlete"]
    assert li["age_group"] == de["age_group"] == ro["age_group"] == "U12"
    assert li["weight_class"] == de["weight_class"] == ro["weight_class"] == "30-40 кг"
    assert se["athletes"] and all(
        set(h) <= {"id", "name"} for h in se["athletes"])
    for blob in (li, de, ro):
        assert "birth_year" not in blob and "weight" not in blob and "seed" not in blob
        assert "user_id" not in blob and "created_by" not in blob


def test_bands_latest_relevant_only():
    coach = _coach()
    org = auth_headers()
    aid = _mk_athlete(coach, last="B1Bands", birth=2012, weight=55.0)
    old_tid, old_cat = _mk_cat_tournament(
        org, "B1 Old Cup", age_min=10, age_max=12, wmin=30, wmax=40,
        start="2025-05-01")
    new_tid, new_cat = _mk_cat_tournament(
        org, "B1 New Cup", age_min=13, age_max=15, wmin=50, wmax=60,
        start="2026-06-01")
    client.post(f"/api/tournaments/{old_tid}/registrations",
                json={"athlete_id": aid, "category_id": old_cat}, headers=org)
    new_reg = client.post(f"/api/tournaments/{new_tid}/registrations",
                          json={"athlete_id": aid, "category_id": new_cat},
                          headers=org).json()
    # bands follow the NEWER tournament, not the higher registration id alone
    prof = client.get(f"/api/athletes/{aid}").json()
    assert prof["age_group"] == "U15" and prof["weight_class"] == "50-60 кг"
    # withdrawn newest -> falls back to older APPROVED (never guess, never withdrawn)
    client.post(f"/api/tournaments/{new_tid}/registrations/{new_reg['id']}/status",
                json={"status": "withdrawn"}, headers=org)
    prof2 = client.get(f"/api/athletes/{aid}").json()
    assert prof2["age_group"] == "U12" and prof2["weight_class"] == "30-40 кг"


def test_bands_pending_only_fallback():
    coach = _coach()
    org = auth_headers()
    aid = _mk_athlete(coach, last="B1Pend")
    tid, cat = _mk_cat_tournament(org, "B1 Pend Cup")
    reg = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": cat},
                      headers=org).json()
    client.post(f"/api/tournaments/{tid}/registrations/{reg['id']}/status",
                json={"status": "pending"}, headers=org)
    prof = client.get(f"/api/athletes/{aid}").json()
    assert prof["age_group"] == "—" and prof["weight_class"] == "—"


def test_no_parent_implied():
    # logged-in but unrelated users get nothing exact through any B1 path.
    # B5: foreign users get 404 (no oracle, no codes) on athlete documents.
    coach = _coach()
    owner = _coach()
    aid = _mk_athlete(owner, last="B1Foreign")
    assert client.get(f"/api/athletes/{aid}/scoped", headers=coach).status_code in (403, 404)
    assert "birth_year" not in client.get(f"/api/athletes/{aid}").json()
    r = client.get(f"/api/athletes/{aid}/documents", headers=coach)
    assert r.status_code == 404
    assert "code" not in r.text


def test_rate_limits_new():
    for _ in range(60):
        assert client.get("/api/athletes").status_code == 200
    assert client.get("/api/athletes").status_code == 429
    for _ in range(60):
        assert client.get("/api/clubs").status_code == 200
    assert client.get("/api/clubs").status_code == 429
    for _ in range(60):
        assert client.get("/api/rankings").status_code == 200
    assert client.get("/api/rankings").status_code == 429


def test_rate_limit_detail_generous():
    coach = _coach()
    aid = _mk_athlete(coach, last="B1Rate")
    for _ in range(61):
        assert client.get(f"/api/athletes/{aid}").status_code == 200


def test_pagination_max_locked():
    assert client.get("/api/athletes?limit=501").status_code == 422
    assert client.get("/api/rankings?limit=501").status_code == 422
