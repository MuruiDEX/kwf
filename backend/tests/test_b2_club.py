"""B2: public club profile (TDD).

Contract (B2 planning):
- GET /api/clubs/{id}: header + paginated roster + athlete_count +
  upcoming_tournaments (<=5, future upcoming/registration only) +
  recent_results (<=5 finished, batched medals, no N+1) + full-club titles.
- GET /api/clubs/{id}/schedule: public, future only, no note/coach_id,
  from/limit/offset, limit 1..50 default 20, 422 beyond, 404 unknown club.
- Privacy: NEVER owner_id/user_id/created_by/email/phone/address/
  coach_id/note/birth_year/exact weight. coach_name stays (free text).
- 0 migrations, 0 dependencies.
"""
from datetime import datetime, timedelta, timezone

from sqlalchemy import event

from tests.db import client, TestSession, engine
from tests.test_p2 import auth_headers
from app.models.user import User
from app.models.club_athlete import Club, TrainingSession


def _org():
    return auth_headers("organizer")


def _mk_club(org, name="B2 Dojo"):
    r = client.post("/api/clubs", json={
        "name": name, "country": "KZ", "city": "Pavlodar",
        "coach_name": "Serik"}, headers=org)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _mk_athlete(org, club_id, last, birth=2014, weight=35.0):
    r = client.post("/api/athletes", json={
        "first_name": "B2", "last_name": last, "gender": "male",
        "birth_year": birth, "weight_kg": weight, "country": "KZ",
        "club_id": club_id}, headers=org)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _mk_tournament(org, name, start="2026-11-01", age_min=10, age_max=12,
                   wmin=30, wmax=40):
    tid = client.post("/api/tournaments", json={
        "name": name, "city": "Pavlodar", "country": "KZ",
        "start_date": start}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories", json={
        "name": "U12-35", "gender": "male", "age_min": age_min,
        "age_max": age_max, "weight_min": wmin,
        "weight_max": wmax}, headers=org).json()["id"]
    return tid, cat


def _reg(org, tid, cat, aid):
    r = client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat},
                    headers=org)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _finish_tournament(org, ref_headers, tid, winner_aid):
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    for m in br:
        if m["status"] != "bye" and m["status"] != "finished" and m["a"] and m["b"]:
            # winner must be a participant; force our champion where present
            w = winner_aid if winner_aid in (m["a"], m["b"]) else m["a"]
            client.post(f"/api/tournaments/matches/{m['id']}/finish",
                        json={"winner_id": w, "score_a": 1, "score_b": 0},
                        headers=ref_headers)
    # second pass for finals appearing after semifinals
    br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    for m in br:
        if m["status"] not in ("bye", "finished") and m["a"] and m["b"]:
            w = winner_aid if winner_aid in (m["a"], m["b"]) else m["a"]
            client.post(f"/api/tournaments/matches/{m['id']}/finish",
                        json={"winner_id": w, "score_a": 1, "score_b": 0},
                        headers=ref_headers)
    for st in ("registration", "live", "finished"):
        r = client.post(f"/api/tournaments/{tid}/status",
                        json={"status": st}, headers=org)
        assert r.status_code == 200, (st, r.text)


def test_detail_shape_and_privacy():
    org = _org()
    cid = _mk_club(org)
    _mk_athlete(org, cid, "Kid")
    client.cookies.clear()
    body = client.get(f"/api/clubs/{cid}").json()
    assert set(body) >= {"id", "name", "country", "city", "coach",
                         "athletes", "athlete_count", "titles",
                         "upcoming_tournaments", "recent_results"}
    for banned in ("owner_id", "user_id", "created_by", "email", "phone",
                   "address", "coach_id", "note", "birth_year", "weight"):
        assert banned not in body, banned
        assert all(banned not in a for a in body["athletes"]), banned
    assert body["coach"] == "Serik"  # free-text coach_name stays public
    assert body["athlete_count"] == 1
    assert client.get("/api/clubs/999999").status_code == 404


def test_roster_pagination():
    org = _org()
    cid = _mk_club(org, name="B2 Big Dojo")
    for i in range(3):
        _mk_athlete(org, cid, f"Pag{i}")
    client.cookies.clear()
    p1 = client.get(f"/api/clubs/{cid}?athletes_limit=2&athletes_offset=0").json()
    assert len(p1["athletes"]) == 2 and p1["athlete_count"] == 3
    p2 = client.get(f"/api/clubs/{cid}?athletes_limit=2&athletes_offset=2").json()
    assert len(p2["athletes"]) == 1 and p2["athlete_count"] == 3
    assert {a["id"] for a in p1["athletes"]} .isdisjoint({a["id"] for a in p2["athletes"]})


def test_upcoming_only_future():
    org = _org()
    cid = _mk_club(org, name="B2 Up Dojo")
    aid = _mk_athlete(org, cid, "Up")
    t1, c1 = _mk_tournament(org, "B2 Future Cup", start="2026-12-01")
    t2, c2 = _mk_tournament(org, "B2 Old Cup", start="2025-01-01")
    _reg(org, t1, c1, aid)
    _reg(org, t2, c2, aid)
    client.cookies.clear()
    up = client.get(f"/api/clubs/{cid}").json()["upcoming_tournaments"]
    ids = [t["id"] for t in up]
    assert t1 in ids and t2 not in ids
    assert len(up) <= 5
    assert all(set(t) >= {"id", "name", "city", "start_date", "status"} for t in up)
    dates = [t["start_date"] for t in up]
    assert dates == sorted(dates)


def test_recent_results_batched_medals():
    org = _org()
    ref = auth_headers("referee")
    cid = _mk_club(org, name="B2 Med Dojo")
    aids = [_mk_athlete(org, cid, f"Med{i}") for i in range(4)]
    tids = []
    for i, start in enumerate(("2026-01-10", "2026-02-10", "2026-03-10")):
        tid, cat = _mk_tournament(org, f"B2 Past Cup {i}", start=start)
        for aid in aids:
            _reg(org, tid, cat, aid)
        _finish_tournament(org, ref, tid, aids[0])
        tids.append(tid)
    client.cookies.clear()
    body = client.get(f"/api/clubs/{cid}").json()
    recent = body["recent_results"]
    assert len(recent) == 3
    assert all(set(r) >= {"tournament_id", "tournament", "date",
                          "gold", "silver", "bronze"} for r in recent)
    assert sum(r["gold"] for r in recent) == 3
    assert body["titles"] >= 3  # full-club count, existing semantics


def test_recent_no_nplus1():
    org = _org()
    ref = auth_headers("referee")
    cid = _mk_club(org, name="B2 Perf Dojo")
    aids = [_mk_athlete(org, cid, f"Perf{i}") for i in range(4)]
    for i in range(3):
        tid, cat = _mk_tournament(org, f"B2 Perf Cup {i}",
                                  start=f"2026-0{i + 1}-10")
        for aid in aids:
            _reg(org, tid, cat, aid)
        _finish_tournament(org, ref, tid, aids[0])
    client.cookies.clear()
    calls = []

    def count(conn, cursor, statement, parameters, context, executemany):
        if statement.strip().upper().startswith("SELECT"):
            calls.append(1)

    event.listen(engine, "before_cursor_execute", count)
    try:
        assert client.get(f"/api/clubs/{cid}").status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", count)
    # 1 club + 1 roster page + 1 athlete_count + 1 titles + 1 upcoming +
    # 1 recent tids + ~3 batched podium queries + 1 owner card (Coach 2.0 P2):
    # must stay bounded (constant queries only — N+1 would scale with data)
    assert len(calls) <= 11, f"N+1 suspected: {len(calls)} SELECTs"


def test_schedule_public_safe():
    s = TestSession()
    coach_email = "b2schedcoach@kwf.org"
    from app.core.security import hash_password
    coach = User(email=coach_email, password_hash=hash_password("pw123456"),
                 full_name="B2 Coach", role="coach")
    s.add(coach)
    s.commit()
    club = Club(name="B2 Sched Dojo", country="KZ", city="Pavlodar",
                coach_name="B2 Coach", owner_id=coach.id)
    s.add(club)
    s.commit()
    now = datetime.now(timezone.utc)
    s.add(TrainingSession(club_id=club.id, coach_id=coach.id,
                          title="Future drill",
                          starts_at=now + timedelta(days=2),
                          ends_at=now + timedelta(days=2, hours=1),
                          note="SECRET internal note"))
    s.add(TrainingSession(club_id=club.id, coach_id=coach.id,
                          title="Past drill",
                          starts_at=now - timedelta(days=2),
                          ends_at=now - timedelta(days=2, hours=1),
                          note="old"))
    s.commit()
    cid = club.id
    s.close()
    client.cookies.clear()
    body = client.get(f"/api/clubs/{cid}/schedule").json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["title"] == "Future drill"
    # D2 P3: public items carry the group NAME (nullable); still no note/coach.
    assert set(item) <= {"id", "title", "starts_at", "ends_at", "group_id", "group"}
    for banned in ("note", "coach_id", "club_id"):
        assert banned not in item, banned
    assert set(body) >= {"items", "total", "limit", "offset"}
    assert body["limit"] == 20
    assert client.get(f"/api/clubs/{cid}/schedule?limit=51").status_code == 422
    assert client.get("/api/clubs/999999/schedule").status_code == 404


def _mk_sched_club(suffix, sessions):
    """Self-contained club+sessions via direct DB rows (coach-owned club
    cannot be built through the API: coaches lack clubs.manage)."""
    from app.core.security import hash_password
    s = TestSession()
    coach = User(email=f"b2sched{suffix}@kwf.org",
                 password_hash=hash_password("pw123456"),
                 full_name="B2 Coach", role="coach")
    s.add(coach)
    s.commit()
    club = Club(name=f"B2 Sched Dojo {suffix}", country="KZ",
                city="Pavlodar", coach_name="B2 Coach", owner_id=coach.id)
    s.add(club)
    s.commit()
    for title, delta_days, note in sessions:
        at = datetime.now(timezone.utc) + timedelta(days=delta_days)
        s.add(TrainingSession(club_id=club.id, coach_id=coach.id,
                              title=title, starts_at=at,
                              ends_at=at + timedelta(hours=1), note=note))
    s.commit()
    cid = club.id
    s.close()
    return cid


def test_schedule_public_safe():
    cid = _mk_sched_club("safe", [("Future drill", 2, "SECRET internal note"),
                                  ("Past drill", -2, "old")])
    client.cookies.clear()
    body = client.get(f"/api/clubs/{cid}/schedule").json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["title"] == "Future drill"
    # D2 P3: public items carry the group NAME (nullable); still no note/coach.
    assert set(item) <= {"id", "title", "starts_at", "ends_at", "group_id", "group"}
    for banned in ("note", "coach_id", "club_id"):
        assert banned not in item, banned
    assert set(body) >= {"items", "total", "limit", "offset"}
    assert body["limit"] == 20
    assert client.get(f"/api/clubs/{cid}/schedule?limit=51").status_code == 422
    assert client.get("/api/clubs/999999/schedule").status_code == 404


def test_schedule_from_filter():
    cid = _mk_sched_club("from", [("Near drill", 2, "n"),
                                  ("Far drill", 30, "n")])
    client.cookies.clear()
    far = (datetime.now(timezone.utc) + timedelta(days=10)).date().isoformat()
    body = client.get(f"/api/clubs/{cid}/schedule?from={far}").json()
    assert body["total"] == 1 and body["items"][0]["title"] == "Far drill"
    assert client.get(
        f"/api/clubs/{cid}/schedule?from=not-a-date").status_code == 400
