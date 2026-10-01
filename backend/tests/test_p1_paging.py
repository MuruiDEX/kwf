"""P1: uniform pagination envelope {items, total, limit, offset}."""
from tests.db import client, TestSession
from tests.test_p2 import auth_headers


def test_envelope_shape_and_slicing():
    org = auth_headers()
    for i in range(3):
        client.post("/api/tournaments", json={"name": f"P1 Page Cup {i}", "start_date": "2026-12-01"},
                    headers=org)
    full = client.get("/api/tournaments").json()
    assert set(full) == {"items", "total", "limit", "offset"}
    assert full["total"] >= 3 and full["limit"] == 100 and full["offset"] == 0
    assert len(full["items"]) == full["total"]
    p1 = client.get("/api/tournaments?limit=2&offset=0").json()
    p2 = client.get("/api/tournaments?limit=2&offset=2").json()
    assert (p1["limit"], p1["offset"]) == (2, 0) and (p2["limit"], p2["offset"]) == (2, 2)
    assert [t["id"] for t in p1["items"]] + [t["id"] for t in p2["items"]] == \
        [t["id"] for t in full["items"]][:4][: len(p1["items"]) + len(p2["items"])]
    assert client.get("/api/tournaments?limit=9999").status_code == 422  # hard cap enforced
    assert client.get("/api/tournaments?offset=-1").status_code == 422
    assert client.get("/api/tournaments?limit=0").status_code == 422


def test_other_lists_paginated():
    org = auth_headers()
    assert set(client.get("/api/athletes?limit=5").json()) == {"items", "total", "limit", "offset"}
    assert set(client.get("/api/rankings?limit=5").json()) == {"items", "total", "limit", "offset"}
    assert set(client.get("/api/news?limit=5").json()) == {"items", "total", "limit", "offset"}
    assert client.get("/api/audit", headers=org).json()["limit"] == 100


def test_registrations_paginated():
    from tests.test_p2 import make_tournament
    org = auth_headers()
    tid, cat = make_tournament(org, name="P1 Regs Page Cup")
    for i in range(3):
        aid = client.post("/api/athletes", json={"first_name": "G", "last_name": f"Page{i}",
                                                 "gender": "male", "birth_year": 2000,
                                                 "weight_kg": 68}, headers=org).json()["id"]
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=org)
    page = client.get(f"/api/tournaments/{tid}/registrations?limit=2&offset=1", headers=org).json()
    assert page["total"] == 3 and len(page["items"]) == 2 and page["offset"] == 1
