"""B3: public athlete profile rank/stats/recent/medals (TDD).

Contract + ranking correction:
- rank = 1 + COUNT(points > mine) — ties share rank (100,100 -> #1,#1; 90 -> #3).
- ORDER BY points DESC, id ASC only stabilizes list order (rankings shape untouched).
- recent_results: max 5, start_date DESC then tournament_id DESC, place only
  for finished podium (upcoming/pending -> place None, no reg status leaked).
- medals: finished matches/categories only.
- stats: fights = wins+losses, win_rate = wins/fights (0 when 0),
  titles = finished championship count.
- Privacy: no birth_year/weight/user_id/created_by/reg status/weigh_in/review/codes.
- Perf: profile stays <= 10 SELECTs, no N+1.
"""
from sqlalchemy import event

from tests.db import client, engine
from tests.test_p2 import auth_headers


def _org():
    return auth_headers("organizer")


def _ref():
    return auth_headers("referee")


def _mk_athlete(org, last, birth=2014, weight=35.0):
    r = client.post("/api/athletes", json={
        "first_name": "B3", "last_name": last, "gender": "male",
        "birth_year": birth, "weight_kg": weight, "country": "KZ"},
        headers=org)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _mk_tournament(org, name, start="2026-11-01"):
    tid = client.post("/api/tournaments", json={
        "name": name, "city": "B3City", "country": "KZ",
        "start_date": start}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories", json={
        "name": "U12-35", "gender": "male", "age_min": 10,
        "age_max": 12, "weight_min": 30, "weight_max": 40},
        headers=org).json()["id"]
    return tid, cat


def _finish_all(org, ref, tid, winner_aid):
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    for _ in range(2):
        br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
        for m in br:
            if m["status"] not in ("bye", "finished") and m["a"] and m["b"]:
                w = winner_aid if winner_aid in (m["a"], m["b"]) else m["a"]
                client.post(f"/api/tournaments/matches/{m['id']}/finish",
                            json={"winner_id": w, "score_a": 1, "score_b": 0},
                            headers=ref)
    for st in ("registration", "live", "finished"):
        r = client.post(f"/api/tournaments/{tid}/status",
                        json={"status": st}, headers=org)
        assert r.status_code == 200, (st, r.text)


def _rank(aid):
    return client.get(f"/api/athletes/{aid}").json()["rank"]


def _prof(aid):
    return client.get(f"/api/athletes/{aid}").json()


def _roles(aids, champ):
    """Split finished-tournament athletes by record — seeding-agnostic.

    champ: (2 fights, 2-0, 1 title). Finalist: (2, 1-1). Semifinalists: (1, 0-1).
    Returns (champ_prof, finalist_prof, [semi_prof, semi_prof])."""
    profs = {a: _prof(a) for a in aids}
    fins = [a for a in aids if a != champ
            and profs[a]["stats"] == {"fights": 2, "win_rate": 0.5, "titles": 0}]
    semis = [a for a in aids if a != champ
             and profs[a]["stats"] == {"fights": 1, "win_rate": 0, "titles": 0}]
    assert len(fins) == 1 and len(semis) == 2, profs
    return profs[champ], profs[fins[0]], [profs[s] for s in semis]


def test_profile_rank_stats_recent_medals():
    # NOTE: the test DB is shared across modules, so rank is asserted
    # relationally. Rank is a pure function of own points, and each strict
    # step below is witnessed by our own athletes (16 > 3 > 0).
    org, ref = _org(), _ref()
    aids = [_mk_athlete(org, f"Champ{i}") for i in range(4)]
    champ = aids[0]
    tid, cat = _mk_tournament(org, "B3 Champ Cup")
    for aid in aids:
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=org)
    _finish_all(org, ref, tid, champ)
    client.cookies.clear()
    prof, fin, _ = _roles(aids, champ)
    assert isinstance(prof["rank"], int) and prof["rank"] >= 1
    assert prof["rank"] < fin["rank"]
    assert prof["stats"] == {"fights": 2, "win_rate": 1.0, "titles": 1}
    assert prof["medals"] == {"gold": 1, "silver": 0, "bronze": 0}
    assert len(prof["recent_results"]) == 1
    rec = prof["recent_results"][0]
    assert rec["tournament_id"] == tid and rec["place"] == 1
    assert set(rec) >= {"tournament_id", "tournament", "date", "category",
                        "result", "place"}
    for banned in ("birth_year", "weight", "user_id", "created_by",
                   "weigh_in_kg", "review_note", "status"):
        assert banned not in prof, banned


def test_rank_ties_share_rank():
    # Equal points ALWAYS share rank (rank is a pure function of points),
    # so these relations hold whatever other modules put in the shared DB:
    # champ(16) < finalist(3) < semifinalists(0 == 0).
    org, ref = _org(), _ref()
    aids = [_mk_athlete(org, f"Tie{i}") for i in range(4)]
    tid, cat = _mk_tournament(org, "B3 Tie Cup")
    for aid in aids:
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=org)
    _finish_all(org, ref, tid, aids[0])
    client.cookies.clear()
    prof, fin, semis = _roles(aids, aids[0])
    assert prof["rank"] < fin["rank"] < semis[0]["rank"]
    assert semis[0]["rank"] == semis[1]["rank"], \
        "equal points share one rank (1,1,3 semantics)"
    assert fin["medals"] == {"gold": 0, "silver": 1, "bronze": 0}
    assert semis[0]["medals"] == {"gold": 0, "silver": 0, "bronze": 1}
    fin_rec = [r for r in fin["recent_results"] if r["tournament_id"] == tid][0]
    assert fin_rec["place"] == 2
    # deterministic across repeated reads (stable ORDER BY tie-break)
    assert _rank(aids[0]) == prof["rank"]


def test_empty_athlete():
    org = _org()
    aid = _mk_athlete(org, "Empty")
    client.cookies.clear()
    prof = client.get(f"/api/athletes/{aid}").json()
    assert prof["history"] == []
    assert prof["recent_results"] == []
    assert prof["medals"] == {"gold": 0, "silver": 0, "bronze": 0}
    assert prof["stats"]["fights"] == 0 and prof["stats"]["win_rate"] == 0
    assert prof["age_group"] == "—" and prof["weight_class"] == "—"


def test_pending_only_no_place():
    org = _org()
    aid = _mk_athlete(org, "Pend")
    tid, cat = _mk_tournament(org, "B3 Pend Cup")
    reg = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": cat},
                      headers=org).json()
    client.post(f"/api/tournaments/{tid}/registrations/{reg['id']}/status",
                json={"status": "pending"}, headers=org)
    client.cookies.clear()
    prof = client.get(f"/api/athletes/{aid}").json()
    assert prof["recent_results"] == [] or all(
        r["place"] is None for r in prof["recent_results"])
    assert prof["medals"] == {"gold": 0, "silver": 0, "bronze": 0}


def test_profile_no_nplus1():
    org, ref = _org(), _ref()
    aid = _mk_athlete(org, "Perf")
    for i in range(5):
        tid, cat = _mk_tournament(org, f"B3 Perf Cup {i}",
                                  start=f"2026-0{i + 1}-10")
        others = [_mk_athlete(org, f"Perf{i}x{j}") for j in range(3)]
        for o in others + [aid]:
            client.post(f"/api/tournaments/{tid}/registrations",
                        json={"athlete_id": o, "category_id": cat},
                        headers=org)
        _finish_all(org, ref, tid, aid)
    client.cookies.clear()
    calls = []

    def count(conn, cursor, statement, parameters, context, executemany):
        if statement.strip().upper().startswith("SELECT"):
            calls.append(1)

    event.listen(engine, "before_cursor_execute", count)
    try:
        r = client.get(f"/api/athletes/{aid}")
        assert r.status_code == 200
        assert len(r.json()["recent_results"]) == 5
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert len(calls) <= 10, f"N+1 suspected: {len(calls)} SELECTs"
