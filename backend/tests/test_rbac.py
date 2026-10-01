"""RBAC regression: roles -> defaults + admin grants -> ownership -> access.

Granular permissions are additive; ownership checks still scope resources.
"""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password

_N = [0]


def _mkuser(role="athlete"):
    _N[0] += 1
    email = f"rbac{_N[0]}_{role}@kwf.org"
    if role in ("organizer", "admin"):
        s = TestSession()
        s.add(User(email=email, password_hash=hash_password("pw123456"),
                   full_name=role, role=role))
        s.commit()
        s.close()
    else:
        r = client.post("/api/auth/register", json={
            "email": email, "password": "pw123456",
            "full_name": role, "role": role})
        assert r.status_code == 200, r.text
    r = client.post("/api/auth/login",
                    json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    s = TestSession()
    uid = s.query(User).filter_by(email=email).one().id
    s.close()
    return uid, {"Authorization": f"Bearer {r.json()['token']}"}


def _grant(admin_h, uid, *perms):
    r = client.put(f"/api/admin/users/{uid}",
                   json={"add_permissions": list(perms)}, headers=admin_h)
    assert r.status_code == 200, r.text
    return r.json()


def _tournament(h, name):
    return client.post("/api/tournaments", json={
        "name": name, "city": "A", "country": "KZ",
        "start_date": "2026-12-01", "tatami_count": 1}, headers=h).json()["id"]


def test_admin_can_grant_revoke_and_audit():
    _, admin_h = _mkuser("admin")
    uid, _ = _mkuser("coach")
    body = _grant(admin_h, uid, "tournaments.create", "tournaments.manage")
    assert "tournaments.create" in body["grants"]
    assert "tournaments.create" in body["effective"]
    r = client.put(f"/api/admin/users/{uid}",
                   json={"remove_permissions": ["tournaments.create"]},
                   headers=admin_h)
    assert r.status_code == 200
    assert "tournaments.create" not in r.json()["grants"]
    audit = client.get("/api/audit", headers=admin_h).json()["items"]
    assert any(a["entity"] == "user" and "tournaments.create" in a["action"]
               for a in audit)


def test_non_grantable_permission_rejected_even_for_admin():
    _, admin_h = _mkuser("admin")
    uid, _ = _mkuser("coach")
    for bad in ("roles.manage", "tournaments.manage_all",
                "organizer_requests.manage", "nope.unknown"):
        r = client.put(f"/api/admin/users/{uid}",
                       json={"add_permissions": [bad]}, headers=admin_h)
        assert r.status_code == 400, (bad, r.text)


def test_coach_cannot_manage_users_and_cannot_self_promote():
    _, admin_h = _mkuser("admin")
    uid, coach_h = _mkuser("coach")
    assert client.get("/api/admin/users", headers=coach_h).status_code == 403
    assert client.put(f"/api/admin/users/{uid}",
                      json={"role": "organizer"},
                      headers=coach_h).status_code == 403
    # no self-promotion at registration either
    assert client.post("/api/auth/register", json={
        "email": f"rbacesc{_N[0]}@kwf.org", "password": "pw123456",
        "role": "admin"}).status_code == 400


def test_admin_cannot_lock_self_out():
    uid, admin_h = _mkuser("admin")
    assert client.put(f"/api/admin/users/{uid}", json={"role": "coach"},
                      headers=admin_h).status_code == 400
    assert client.put(f"/api/admin/users/{uid}", json={"is_active": False},
                      headers=admin_h).status_code == 400


def test_coach_athlete_ownership():
    _, admin_h = _mkuser("admin")
    _, coach_h = _mkuser("coach")
    _, coach2_h = _mkuser("coach")
    aid = client.post("/api/athletes", json={
        "first_name": "RB", "last_name": "Own", "gender": "male",
        "birth_year": 2000, "weight_kg": 68}, headers=coach_h).json()["id"]
    # own -> 200
    assert client.put(f"/api/athletes/{aid}", json={
        "first_name": "RB", "last_name": "Own2", "gender": "male",
        "birth_year": 2000, "weight_kg": 69}, headers=coach_h).status_code == 200
    # foreign coach -> 403
    assert client.put(f"/api/athletes/{aid}", json={
        "first_name": "RB", "last_name": "Hijack", "gender": "male",
        "birth_year": 2000, "weight_kg": 69},
        headers=coach2_h).status_code == 403
    # athlete role has no athletes.manage at all -> 403
    _, ath_h = _mkuser("athlete")
    assert client.post("/api/athletes", json={
        "first_name": "X", "last_name": "Y",
        "gender": "male", "birth_year": 2000},
        headers=ath_h).status_code == 403


def test_coach_tournament_permission_flow():
    _, admin_h = _mkuser("admin")
    _, org_h = _mkuser("organizer")
    cuid, coach_h = _mkuser("coach")
    # without permission -> 403
    assert client.post("/api/tournaments", json={
        "name": "Coach Cup X", "start_date": "2026-12-01"},
        headers=coach_h).status_code == 403
    # create-only grant: can create, but cannot manage yet (explicit!)
    _grant(admin_h, cuid, "tournaments.create")
    tid = _tournament(coach_h, "Coach Cup Own")
    assert client.post(f"/api/tournaments/{tid}/categories", json={
        "name": "M70", "gender": "male"}, headers=coach_h).status_code == 403
    # with manage: own tournament manageable...
    _grant(admin_h, cuid, "tournaments.manage")
    assert client.post(f"/api/tournaments/{tid}/categories", json={
        "name": "M70", "gender": "male"}, headers=coach_h).status_code == 200
    # ...but foreign tournament stays forbidden (no manage_all)
    ftid = _tournament(org_h, "Foreign Cup RBAC")
    assert client.post(f"/api/tournaments/{ftid}/categories", json={
        "name": "Other Cat", "gender": "male"}, headers=coach_h).status_code == 403


def test_organizer_own_vs_foreign_and_admin_all():
    _, admin_h = _mkuser("admin")
    _, org_a = _mkuser("organizer")
    _, org_b = _mkuser("organizer")
    tid = _tournament(org_a, "Own Cup RBAC")
    assert client.post(f"/api/tournaments/{tid}/categories", json={
        "name": "M70", "gender": "male"}, headers=org_a).status_code == 200
    assert client.post(f"/api/tournaments/{tid}/categories", json={
        "name": "M70x", "gender": "male"}, headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/categories", json={
        "name": "M70a", "gender": "male"}, headers=admin_h).status_code == 200


def test_mine_filter_scopes_athletes_to_coach():
    _, coach_h = _mkuser("coach")
    _, coach2_h = _mkuser("coach")
    aid = client.post("/api/athletes", json={
        "first_name": "Mine", "last_name": "Test", "gender": "male",
        "birth_year": 2000, "weight_kg": 68}, headers=coach_h).json()["id"]
    mine = client.get("/api/athletes?mine=true", headers=coach_h).json()["items"]
    assert any(a["id"] == aid for a in mine)
    others = client.get("/api/athletes?mine=true", headers=coach2_h).json()["items"]
    assert all(a["id"] != aid for a in others)
    client.cookies.clear()  # shared jar keeps a login cookie: drop it for a true anonymous call
    assert client.get("/api/athletes?mine=true").status_code == 401


def test_my_permissions_endpoint():
    _, admin_h = _mkuser("admin")
    _, coach_h = _mkuser("coach")
    me = client.get("/api/auth/permissions", headers=coach_h).json()
    assert me["role"] == "coach"
    assert "athletes.manage" in me["permissions"]
    assert "tournaments.create" not in me["permissions"]
    assert "users.view" not in me["permissions"]
    adm = client.get("/api/auth/permissions", headers=admin_h).json()
    assert "roles.manage" in adm["permissions"]
    assert "tournaments.manage_all" in adm["permissions"]
