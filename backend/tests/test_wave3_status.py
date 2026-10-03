"""Wave 3: registration status lifecycle (pending/approved/rejected/withdrawn)."""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password


def _mkuser(email, role):
    s = TestSession()
    if not s.query(User).filter_by(email=email).first():
        s.add(User(email=email, password_hash=hash_password("pw123456"),
                   full_name=role, role=role))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _setup(email="w3stat@kwf.org", n_ath=2):
    org = _mkuser(email, "organizer")
    coach = _mkuser("w3statcoach@kwf.org", "coach")
    tid = client.post("/api/tournaments", json={"name": "Status Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aids, rids = [], []
    for i in range(n_ath):
        aid = client.post("/api/athletes",
                          json={"first_name": "St", "last_name": f"A{i}",
                                "gender": "male", "birth_year": 2000,
                                "weight_kg": 68, "country": "KZ"},
                          headers=coach).json()["id"]
        aids.append(aid)
        rid = client.post(f"/api/tournaments/{tid}/registrations",
                          json={"athlete_id": aid, "category_id": cat},
                          headers=coach).json()["id"]
        rids.append(rid)
    return org, coach, tid, cat, aids, rids


def test_lifecycle_and_visibility():
    org, coach, tid, cat, aids, rids = _setup()
    # new registrations default to approved (previous auto-accept preserved)
    rows = client.get(f"/api/tournaments/{tid}/registrations", headers=org).json()["items"]
    assert all(r["status"] == "approved" for r in rows)
    # coach sees status of own athletes, anonymous sees none
    own = client.get(f"/api/tournaments/{tid}/registrations", headers=coach).json()["items"]
    assert all(r["status"] == "approved" for r in own)
    client.cookies.clear()
    anon = client.get(f"/api/tournaments/{tid}/registrations").json()["items"]
    assert all(r["status"] is None for r in anon)
    # owner rejects with note
    r = client.post(f"/api/tournaments/{tid}/registrations/{rids[0]}/status",
                    json={"status": "rejected", "note": "over age"}, headers=org)
    assert r.status_code == 200, r.text
    rows = client.get(f"/api/tournaments/{tid}/registrations", headers=org).json()["items"]
    row = [x for x in rows if x["id"] == rids[0]][0]
    assert row["status"] == "rejected" and row["review_note"] == "over age"
    # filter works
    filt = client.get(f"/api/tournaments/{tid}/registrations?status=rejected",
                      headers=org).json()["items"]
    assert [x["id"] for x in filt] == [rids[0]]
    assert client.get(f"/api/tournaments/{tid}/registrations?status=bogus",
                      headers=org).status_code == 400
    # re-approve
    assert client.post(f"/api/tournaments/{tid}/registrations/{rids[0]}/status",
                       json={"status": "approved"}, headers=org).status_code == 200


def test_guards_and_locks():
    org, coach, tid, cat, aids, rids = _setup("w3stat2@kwf.org")
    url = f"/api/tournaments/{tid}/registrations/{rids[0]}/status"
    # foreign organizer / coach-approve / athlete -> 403
    org_b = _mkuser("w3statB@kwf.org", "organizer")
    assert client.post(url, json={"status": "rejected"}, headers=org_b).status_code == 403
    assert client.post(url, json={"status": "rejected"}, headers=coach).status_code == 403
    ath = _mkuser("w3statath@kwf.org", "athlete")
    assert client.post(url, json={"status": "approved"}, headers=ath).status_code == 403
    # coach CAN withdraw own athlete
    assert client.post(url, json={"status": "withdrawn"}, headers=coach).status_code == 200
    # coach cannot withdraw foreign athlete
    coach2 = _mkuser("w3statcoach2@kwf.org", "coach")
    assert client.post(url, json={"status": "withdrawn"}, headers=coach2).status_code == 403
    # bad status value -> 422, unknown reg -> 404
    assert client.post(url, json={"status": "nope"}, headers=org).status_code == 422
    assert client.post(f"/api/tournaments/{tid}/registrations/999999/status",
                       json={"status": "approved"}, headers=org).status_code == 404
    # lock once live (re-approve the withdrawn entry first so brackets exist)
    assert client.post(url, json={"status": "approved"}, headers=org).status_code == 200
    client.post(f"/api/tournaments/{tid}/status", json={"status": "registration"}, headers=org)
    # need brackets for live: register already done (2 athletes) -> generate
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    # finish requirements for live->... live needs brackets only
    assert client.post(f"/api/tournaments/{tid}/status", json={"status": "live"}, headers=org).status_code == 200
    assert client.post(url, json={"status": "approved"}, headers=org).status_code == 409


def test_rejected_excluded_from_brackets():
    org, coach, tid, cat, aids, rids = _setup("w3stat3@kwf.org", n_ath=4)
    client.post(f"/api/tournaments/{tid}/registrations/{rids[0]}/status",
                json={"status": "rejected"}, headers=org)
    client.post(f"/api/tournaments/{tid}/registrations/{rids[1]}/status",
                json={"status": "withdrawn"}, headers=coach)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    br = client.get(f"/api/tournaments/{tid}/brackets").json()
    assert len(br) == 1
    got = {m["a"] for m in br[0]["matches"]} | {m["b"] for m in br[0]["matches"]}
    got.discard(None)
    assert got == set(aids[2:])
