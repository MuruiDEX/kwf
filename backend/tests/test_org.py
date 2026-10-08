"""Access control: organizer role only via admin-approved request, never self-assigned."""
from tests.test_p2 import client, auth_headers, admin_headers

def test_organizer_self_assign_rejected():
    r = client.post("/api/auth/register", json={"email": "sneaky@x.org", "password": "pw123456", "role": "organizer"})
    assert r.status_code == 400
    r = client.post("/api/auth/register", json={"email": "sneaky2@x.org", "password": "pw123456", "role": "admin"})
    assert r.status_code == 400
    # allowed roles still work (register auto-logins: ok + identity + token)
    body = client.post("/api/auth/register", json={"email": "coach1@x.org", "password": "pw123456", "role": "coach"}).json()
    assert body["ok"] is True and body["role"] == "coach" and body["token"]

def test_request_approve_flow():
    coach = auth_headers("coach")
    admin = admin_headers()
    # request
    r = client.post("/api/auth/request-organizer", json={"org_name": "My Club Org", "message": "Run city cup"}, headers=coach)
    assert r.status_code == 200, r.text
    # duplicate pending rejected
    assert client.post("/api/auth/request-organizer", json={"org_name": "XX"}, headers=coach).status_code == 400
    # non-admin cannot review
    assert client.get("/api/admin/organizer-requests", headers=coach).status_code == 403
    # admin sees and approves
    reqs = client.get("/api/admin/organizer-requests", headers=admin).json()["items"]
    assert any(x["org_name"] == "My Club Org" for x in reqs)
    rid = [x for x in reqs if x["org_name"] == "My Club Org"][0]["id"]
    assert client.post(f"/api/admin/organizer-requests/{rid}/decision", params={"approve": True}, headers=admin).json()["status"] == "approved"
    # upgraded: coach keeps primary role AND gains organizer (multi-role,
    # additive — club/athletes intact), can manage tournaments
    me = client.get("/api/auth/me", headers=coach).json()
    assert me["role"] == "coach"
    assert set(("coach", "organizer")) <= set(me["roles"])
    perms = client.get("/api/auth/permissions", headers=coach).json()["permissions"]
    assert "tournaments.create" in perms and "tournaments.manage" in perms
    r = client.post("/api/tournaments", json={"name": "Approved Cup", "start_date": "2026-12-01"}, headers=coach)
    assert r.status_code == 200, r.text
    # coach without approval still cannot
    coach2 = auth_headers("coach")
    assert client.post("/api/tournaments", json={"name": "Nope Cup", "start_date": "2026-12-01"}, headers=coach2).status_code == 403

def test_reject_flow_and_kk_message():
    coach = auth_headers("coach")
    admin = admin_headers()
    client.post("/api/auth/request-organizer", json={"org_name": "Reject Me"}, headers=coach)
    rid = [x for x in client.get("/api/admin/organizer-requests", headers=admin).json()["items"] if x["org_name"] == "Reject Me"][0]["id"]
    assert client.post(f"/api/admin/organizer-requests/{rid}/decision", params={"approve": False}, headers=admin).json()["status"] == "rejected"
    assert client.get("/api/auth/me", headers=coach).json()["role"] == "coach"
    # Kazakh error message via Accept-Language
    r = client.post("/api/auth/login", json={"email": "nobody@x.org", "password": "wrong"}, headers={"Accept-Language": "kk"})
    assert r.status_code == 401 and "құпия сөз" in r.json()["detail"]


def test_tournament_create_matrix():
    """POST /api/tournaments: organizer/admin allowed; coach/athlete/referee/
    public denied; anonymous 401. Backend authority behind the hidden UI."""
    admin = admin_headers()
    body = {"name": "Matrix Cup", "start_date": "2026-12-01"}
    assert client.post("/api/tournaments", json=body, headers=admin).status_code == 200
    assert client.post("/api/tournaments", json=body, headers=auth_headers("organizer")).status_code == 200
    for role in ("coach", "athlete", "referee", "public"):
        assert client.post("/api/tournaments", json=body, headers=auth_headers(role)).status_code == 403, role
    client.cookies.clear()
    assert client.post("/api/tournaments", json=body).status_code == 401


def test_own_organizer_request_read():
    """GET /api/auth/organizer-request: own latest request or null; admin
    list stays restricted; anonymous 401."""
    coach = auth_headers("coach")
    assert client.get("/api/auth/organizer-request", headers=coach).json() is None
    r = client.post("/api/auth/request-organizer", json={"org_name": "My Org", "message": "hi"}, headers=coach)
    assert r.status_code == 200, r.text
    body = client.get("/api/auth/organizer-request", headers=coach).json()
    assert body["status"] == "pending" and body["org_name"] == "My Org"
    assert set(body) == {"id", "org_name", "status", "created_at"}
    assert client.get("/api/admin/organizer-requests", headers=coach).status_code == 403
    client.cookies.clear()
    assert client.get("/api/auth/organizer-request").status_code == 401
