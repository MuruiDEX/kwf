"""C1: guardian relationship core (request/approve/reject/revoke lifecycle).

No role, no permissions, no UI — only the link table + lifecycle endpoints.
Access is relationship-scoped; pending/rejected/revoked grant nothing.
"""
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password
import itertools

_SEQ = itertools.count()


def _mkuser(email, role="public"):
    # Unique user per call: the suite shares ONE sqlite DB with no per-test
    # reset, so fixed emails would leak approved links across tests (e.g. an
    # exact-equality helper assertion would see other tests' wards).
    # Same convention as B6 (`b6{tag}...`); all assertions unchanged.
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


def _mkathlete(coach_headers, first="Kid"):
    r = client.post("/api/athletes", json={"first_name": first, "last_name": "C",
                                           "gender": "male", "birth_year": 2015,
                                           "weight_kg": 40, "country": "KZ"},
                    headers=coach_headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _setup():
    coach1 = _mkuser("c1coach@kwf.org", "coach")
    coach2 = _mkuser("c1foreign@kwf.org", "coach")
    guard = _mkuser("c1guard@kwf.org")  # plain public user: no new role needed
    ath = _mkuser("c1ath@kwf.org", "athlete")
    aid = _mkathlete(coach1, "A")
    bid = _mkathlete(coach2, "B")
    return coach1, coach2, guard, ath, aid, bid


def test_request_creates_pending_and_grants_nothing():
    coach1, _, guard, _, aid, _ = _setup()
    r = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "pending" and body["id"]
    # pending grants zero athlete-data access (existing B5 gate still denies)
    assert client.get(f"/api/athletes/{aid}/documents", headers=guard).status_code == 404
    # requester sees own outgoing request
    out = client.get("/api/guardian/links", headers=guard).json()
    assert any(x["athlete_id"] == aid and x["status"] == "pending" for x in out["outgoing"])


def test_request_unknown_athlete_404():
    _, _, guard, _, _, _ = _setup()
    assert client.post("/api/guardian/links", json={"athlete_id": 999999},
                       headers=guard).status_code == 404


def test_request_duplicate_409_and_race_safe():
    from app.models.guardian import GuardianLink
    coach1, _, guard, _, aid, _ = _setup()
    first = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard)
    assert first.status_code == 200
    # second request for the same pair -> 409, never a second row
    assert client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).status_code == 409
    s = TestSession()
    n = s.query(GuardianLink).filter_by(guardian_user_id=_uid(guard), athlete_id=aid).count()
    s.close()
    assert n == 1
    # concurrent insert racing the pre-check hits the unique constraint path
    s = TestSession()
    assert s.query(GuardianLink).filter_by(guardian_user_id=_uid(guard), athlete_id=aid).count() == 1
    s.close()


def _uid(headers):
    from app.core.security import decode_token
    token = headers["Authorization"].split(" ", 1)[1]
    return int(decode_token(token)["sub"])


def test_approve_by_coach_scope():
    coach1, _, guard, _, aid, _ = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    r = client.post(f"/api/guardian/links/{lid}/approve", headers=coach1)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"
    out = client.get("/api/guardian/links", headers=guard).json()
    assert any(x["id"] == lid and x["status"] == "approved" for x in out["outgoing"])


def test_approve_by_linked_self():
    coach1, _, guard, ath, aid, _ = _setup()
    assert client.post(f"/api/athletes/{aid}/claim", headers=ath).status_code == 200
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    r = client.post(f"/api/guardian/links/{lid}/approve", headers=ath)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "approved"


def test_approve_foreign_is_404_and_stays_pending():
    coach1, coach2, guard, _, aid, _ = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    # foreign coach (no scope over this athlete) learns nothing, changes nothing
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach2).status_code == 404
    # unrelated plain user likewise
    stranger = _mkuser("c1stranger@kwf.org")
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=stranger).status_code == 404
    out = client.get("/api/guardian/links", headers=guard).json()
    assert any(x["id"] == lid and x["status"] == "pending" for x in out["outgoing"])


def test_reject_and_rerequest():
    coach1, _, guard, _, aid, _ = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    r = client.post(f"/api/guardian/links/{lid}/reject", headers=coach1)
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    # rejected grants nothing; re-request reopens the same pair as pending
    r2 = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard)
    assert r2.status_code == 200 and r2.json()["status"] == "pending"
    assert r2.json()["id"] == lid


def test_revoke_by_guardian_idempotent():
    coach1, _, guard, _, aid, _ = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach1).status_code == 200
    r = client.delete(f"/api/guardian/links/{lid}", headers=guard)
    assert r.status_code == 200 and r.json()["status"] == "revoked"
    # idempotent second revoke
    r2 = client.delete(f"/api/guardian/links/{lid}", headers=guard)
    assert r2.status_code == 200 and r2.json()["status"] == "revoked"


def test_revoked_grants_nothing():
    from app.api.guardian import guardian_athlete_ids
    coach1, _, guard, _, aid, _ = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach1).status_code == 200
    s = TestSession()
    assert aid in guardian_athlete_ids(s, _uid(guard))
    s.close()
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    s = TestSession()
    assert aid not in guardian_athlete_ids(s, _uid(guard))
    s.close()
    # and the pre-existing documents gate still denies the ex-guardian
    assert client.get(f"/api/athletes/{aid}/documents", headers=guard).status_code == 404


def test_multiple_guardians_and_athletes():
    coach1, _, guard, _, aid, bid = _setup()
    # second athlete belongs to coach1 as well (created_by scope)
    guard2 = _mkuser("c1guard2@kwf.org")
    l1 = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    l2 = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard2).json()["id"]
    assert l1 != l2
    assert client.post(f"/api/guardian/links/{l1}/approve", headers=coach1).status_code == 200
    assert client.post(f"/api/guardian/links/{l2}/approve", headers=coach1).status_code == 200
    from app.api.guardian import guardian_athlete_ids
    s = TestSession()
    assert guardian_athlete_ids(s, _uid(guard)) == {aid}
    assert guardian_athlete_ids(s, _uid(guard2)) == {aid}
    s.close()
    # one guardian, two athletes
    l3 = client.post("/api/guardian/links", json={"athlete_id": bid}, headers=guard)
    # bid belongs to coach2's scope; coach1 cannot approve it
    assert l3.status_code == 200
    assert client.post(f"/api/guardian/links/{l3.json()['id']}/approve", headers=coach1).status_code == 404


def test_cross_athlete_idor_on_foreign_link():
    coach1, coach2, guard, _, aid, bid = _setup()
    # guard is linked to aid (approved); guard2 requests bid
    lid_a = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid_a}/approve", headers=coach1).status_code == 200
    guard2 = _mkuser("c1guardx@kwf.org")
    lid_b = client.post("/api/guardian/links", json={"athlete_id": bid}, headers=guard2).json()["id"]
    # guard (approved for A only) tries to approve B's link -> 404, B untouched
    assert client.post(f"/api/guardian/links/{lid_b}/approve", headers=guard).status_code == 404
    out = client.get("/api/guardian/links", headers=guard2).json()
    assert any(x["id"] == lid_b and x["status"] == "pending" for x in out["outgoing"])
    # guard's list never leaks B's link in either direction
    mine = client.get("/api/guardian/links", headers=guard).json()
    assert all(x["id"] != lid_b for x in mine["outgoing"] + mine["incoming"])


def test_cross_club_coach_cannot_approve():
    coach1, coach2, guard, _, aid, _ = _setup()
    # aid created by coach1; coach2 owns no club / did not create aid
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach2).status_code == 404
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach2).status_code == 404


def test_unauthenticated_401():
    client.cookies.clear()
    assert client.post("/api/guardian/links", json={"athlete_id": 1}).status_code == 401
    assert client.get("/api/guardian/links").status_code == 401
    assert client.post("/api/guardian/links/1/approve").status_code == 401
    assert client.post("/api/guardian/links/1/reject").status_code == 401
    assert client.delete("/api/guardian/links/1").status_code == 401


def test_admin_approve_and_revoke():
    from app.models.user import User
    from app.core.security import hash_password
    coach1, _, guard, _, aid, _ = _setup()
    s = TestSession()
    if not s.query(User).filter_by(email="c1admin@kwf.org").first():
        s.add(User(email="c1admin@kwf.org", password_hash=hash_password("pw123456"),
                   full_name="a", role="admin"))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": "c1admin@kwf.org", "password": "pw123456"})
    adm = {"Authorization": f"Bearer {r.json()['token']}"}
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=adm).status_code == 200
    assert client.delete(f"/api/guardian/links/{lid}", headers=adm).status_code == 200
    out = client.get("/api/guardian/links", headers=guard).json()
    assert any(x["id"] == lid and x["status"] == "revoked" for x in out["outgoing"])


def test_audit_entries():
    from app.models.misc import AuditLog
    coach1, _, guard, _, aid, _ = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach1).status_code == 200
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    s = TestSession()
    acts = {a.action for a in s.query(AuditLog).filter_by(entity="guardian_link", entity_id=lid).all()}
    s.close()
    assert {"guardian link requested", "guardian link rejected", "guardian link revoked"} <= acts


def test_get_links_isolation():
    coach1, coach2, guard, _, aid, bid = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    # coach2 sees neither the link nor the athlete in their incoming list
    inc = client.get("/api/guardian/links", headers=coach2).json()
    assert all(x["id"] != lid for x in inc["incoming"])
    # coach1 (approver scope) sees it as incoming pending
    inc1 = client.get("/api/guardian/links", headers=coach1).json()
    assert any(x["id"] == lid and x["status"] == "pending" for x in inc1["incoming"])


def test_revoked_rerequest_reuses_id():
    coach1, _, guard, _, aid, _ = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach1).status_code == 200
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    r = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard)
    assert r.status_code == 200 and r.json()["status"] == "pending"
    assert r.json()["id"] == lid


def test_approve_or_reject_revoked_is_409():
    coach1, _, guard, _, aid, _ = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach1).status_code == 200
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach1).status_code == 409
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach1).status_code == 409
    out = client.get("/api/guardian/links", headers=guard).json()
    assert any(x["id"] == lid and x["status"] == "revoked" for x in out["outgoing"])


def test_revoke_by_in_scope_coach_is_404():
    # C1 contract: revoke = requesting guardian or admin only. Even a coach
    # with legitimate approve scope over the athlete cannot revoke.
    coach1, _, guard, _, aid, _ = _setup()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach1).status_code == 200
    assert client.delete(f"/api/guardian/links/{lid}", headers=coach1).status_code == 404
    out = client.get("/api/guardian/links", headers=guard).json()
    assert any(x["id"] == lid and x["status"] == "approved" for x in out["outgoing"])


def test_helper_excludes_non_approved():
    from app.api.guardian import guardian_athlete_ids
    coach1, _, guard, _, aid, _ = _setup()
    assert guardian_athlete_ids(TestSession(), _uid(guard)) == set()
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    s = TestSession()
    assert aid not in guardian_athlete_ids(s, _uid(guard))  # pending
    s.close()
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach1).status_code == 200
    s = TestSession()
    assert aid not in guardian_athlete_ids(s, _uid(guard))  # rejected
    s.close()
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    s = TestSession()
    assert aid not in guardian_athlete_ids(s, _uid(guard))  # revoked
    s.close()
