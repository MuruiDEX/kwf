"""Coach 2.0 P3: public directory + coach profile (real data, allowlists)."""
import itertools
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password

_SEQ = itertools.count()


def _mkuser(email, role="public"):
    base, _, dom = email.partition("@")
    email = f"{base}+t{next(_SEQ)}@{dom}"
    s = TestSession()
    if not s.query(User).filter_by(email=email).first():
        s.add(User(email=email, password_hash=hash_password("pw123456"),
                   full_name=role, role=role))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _uid(headers):
    from app.core.security import decode_token
    return int(decode_token(headers["Authorization"].split(" ", 1)[1])["sub"])


def _setup(tag, public=True, city="Almaty"):
    coach = _mkuser(f"c2d{tag}@kwf.org", "coach")
    assert client.put("/api/auth/profile", json={"full_name": f"Coach {tag}", "city": city,
                                                "country": "KZ", "specialization": "Kids",
                                                "experience_years": 7,
                                                "is_public": public}, headers=coach).status_code == 200
    return coach


def test_directory_lists_only_public_with_allowlist():
    _setup("pub1")
    _setup("priv1", public=False)
    client.cookies.clear()
    body = client.get("/api/coaches").json()
    items = body["items"]
    assert all("@" not in str(i) for i in items)
    names = [i["name"] for i in items]
    assert "Coach pub1" in names and "Coach priv1" not in names
    assert set(items[0]) == {"user_id", "name", "city", "country", "specialization",
                             "avatar", "club", "athletes_count"}
    blob = str(items)
    for needle in ("password", "guardian", "birth", "weight", "permissions", "audit", "is_active"):
        assert needle not in blob, needle
    # pagination + filters
    assert client.get("/api/coaches", params={"limit": 1}).json()["limit"] == 1
    assert any(i["name"] == "Coach pub1"
               for i in client.get("/api/coaches", params={"q": "pub1"}).json()["items"])
    assert client.get("/api/coaches", params={"q": "priv1"}).json()["items"] == []
    assert any(i["name"] == "Coach pub1"
               for i in client.get("/api/coaches", params={"city": "Almaty"}).json()["items"])
    assert client.get("/api/coaches", params={"city": "Nowhere"}).json()["items"] == []
    assert client.get("/api/coaches", params={"limit": 501}).status_code == 422


def test_public_profile_real_data_and_404():
    coach = _setup("prof", city="Astana")
    uid = _uid(coach)
    club = client.post("/api/clubs/self", json={"name": "C2 Prof Club", "city": "Astana"},
                       headers=coach).json()["id"]
    aid = client.post("/api/athletes", json={"first_name": "C2P", "last_name": "Kid",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 34, "country": "KZ",
                                             "club_id": club}, headers=coach).json()["id"]
    gid = client.post("/api/groups", json={"club_id": club, "name": "Squad"}, headers=coach).json()["id"]
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": aid}, headers=coach).status_code == 200
    client.cookies.clear()
    body = client.get(f"/api/coaches/{uid}").json()
    assert body["name"] == "Coach prof" and body["city"] == "Astana"
    assert body["clubs"] and body["clubs"][0]["id"] == club
    assert body["groups"] and body["groups"][0]["member_count"] == 1
    assert body["stats"]["athletes"] == 1 and body["stats"]["groups"] == 1
    blob = str(body)
    for needle in ("@kwf.org", "password", "guardian", "birth_year", "weight_kg",
                   "permissions", "audit", "user_permissions"):
        assert needle not in blob, needle
    # achievements derive from a real finished final (1 title, 1 win)
    org = _mkuser("c2dorg@kwf.org", "organizer")
    tid = client.post("/api/tournaments", json={"name": "C2 Title Cup", "city": "A", "country": "KZ",
                                                "start_date": "2026-12-01", "tatami_count": 1},
                      headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "T40", "gender": "male", "age_min": 10, "age_max": 12,
                            "weight_min": 30, "weight_max": 40}, headers=org).json()["id"]
    aid2 = client.post("/api/athletes", json={"first_name": "C2P", "last_name": "Second",
                                              "gender": "male", "birth_year": 2015,
                                              "weight_kg": 34, "country": "KZ",
                                              "club_id": club}, headers=coach).json()["id"]
    for a in (aid, aid2):
        rid = client.post(f"/api/tournaments/{tid}/registrations",
                          json={"athlete_id": a, "category_id": cat}, headers=coach).json()["id"]
        assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/status",
                           json={"status": "approved"}, headers=org).status_code == 200
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    ms = [m for b in client.get(f"/api/tournaments/{tid}/brackets").json()
          for m in b["matches"] if m["a"] and m["b"] and not m["winner"]]
    assert client.post(f"/api/tournaments/matches/{ms[0]['id']}/finish",
                       json={"winner_id": aid, "score_a": 5, "score_b": 3},
                       headers=org).status_code == 200
    stats = client.get(f"/api/coaches/{uid}").json()["stats"]
    assert stats["titles"] == 1 and stats["wins"] == 1 and stats["tournaments"] == 1
    # private profile -> 404, unknown -> 404
    priv = _setup("profpriv", public=False)
    assert client.get(f"/api/coaches/{_uid(priv)}").status_code == 404
    assert client.get("/api/coaches/999999999").status_code == 404


def test_club_filters_and_groups_mine():
    coach = _setup("flt")
    cid = client.post("/api/clubs/self", json={"name": "C2 Filter Club", "city": "Shymkent",
                                               "country": "KZ"}, headers=coach).json()["id"]
    client.cookies.clear()
    assert any(c["id"] == cid for c in client.get("/api/clubs", params={"city": "Shymkent"}).json()["items"])
    assert all(c["id"] != cid for c in client.get("/api/clubs", params={"city": "Almaty"}).json()["items"])
    assert any(c["id"] == cid for c in client.get("/api/clubs", params={"country": "KZ"}).json()["items"])
    gid = client.post("/api/groups", json={"club_id": cid, "name": "Squad"}, headers=coach).json()["id"]
    mine = client.get("/api/groups/mine", headers=coach).json()
    assert [g["id"] for g in mine] == [gid]
    stranger = _mkuser("c2dstr@kwf.org", "coach")
    assert client.get("/api/groups/mine", headers=stranger).json() == []
    client.cookies.clear()
    assert client.get("/api/groups/mine").status_code == 401
