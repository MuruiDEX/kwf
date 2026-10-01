"""Profiles + rankings filters (§16, §17, §48)."""
from tests.test_p2 import client, auth_headers, make_tournament

def test_athlete_profile_history():
    org, ref = auth_headers(), auth_headers("referee")
    tid, cat = make_tournament(org, name="P5 Prof Cup")
    aids = []
    for i in range(4):
        aid = client.post("/api/athletes", json={"first_name": "P", "last_name": f"Prof{i}", "gender": "male",
                                                 "birth_year": 2000, "weight_kg": 68, "country": "KZ"}, headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations", json={"athlete_id": aid, "category_id": cat}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    semi = [m for m in br if m["round"] == 1 and m["status"] != "bye"][0]
    w = semi["a"]
    nxt = client.post(f"/api/tournaments/matches/{semi['id']}/finish",
                      json={"winner_id": w, "score_a": 1, "score_b": 0}, headers=ref).json()["next"]
    client.post(f"/api/tournaments/matches/{nxt}/finish", json={"winner_id": w, "score_a": 2, "score_b": 0}, headers=ref)
    prof = client.get(f"/api/athletes/{w}").json()
    assert prof["name"].startswith("P Prof") and prof["wins"] == 2
    assert prof["history"][0]["result"] == "champion"
    loser = client.get(f"/api/athletes/{semi['b']}").json()
    assert loser["history"][0]["result"] in ("semifinalist", "participant")
    assert client.get("/api/athletes/999999").status_code == 404

def test_club_detail_and_rankings_filters():
    org = auth_headers()
    cid = client.post("/api/clubs", json={"name": "P5 Club", "country": "KZ", "city": "A"}, headers=org).json()["id"]
    light = client.post("/api/athletes", json={"first_name": "L", "last_name": "Light", "gender": "female",
                                               "birth_year": 2001, "weight_kg": 55, "country": "KZ", "club_id": cid}, headers=org).json()["id"]
    heavy = client.post("/api/athletes", json={"first_name": "H", "last_name": "Heavy", "gender": "male",
                                               "birth_year": 2000, "weight_kg": 95, "country": "KZ", "club_id": cid}, headers=org).json()["id"]
    club = client.get(f"/api/clubs/{cid}").json()
    assert club["name"] == "P5 Club" and len(club["athletes"]) == 2 and club["titles"] == 0
    # weight filter excludes heavy
    ids = [r["id"] for r in client.get("/api/rankings?weight_min=50&weight_max=60").json()["items"]]
    assert light in ids and heavy not in ids
    # gender filter
    ids = [r["id"] for r in client.get("/api/rankings?gender=female").json()["items"]]
    assert light in ids and heavy not in ids
    # country filter with no match
    assert client.get("/api/rankings?country=XX").json() == {"items": [], "total": 0, "limit": 100, "offset": 0}
