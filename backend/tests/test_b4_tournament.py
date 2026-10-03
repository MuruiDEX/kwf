"""B4: tournament discovery completion — TDD.

- podium[].club_id additive, matches the real club, null without club.
- Existing podium contract intact (no keys removed/renamed).
- Roster exposes no banned PII.
- Catalog pagination: pages disjoint, total stable, ordering stable.
"""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password


def _org(email="b4disc@kwf.org"):
    s = TestSession()
    if not s.query(User).filter_by(email=email).first():
        s.add(User(email=email, password_hash=hash_password("pw123456"),
                   full_name="o", role="organizer"))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _tournament_with_bracket(org, name, n_athletes=4, club_id=None):
    tid = client.post("/api/tournaments", json={"name": name, "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aids = []
    for i in range(n_athletes):
        body = {"first_name": "B4", "last_name": f"Disc{i}",
                "gender": "male", "birth_year": 2000,
                "weight_kg": 68, "country": "KZ"}
        if club_id is not None:
            body["club_id"] = club_id
        aid = client.post("/api/athletes", json=body, headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=org)
    assert client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org).status_code == 200
    return tid, cat, aids


def _finish_all(org, tid):
    for _ in range(3):
        br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
        pending = [m for m in br if m["status"] not in ("bye", "finished") and m["a"] and m["b"]]
        if not pending:
            break
        m = pending[0]
        r = client.post(f"/api/tournaments/matches/{m['id']}/finish",
                        json={"winner_id": m["a"], "score_a": 1, "score_b": 0},
                        headers=org)
        assert r.status_code == 200, r.text


def test_podium_club_id_matches_real_club():
    org = _org()
    cid = client.post("/api/clubs", json={"name": "B4 Pod Club", "country": "KZ",
                                          "city": "A"}, headers=org).json()["id"]
    tid, _, _ = _tournament_with_bracket(org, "B4 Pod Cup", club_id=cid)
    _finish_all(org, tid)
    pod = client.get(f"/api/tournaments/{tid}/podium").json()
    assert pod, "finished bracket must yield podium"
    for p in pod:
        for spot in [p["gold"], p["silver"], *p["bronze"]]:
            if spot is None:
                continue
            assert spot["club_id"] == cid
            assert spot["club"] == "B4 Pod Club"


def test_podium_club_id_null_without_club():
    org = _org()
    tid, _, _ = _tournament_with_bracket(org, "B4 NoClub Cup")
    _finish_all(org, tid)
    pod = client.get(f"/api/tournaments/{tid}/podium").json()
    assert pod
    for p in pod:
        for spot in [p["gold"], p["silver"], *p["bronze"]]:
            if spot is None:
                continue
            assert spot["club_id"] is None
            assert spot["club"] == "—"


def test_podium_contract_intact():
    org = _org()
    tid, _, _ = _tournament_with_bracket(org, "B4 Shape Cup")
    _finish_all(org, tid)
    pod = client.get(f"/api/tournaments/{tid}/podium").json()
    assert pod
    p = pod[0]
    assert set(p) == {"category_id", "category", "gold", "silver", "bronze"}
    assert set(p["gold"]) == {"id", "name", "club", "club_id"}


def test_roster_no_banned_pii():
    org = _org()
    tid, _, _ = _tournament_with_bracket(org, "B4 Roster Cup")
    client.cookies.clear()  # drop login cookie for a true anonymous read
    rows = client.get(f"/api/tournaments/{tid}/registrations").json()["items"]
    assert rows
    # B1 contract: exact fields have no keys at all; gated fields keep
    # their keys with null values for anonymous readers.
    absent = {"birth_year", "weight", "seed", "user_id", "created_by"}
    nulled = {"weigh_in_kg", "status", "review_note"}
    for r in rows:
        assert not (absent & set(r)), absent & set(r)
        for k in nulled:
            assert r[k] is None, k


def test_catalog_pagination_disjoint_stable():
    org = _org("b4page@kwf.org")
    names = [f"B4 Page Cup {i:03d}" for i in range(5)]
    for i, n in enumerate(names):
        client.post("/api/tournaments", json={"name": n, "city": "Pg",
                                              "country": "KZ",
                                              "start_date": f"2026-12-{i + 1:02d}"},
                    headers=org)
    q = "B4 Page Cup"
    p1 = client.get("/api/tournaments", params={"q": q, "limit": 2, "offset": 0}).json()
    p2 = client.get("/api/tournaments", params={"q": q, "limit": 2, "offset": 2}).json()
    p3 = client.get("/api/tournaments", params={"q": q, "limit": 2, "offset": 4}).json()
    assert p1["total"] == p2["total"] == p3["total"] == 5
    ids1 = [t["id"] for t in p1["items"]]
    ids2 = [t["id"] for t in p2["items"]]
    ids3 = [t["id"] for t in p3["items"]]
    assert len(ids1) == 2 and len(ids2) == 2 and len(ids3) == 1
    assert not (set(ids1) & set(ids2) or set(ids1) & set(ids3) or set(ids2) & set(ids3))
    # ordering stable across reads (start_date ASC, ties broken deterministically)
    again = [t["id"] for t in client.get("/api/tournaments", params={"q": q, "limit": 5, "offset": 0}).json()["items"]]
    assert again == ids1 + ids2 + ids3
