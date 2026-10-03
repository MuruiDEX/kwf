"""Wave 3: referee assignment — owner-only mutate, referee read-only view."""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password


def _mkuser(email, role):
    s = TestSession()
    if not s.query(User).filter_by(email=email).first():
        s.add(User(email=email, password_hash=hash_password("pw123456"),
                   full_name=email.split("@")[0], role=role))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _tid(org, name="Ref Cup"):
    return client.post("/api/tournaments", json={"name": name, "city": "A",
                                                 "country": "KZ", "start_date": "2026-12-01",
                                                 "tatami_count": 2}, headers=org).json()["id"]


def test_assign_reassign_unassign_happy_path():
    org = _mkuser("w3ref_org@kwf.org", "organizer")
    ref = _mkuser("w3ref_ref@kwf.org", "referee")
    ref_id = TestSession().query(User).filter_by(email="w3ref_ref@kwf.org").first().id
    TestSession().close()
    tid = _tid(org)
    tatamis = client.get(f"/api/tournaments/{tid}/tatamis", headers=org).json()
    assert len(tatamis) == 2 and tatamis[0]["referee"] is None
    taid = tatamis[0]["id"]
    # available referees list contains ours
    refs = client.get("/api/referees", headers=org).json()
    assert any(x["id"] == ref_id for x in refs)
    # assign
    r = client.post(f"/api/tournaments/{tid}/tatamis/{taid}/referee",
                    json={"referee_id": ref_id}, headers=org)
    assert r.status_code == 200 and r.json()["referee_id"] == ref_id
    assert client.get(f"/api/tournaments/{tid}/tatamis", headers=org).json()[0]["referee_id"] == ref_id
    # referee sees the assignment
    mine = client.get("/api/tournaments/referee/assignments", headers=ref).json()
    assert len(mine) == 1 and mine[0]["tatami_id"] == taid
    assert mine[0]["tournament_id"] == tid
    # reassign to another referee
    ref2 = _mkuser("w3ref_ref2@kwf.org", "referee")
    ref2_id = TestSession().query(User).filter_by(email="w3ref_ref2@kwf.org").first().id
    TestSession().close()
    r = client.post(f"/api/tournaments/{tid}/tatamis/{taid}/referee",
                    json={"referee_id": ref2_id}, headers=org)
    assert r.json()["referee_id"] == ref2_id
    assert client.get("/api/tournaments/referee/assignments", headers=ref).json() == []
    # unassign
    r = client.post(f"/api/tournaments/{tid}/tatamis/{taid}/referee",
                    json={"referee_id": None}, headers=org)
    assert r.json()["referee_id"] is None


def test_assignment_guards():
    org = _mkuser("w3ref_org2@kwf.org", "organizer")
    org_b = _mkuser("w3ref_orgB@kwf.org", "organizer")
    ref = _mkuser("w3ref_refB@kwf.org", "referee")
    coach = _mkuser("w3ref_coach@kwf.org", "coach")
    ref_id = TestSession().query(User).filter_by(email="w3ref_refB@kwf.org").first().id
    TestSession().close()
    tid = _tid(org, name="Ref Cup B")
    taid = client.get(f"/api/tournaments/{tid}/tatamis", headers=org).json()[0]["id"]
    body = {"referee_id": ref_id}
    url = f"/api/tournaments/{tid}/tatamis/{taid}/referee"
    # foreign organizer -> 403
    assert client.post(url, json=body, headers=org_b).status_code == 403
    # coach -> 403 (no tournaments.manage)
    assert client.post(url, json=body, headers=coach).status_code == 403
    # referee cannot self-assign (or assign anyone) -> 403
    assert client.post(url, json=body, headers=ref).status_code == 403
    # guest list -> 401
    client.cookies.clear()
    assert client.get(f"/api/tournaments/{tid}/tatamis").status_code == 401
    # non-referee user as target -> 400
    coach_id = TestSession().query(User).filter_by(email="w3ref_coach@kwf.org").first().id
    TestSession().close()
    assert client.post(url, json={"referee_id": coach_id}, headers=org).status_code == 400
    # unknown tatami -> 404
    assert client.post(f"/api/tournaments/{tid}/tatamis/999999/referee",
                       json=body, headers=org).status_code == 404
    # assignments view requires referee (coach -> 403)
    assert client.get("/api/tournaments/referee/assignments", headers=coach).status_code == 403
