"""Multi-role (coach AND organizer): union access, ownership preserved, approve flow."""
from tests.db import client, TestSession
from app.models.user import User, UserRole
from app.models.club_athlete import Club
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


def _admin():
    return _mkuser("mradmin@kwf.org", "admin")


def _roles_of(email):
    s = TestSession()
    u = s.query(User).filter_by(email=email).first()
    from app.core.permissions import user_roles
    rs = set(user_roles(s, u))
    s.close()
    return rs


def test_coach_only_trainer_yes_organizer_no():
    h = _mkuser("mronlycoach@kwf.org", "coach")
    assert _roles_of("mronlycoach@kwf.org") == {"coach"}
    # trainer powers: athletes.manage present, tournaments.manage absent
    perms = client.get("/api/auth/permissions", headers=h).json()["permissions"]
    assert "athletes.manage" in perms and "tournaments.manage" not in perms
    # organizer cabinet equivalent denied
    assert client.post("/api/tournaments", json={"name": "Nope Cup", "start_date": "2026-12-01"},
                       headers=h).status_code == 403


def test_organizer_only_mirror():
    h = _mkuser("mronlyorg@kwf.org", "organizer")
    assert _roles_of("mronlyorg@kwf.org") == {"organizer"}
    assert client.post("/api/tournaments", json={"name": "Yes Cup", "start_date": "2026-12-01"},
                       headers=h).status_code == 200
    # no trainer schedule powers without a club/coach role
    assert client.get("/api/schedule", headers=h).status_code == 403


def test_dual_union_and_ownership():
    coach_h = _mkuser("mrdual@kwf.org", "coach")
    adm = _admin()
    me = TestSession().query(User).filter_by(email="mrdual@kwf.org").first()
    # admin adds organizer as SECONDARY role (primary stays coach)
    r = client.put(f"/api/admin/users/{me.id}", json={"add_roles": ["organizer"]}, headers=adm)
    TestSession().close()
    assert r.status_code == 200, r.text
    assert set(r.json()["roles"]) == {"coach", "organizer"}
    assert _roles_of("mrdual@kwf.org") == {"coach", "organizer"}
    perms = client.get("/api/auth/permissions", headers=coach_h).json()["permissions"]
    assert "athletes.manage" in perms and "tournaments.manage" in perms
    # union in action: trainer endpoint + organizer endpoint both pass
    assert client.get("/api/schedule", headers=coach_h).status_code in (200, 404)
    assert client.post("/api/tournaments", json={"name": "Dual Cup", "start_date": "2026-12-01"},
                       headers=coach_h).status_code == 200
    # ownership still enforced both ways
    org2 = _mkuser("mrdual2@kwf.org", "organizer")
    tid2 = client.post("/api/tournaments", json={"name": "Other Cup", "start_date": "2026-12-01"},
                       headers=org2).json()["id"]
    assert client.put(f"/api/tournaments/{tid2}", json={"name": "Hijacked"}, headers=coach_h).status_code == 403


def test_approve_preserves_coach_and_assets():
    coach_h = _mkuser("mrappr@kwf.org", "coach")
    adm = _admin()
    # coach owns a club + athlete BEFORE approval
    s = TestSession()
    me = s.query(User).filter_by(email="mrappr@kwf.org").first()
    club = Club(name="Keep Club", country="KZ", city="A", coach_name="C", owner_id=me.id)
    s.add(club)
    s.commit()
    s.close()
    assert client.post("/api/auth/request-organizer", json={"org_name": "Keep Org"}, headers=coach_h).status_code == 200
    reqs = client.get("/api/admin/organizer-requests", headers=adm).json()["items"]
    rid = [x for x in reqs if x["org_name"] == "Keep Org"][0]["id"]
    assert client.post(f"/api/admin/organizer-requests/{rid}/decision?approve=true",
                       headers=adm).json()["status"] == "approved"
    me = client.get("/api/auth/me", headers=coach_h).json()
    assert me["role"] == "coach" and set(me["roles"]) == {"coach", "organizer"}
    # assets intact: club still owned, schedule still available
    clubs = client.get("/api/clubs?mine=true", headers=coach_h).json()["items"]
    assert any(c["name"] == "Keep Club" for c in clubs)
    assert client.get("/api/schedule", headers=coach_h).status_code == 200


def test_schedule_scoping():
    coach_h = _mkuser("mrsched@kwf.org", "coach")
    s = TestSession()
    me = s.query(User).filter_by(email="mrsched@kwf.org").first()
    club = Club(name="Sched Club", country="KZ", city="A", coach_name="C", owner_id=me.id)
    s.add(club)
    other = Club(name="Other Club", country="KZ", city="B", coach_name="X", owner_id=999999)
    s.add(other)
    s.commit()
    cid, ocid = club.id, other.id
    s.close()
    body = {"club_id": cid, "title": "Morning", "starts_at": "2026-12-01T09:00:00Z"}
    assert client.post("/api/schedule", json=body, headers=coach_h).status_code == 200
    # foreign club -> 403
    assert client.post("/api/schedule", json={**body, "club_id": ocid}, headers=coach_h).status_code == 403
    # bad interval -> 400
    bad = {**body, "ends_at": "2026-12-01T08:00:00Z"}
    assert client.post("/api/schedule", json=bad, headers=coach_h).status_code == 400
    items = client.get("/api/schedule", headers=coach_h).json()["items"]
    assert len(items) == 1 and items[0]["title"] == "Morning"
    sid = items[0]["id"]
    assert client.put(f"/api/schedule/{sid}", json={**body, "title": "Evening"}, headers=coach_h).status_code == 200
    assert client.delete(f"/api/schedule/{sid}", headers=coach_h).status_code == 200
    assert client.get("/api/schedule", headers=coach_h).json()["items"] == []
    # athlete role cannot touch schedule at all
    ath = _mkuser("mrschedath@kwf.org", "athlete")
    assert client.get("/api/schedule", headers=ath).status_code == 403
