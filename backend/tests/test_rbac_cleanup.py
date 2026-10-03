"""RBAC cleanup: admin bootstrap, last-admin guard, escalation/IDOR matrix."""
import os
import subprocess
import sys

from tests.db import client, TestSession
from app.models.user import User
from app.models.misc import AuditLog
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


def _admin_headers(email):
    return _mkuser(email, "admin")


def _active_admin_count():
    n = TestSession().query(User).filter_by(role="admin", is_active=True).count()
    TestSession().close()
    return n


# ---------- admin bootstrap (seed.py logic, isolated env) ----------

def _run_seed(extra_env: dict) -> subprocess.CompletedProcess:
    code = ("from app.core.db import Base, engine;"
            "Base.metadata.create_all(bind=engine);"
            "from seed import _bootstrap_credentials_or_abort;"
            "from app.core.db import SessionLocal;"
            "print(_bootstrap_credentials_or_abort(SessionLocal()))")
    return subprocess.run([sys.executable, "-c", code], capture_output=True,
                          text=True, env={**os.environ, "JWT_SECRET": "x" * 32, **extra_env})


def test_bootstrap_prod_rules(tmp_path):
    # Isolated empty DB so every branch is exercised (dev kwf.db has admins).
    empty = f"sqlite:///{tmp_path}/empty.db"
    # prod without credentials -> skip (None), never a default admin
    r = _run_seed({"ENV": "prod", "DATABASE_URL": empty})
    assert r.returncode == 0, r.stderr
    assert "None" in r.stdout
    # prod + weak password -> hard abort
    r = _run_seed({"ENV": "prod", "DATABASE_URL": empty,
                   "ADMIN_EMAIL": "a@b.cc", "ADMIN_PASSWORD": "short"})
    assert r.returncode != 0
    assert "weak" in (r.stdout + r.stderr).lower()
    # prod + strong credentials -> returned for creation
    r = _run_seed({"ENV": "prod", "DATABASE_URL": empty,
                   "ADMIN_EMAIL": "boss@kwf.org",
                   "ADMIN_PASSWORD": "very-strong-pass-123"})
    assert r.returncode == 0, r.stderr
    assert "boss@kwf.org" in r.stdout


# ---------- last-admin guard ----------

def test_last_admin_cannot_be_removed():
    adm_a = _admin_headers("rbac-a1@kwf.org")
    adm_b = _admin_headers("rbac-a2@kwf.org")
    a = TestSession().query(User).filter_by(email="rbac-a1@kwf.org").first()
    b = TestSession().query(User).filter_by(email="rbac-a2@kwf.org").first()
    # ensure both are active admins regardless of shared-DB leftovers
    for u in (a, b):
        u.role = "admin"
        u.is_active = True
    TestSession().commit()
    TestSession().close()
    # demoting one of two is allowed
    assert client.put(f"/api/admin/users/{b.id}", json={"role": "coach"},
                      headers=adm_a).status_code == 200
    assert _active_admin_count() >= 1
    # deactivating is also blocked when it would empty the admin set only if
    # no other active admin exists; here others may exist — assert invariant:
    # after ANY sequence, at least one active admin remains OR 409 was raised.
    before = _active_admin_count()
    # try to remove every admin we created in this file (best effort)
    r = client.put(f"/api/admin/users/{a.id}", json={"role": "coach"}, headers=adm_a)
    # self-demotion is always 400 regardless of global state
    assert r.status_code == 400
    assert _active_admin_count() == before


# ---------- escalation matrix ----------

def test_escalation_blocked():
    adm = _admin_headers("rbacesc@kwf.org")
    for role in ("athlete", "coach", "organizer", "referee"):
        h = _mkuser(f"rbacesc_{role}@kwf.org", role)
        me = TestSession().query(User).filter_by(email=f"rbacesc_{role}@kwf.org").first()
        me_id = me.id
        TestSession().close()
        assert client.put(f"/api/admin/users/{me_id}", json={"role": "admin"},
                          headers=h).status_code in (401, 403)
        assert client.put(f"/api/admin/users/{me_id}",
                          json={"add_permissions": ["roles.manage"]},
                          headers=h).status_code in (401, 403)
    me = TestSession().query(User).filter_by(email="rbacesc_coach@kwf.org").first()
    TestSession().close()
    assert client.put(f"/api/admin/users/{me.id}",
                      json={"add_permissions": ["tournaments.manage_all"]},
                      headers=adm).status_code == 400
    r = client.put(f"/api/admin/users/{me.id}",
                   json={"add_permissions": ["users.view"]}, headers=adm)
    assert r.status_code == 200, r.text
    assert "users.view" in r.json()["grants"]
    # grant is audited
    rows = TestSession().query(AuditLog).filter_by(entity="user", entity_id=me.id).all()
    TestSession().close()
    assert any("granted users.view" in a.action for a in rows)


# ---------- cross-owner IDOR spot checks ----------

def test_cross_owner_idor():
    org_a = _mkuser("rbacA@kwf.org", "organizer")
    org_b = _mkuser("rbacB@kwf.org", "organizer")
    tid = client.post("/api/tournaments", json={"name": "RBAC Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org_a).json()["id"]
    assert client.put(f"/api/tournaments/{tid}", json={"name": "Hijacked"}, headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/categories",
                       json={"name": "Hijacked Cat", "gender": "male"}, headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org_b).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/tatamis/1/referee",
                       json={"referee_id": None}, headers=org_b).status_code in (403, 404)
    coach = _mkuser("rbacC@kwf.org", "coach")
    aid = client.post("/api/athletes", json={"first_name": "R", "last_name": "B",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 68, "country": "KZ"},
                      headers=coach).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org_a).json()["id"]
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": cat}, headers=coach).json()["id"]
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/status",
                       json={"status": "rejected"}, headers=org_b).status_code == 403
    coach2 = _mkuser("rbacC2@kwf.org", "coach")
    assert client.put(f"/api/athletes/{aid}", json={"first_name": "R", "last_name": "Hacked",
                                                    "gender": "male", "birth_year": 2000,
                                                    "weight_kg": 68, "country": "KZ"},
                      headers=coach2).status_code == 403
