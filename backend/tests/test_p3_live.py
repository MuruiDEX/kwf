"""P3: live snapshot carries athlete names in one batched response (TV debt)."""
from tests.db import client
from tests.test_p2 import auth_headers, make_tournament


def test_live_snapshot_has_names():
    org = auth_headers()
    tid, cat = make_tournament(org, name="P3 Live Cup")
    aids = []
    for i in range(4):
        aid = client.post("/api/athletes", json={"first_name": "L", "last_name": f"Live{i}",
                                                 "gender": "male", "birth_year": 2000,
                                                 "weight_kg": 68}, headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    client.post(f"/api/tournaments/{tid}/schedule/generate", headers=org)
    live = client.get(f"/api/tournaments/{tid}/live").json()
    assert set(live) == {"live", "queue"}
    assert len(live["queue"]) > 0
    decided = [m for m in live["queue"] if m["a"] and m["b"]]
    assert decided, "expected decided semifinal pairings in the queue"
    for m in decided:
        assert m["a_name"] and m["b_name"], "TV needs names, not bare IDs"
