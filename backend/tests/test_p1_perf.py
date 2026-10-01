"""P1: N+1 regression — fixed query budgets regardless of row counts.

Budgets (measured P1 after batching, 8 regs scale; generous headroom included):
  registrations <= 5, athlete profile <= 8, club detail <= 5,
  results <= 8, report <= 12, tournament detail <= 5.
"""
from sqlalchemy import event
from tests.db import client, TestSession, engine
from tests.test_p2 import auth_headers

_COUNT = []


@event.listens_for(engine, "before_cursor_execute")
def _count(conn, cursor, statement, params, context, executemany):
    _COUNT.append(1)


def _get(path, headers=None):
    del _COUNT[:]
    r = client.get(path, headers=headers)
    assert r.status_code == 200, (path, r.status_code, r.text[:200])
    return r, len(_COUNT)


def test_query_budgets():
    org, ref = auth_headers(), auth_headers("referee")
    tid = client.post("/api/tournaments", json={"name": "P1 Perf Cup", "city": "A", "country": "KZ",
                                                "start_date": "2026-12-01", "tatami_count": 1},
                      headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18, "age_max": 40,
                            "weight_min": 60, "weight_max": 70}, headers=org).json()["id"]
    aids = []
    for i in range(8):
        aid = client.post("/api/athletes", json={"first_name": "Q", "last_name": f"Perf{i}",
                                                 "gender": "male", "birth_year": 2000,
                                                 "weight_kg": 68, "country": "KZ"},
                          headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)

    _, n = _get(f"/api/tournaments/{tid}/registrations", org)
    assert n <= 5, f"registrations: {n} queries"
    _, n = _get(f"/api/athletes/{aids[0]}")
    assert n <= 8, f"athlete profile: {n} queries"
    _, n = _get(f"/api/tournaments/{tid}/results")
    assert n <= 8, f"results: {n} queries"
    _, n = _get(f"/api/tournaments/{tid}/report")
    assert n <= 12, f"report: {n} queries"
    _, n = _get(f"/api/tournaments/{tid}")
    assert n <= 5, f"tournament detail: {n} queries"
