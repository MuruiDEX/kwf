"""Auth regression: Register -> auto-login -> /me, plus guards.

Covers: auto-login cookie, duplicate email, admin-role rejection,
invalid credentials, anonymous 401, cross-user 403.
"""
from tests.db import client


def _unique(prefix):
    import time, random
    return f"{prefix}{int(time.time()*1000)%1000000}{random.randint(100,999)}@kwf.org"


def test_register_auto_login_sets_cookie_and_me_works():
    email = _unique("auto")
    r = client.post("/api/auth/register", json={
        "email": email, "password": "secret123",
        "full_name": "Auto User", "role": "athlete"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("ok") is True
    assert body.get("token"), "register must return token for auto-login"
    assert body.get("role") == "athlete"
    assert "kwf_token" in r.cookies, "register must set HttpOnly auth cookie"
    # Same cookie jar: /me must work without a second login request
    me = client.get("/api/auth/me")
    assert me.status_code == 200, me.text
    assert me.json()["email"] == email


def test_register_duplicate_email_400():
    email = _unique("dup")
    payload = {"email": email, "password": "secret123",
               "full_name": "Dup", "role": "athlete"}
    assert client.post("/api/auth/register", json=payload).status_code == 200
    client.cookies.clear()
    r = client.post("/api/auth/register", json=payload)
    assert r.status_code == 400, r.text


def test_register_admin_role_400():
    r = client.post("/api/auth/register", json={
        "email": _unique("evil"), "password": "secret123",
        "full_name": "Evil", "role": "admin"})
    assert r.status_code == 400, r.text
    r2 = client.post("/api/auth/register", json={
        "email": _unique("evil2"), "password": "secret123",
        "full_name": "Evil", "role": "organizer"})
    assert r2.status_code == 400, r2.text


def test_login_invalid_credentials_401_clear_message():
    email = _unique("bad")
    client.post("/api/auth/register", json={
        "email": email, "password": "secret123",
        "full_name": "Bad", "role": "athlete"})
    client.cookies.clear()
    r = client.post("/api/auth/login",
                    json={"email": email, "password": "wrong-pass"})
    assert r.status_code == 401, r.text
    assert r.json().get("detail"), "error must be human-readable, not empty"


def test_anonymous_protected_endpoint_401():
    client.cookies.clear()
    r = client.post("/api/tournaments", json={
        "name": "Anon Cup", "start_date": "2026-12-01"})
    assert r.status_code in (401, 403), r.text
    assert client.get("/api/auth/me").status_code == 401


def test_user_cannot_access_admin_endpoints():
    email = _unique("plain")
    client.post("/api/auth/register", json={
        "email": email, "password": "secret123",
        "full_name": "Plain", "role": "athlete"})
    token = client.post("/api/auth/login",
                        json={"email": email,
                              "password": "secret123"}).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    assert client.get("/api/admin/users", headers=h).status_code == 403
    assert client.get("/api/admin/organizer-requests",
                      headers=h).status_code == 403


def test_notification_read_is_scoped_to_owner():
    from tests.db import TestSession
    from app.models.user import User
    from app.models.misc import Notification
    ea, eb = _unique("nA"), _unique("nB")
    for e in (ea, eb):
        client.post("/api/auth/register", json={
            "email": e, "password": "secret123",
            "full_name": "N", "role": "athlete"})
    ta = client.post("/api/auth/login",
                     json={"email": ea, "password": "secret123"}).json()["token"]
    tb = client.post("/api/auth/login",
                     json={"email": eb, "password": "secret123"}).json()["token"]
    s = TestSession()
    ua = s.query(User).filter_by(email=ea).one()
    s.add(Notification(user_id=ua.id, type="info", message="private-a"))
    s.commit()
    nid = s.query(Notification).filter_by(
        user_id=ua.id, message="private-a").one().id
    s.close()
    ha, hb = {"Authorization": f"Bearer {ta}"}, {"Authorization": f"Bearer {tb}"}
    assert client.post(f"/api/notifications/{nid}/read",
                       headers=hb).status_code == 404
    assert client.post(f"/api/notifications/{nid}/read",
                       headers=ha).status_code == 200
