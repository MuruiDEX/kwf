"""Tournament lifecycle (§38 publish flow): ordered transitions with guards."""
from tests.test_p2 import client, auth_headers, make_tournament

def test_status_flow_with_guards():
    org, ref = auth_headers(), auth_headers("referee")
    tid, cat = make_tournament(org, name="P6 Flow Cup")
    # skip ahead / go back rejected
    assert client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org).status_code == 400
    # registration step ok
    assert client.post(f"/api/tournaments/{tid}/status", json={"status": "registration"}, headers=org).json()["status"] == "registration"
    # live without brackets rejected
    r = client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org)
    assert r.status_code == 400 and "сеток" in r.json()["detail"]
    # build minimal bracket
    aids = []
    for i in range(2):
        aid = client.post("/api/athletes", json={"first_name": "F", "last_name": f"Flow{i}", "gender": "male",
                                                 "birth_year": 2000, "weight_kg": 68}, headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations", json={"athlete_id": aid, "category_id": cat}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    client.post(f"/api/tournaments/{tid}/schedule/generate", headers=org)
    assert client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org).json()["status"] == "live"
    # finished with pending fights rejected (size-4 => final pending)
    r = client.post(f"/api/tournaments/{tid}/status", json={"status": "finished"}, headers=org)
    assert r.status_code == 400 and "незаверш" in r.json()["detail"]
    # finish all pending fights, then close
    for m in client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]:
        if m["status"] not in ("bye", "finished") and m["a"] and m["b"]:
            client.post(f"/api/tournaments/matches/{m['id']}/finish",
                        json={"winner_id": m["a"], "score_a": 1, "score_b": 0}, headers=ref)
    # final may have appeared after semifinal... finish whatever remains
    for _ in range(3):
        pending = [m for m in client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
                   if m["status"] not in ("bye", "finished") and m["a"] and m["b"]]
        if not pending:
            break
        m = pending[0]
        client.post(f"/api/tournaments/matches/{m['id']}/finish",
                    json={"winner_id": m["a"], "score_a": 1, "score_b": 0}, headers=ref)
    assert client.post(f"/api/tournaments/{tid}/status", json={"status": "finished"}, headers=org).json()["status"] == "finished"
    # backward move rejected
    assert client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org).status_code == 400
    actions = [a["action"] for a in client.get("/api/audit", headers=org).json()["items"]]
    assert "status -> finished" in actions
