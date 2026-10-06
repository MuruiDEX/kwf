"""C2: approved-guardian read scope (read-only).

Only status == approved grants reads, via guardian_athlete_ids() checked
live per request. Spravki, weigh-in/check-in mutation, registration
mutation, and all manage paths stay denied.
"""
import itertools
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password

_SEQ = itertools.count()


def _mkuser(email, role="public"):
    # Unique per call: shared suite DB has no per-test reset (C1 lesson).
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


def _setup(tag):
    """org + tournament/cat/reg, coach1/aid, coach2/bid, guardian."""
    org = _mkuser(f"c2{tag}org@kwf.org", "organizer")
    coach1 = _mkuser(f"c2{tag}coach1@kwf.org", "coach")
    coach2 = _mkuser(f"c2{tag}coach2@kwf.org", "coach")
    guard = _mkuser(f"c2{tag}guard@kwf.org")
    tid = client.post("/api/tournaments", json={"name": f"C2 Cup {tag}", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M40", "gender": "male", "age_min": 10,
                            "age_max": 12, "weight_min": 30, "weight_max": 45},
                      headers=org).json()["id"]
    aid = client.post("/api/athletes", json={"first_name": "C2", "last_name": f"A{tag}",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 40, "country": "KZ"},
                      headers=coach1).json()["id"]
    bid = client.post("/api/athletes", json={"first_name": "C2", "last_name": f"B{tag}",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 41, "country": "KZ"},
                      headers=coach2).json()["id"]
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": cat}, headers=coach1).json()["id"]
    return {"org": org, "coach1": coach1, "coach2": coach2, "guard": guard,
            "tid": tid, "cat": cat, "aid": aid, "bid": bid, "rid": rid}


def _approve(coach, guard, aid):
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    return lid


def _mkdoc(aid, tid, kind, code):
    from app.models.misc import Document
    s = TestSession()
    s.add(Document(code=code, kind=kind, athlete_id=aid, tournament_id=tid,
                   payload='{"place": "1", "category": "M40"}'))
    s.commit()
    s.close()


def test_approved_reads_scoped_and_wards():
    fx = _setup("ok")
    _approve(fx["coach1"], fx["guard"], fx["aid"])
    r = client.get(f"/api/athletes/{fx['aid']}/scoped", headers=fx["guard"])
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["birth_year"] == 2015 and body["weight"] == 40
    wards = client.get("/api/guardian/athletes", headers=fx["guard"]).json()
    assert [w["id"] for w in wards] == [fx["aid"]]


def test_pending_rejected_revoked_deny():
    fx = _setup("deny")
    lid = client.post("/api/guardian/links", json={"athlete_id": fx["aid"]},
                      headers=fx["guard"]).json()["id"]
    assert client.get(f"/api/athletes/{fx['aid']}/scoped", headers=fx["guard"]).status_code == 403
    assert client.get(f"/api/athletes/{fx['aid']}/documents", headers=fx["guard"]).status_code == 404
    assert client.get("/api/guardian/athletes", headers=fx["guard"]).json() == []
    assert client.get("/api/guardian/registrations", headers=fx["guard"]).json() == []
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=fx["coach1"]).status_code == 200
    assert client.get(f"/api/athletes/{fx['aid']}/scoped", headers=fx["guard"]).status_code == 403
    assert client.get("/api/guardian/athletes", headers=fx["guard"]).json() == []
    assert client.delete(f"/api/guardian/links/{lid}", headers=fx["guard"]).status_code == 200
    assert client.get(f"/api/athletes/{fx['aid']}/scoped", headers=fx["guard"]).status_code == 403
    assert client.get("/api/guardian/athletes", headers=fx["guard"]).json() == []


def test_revoke_immediately_removes_access():
    fx = _setup("rev")
    lid = _approve(fx["coach1"], fx["guard"], fx["aid"])
    assert client.get(f"/api/athletes/{fx['aid']}/scoped", headers=fx["guard"]).status_code == 200
    assert client.delete(f"/api/guardian/links/{lid}", headers=fx["guard"]).status_code == 200
    assert client.get(f"/api/athletes/{fx['aid']}/scoped", headers=fx["guard"]).status_code == 403
    assert client.get(f"/api/athletes/{fx['aid']}/documents", headers=fx["guard"]).status_code == 404
    assert client.get("/api/guardian/athletes", headers=fx["guard"]).json() == []
    assert client.get("/api/guardian/registrations", headers=fx["guard"]).json() == []


def test_cross_athlete_idor():
    fx = _setup("idor")
    _approve(fx["coach1"], fx["guard"], fx["aid"])
    # swapping A -> B grants nothing on any C2 surface
    assert client.get(f"/api/athletes/{fx['bid']}/scoped", headers=fx["guard"]).status_code == 403
    assert client.get(f"/api/athletes/{fx['bid']}/documents", headers=fx["guard"]).status_code == 404
    assert client.get("/api/guardian/registrations",
                      params={"athlete_id": fx["bid"]}, headers=fx["guard"]).status_code == 404
    assert client.get("/api/guardian/registrations",
                      params={"athlete_id": 999999}, headers=fx["guard"]).status_code == 404
    wards = client.get("/api/guardian/athletes", headers=fx["guard"]).json()
    assert all(w["id"] != fx["bid"] for w in wards)
    regs = client.get("/api/guardian/registrations", headers=fx["guard"]).json()
    assert regs and all(r["athlete_id"] == fx["aid"] for r in regs)


def test_multiple_guardians_and_athletes():
    fx = _setup("multi")
    guard2 = _mkuser("c2multig2@kwf.org")
    _approve(fx["coach1"], fx["guard"], fx["aid"])
    _approve(fx["coach1"], guard2, fx["aid"])
    assert client.get(f"/api/athletes/{fx['aid']}/scoped", headers=guard2).status_code == 200
    # guard approved for bid too (by its own coach) sees both; first guard one
    _approve(fx["coach2"], fx["guard"], fx["bid"])
    wards = {w["id"] for w in client.get("/api/guardian/athletes", headers=fx["guard"]).json()}
    assert wards == {fx["aid"], fx["bid"]}
    wards2 = {w["id"] for w in client.get("/api/guardian/athletes", headers=guard2).json()}
    assert wards2 == {fx["aid"]}


def test_documents_policy():
    fx = _setup("docs")
    _mkdoc(fx["aid"], fx["tid"], "participation", f"C2D{next(_SEQ):06d}A")
    _mkdoc(fx["aid"], fx["tid"], "spravka", f"C2D{next(_SEQ):06d}B")
    lid = client.post("/api/guardian/links", json={"athlete_id": fx["aid"]},
                      headers=fx["guard"]).json()["id"]
    # pending: denied, no enumeration
    assert client.get(f"/api/athletes/{fx['aid']}/documents", headers=fx["guard"]).status_code == 404
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=fx["coach1"]).status_code == 200
    docs = client.get(f"/api/athletes/{fx['aid']}/documents", headers=fx["guard"]).json()
    kinds = {d["kind"] for d in docs}
    assert "participation" in kinds and "spravka" not in kinds


def test_registration_reads_but_no_mutation():
    fx = _setup("regs")
    _approve(fx["coach1"], fx["guard"], fx["aid"])
    rows = client.get(f"/api/tournaments/{fx['tid']}/registrations",
                      headers=fx["guard"]).json()["items"]
    mine = [r for r in rows if r["athlete_id"] == fx["aid"]]
    assert mine and mine[0]["status"] == "approved"
    assert mine[0]["weigh_in_kg"] is None  # exact weight stays staff-only
    wregs = client.get("/api/guardian/registrations", headers=fx["guard"]).json()
    assert any(r["id"] == fx["rid"] and r["reg_status"] == "approved" for r in wregs)
    one = client.get("/api/guardian/registrations", params={"athlete_id": fx["aid"]},
                     headers=fx["guard"]).json()
    assert any(r["id"] == fx["rid"] for r in one)
    # read-only: status change / withdraw / new registration all denied
    assert client.post(f"/api/tournaments/{fx['tid']}/registrations/{fx['rid']}/status",
                       json={"status": "withdrawn"}, headers=fx["guard"]).status_code == 403
    assert client.post(f"/api/tournaments/{fx['tid']}/registrations",
                       json={"athlete_id": fx["aid"], "category_id": fx["cat"]},
                       headers=fx["guard"]).status_code == 403


def test_spravki_and_weighin_checkin_denied():
    fx = _setup("sens")
    _approve(fx["coach1"], fx["guard"], fx["aid"])
    assert client.get("/api/spravki/data", params={"athlete_id": fx["aid"]},
                      headers=fx["guard"]).status_code == 403
    assert client.post("/api/tournaments/{tid}/weigh-in/{rid}".format(**fx),
                       json={"weigh_in_kg": 40}, headers=fx["guard"]).status_code == 403
    assert client.post("/api/tournaments/{tid}/check-in/{rid}".format(**fx),
                       json={}, headers=fx["guard"]).status_code == 403


def test_manage_paths_denied_and_coach_admin_unchanged():
    from app.api.guardian import guardian_athlete_ids
    fx = _setup("roles")
    lid = _approve(fx["coach1"], fx["guard"], fx["aid"])
    # guardian gains no manage powers
    assert client.put(f"/api/athletes/{fx['aid']}",
                      json={"first_name": "X", "last_name": "Y", "gender": "male",
                            "birth_year": 2015, "weight_kg": 40, "country": "KZ"},
                      headers=fx["guard"]).status_code == 403
    assert client.post("/api/documents/issue",
                       params={"athlete_id": fx["aid"], "tournament_id": fx["tid"]},
                       headers=fx["guard"]).status_code == 403
    # coach access unchanged (own scoped/docs/regs still work)
    assert client.get(f"/api/athletes/{fx['aid']}/scoped", headers=fx["coach1"]).status_code == 200
    assert client.get(f"/api/athletes/{fx['bid']}/scoped", headers=fx["coach2"]).status_code == 200
    assert client.get(f"/api/athletes/{fx['aid']}/scoped", headers=fx["coach2"]).status_code == 403
    # admin approving a link does not make the admin a guardian
    s = TestSession()
    assert guardian_athlete_ids(s, 0) == set()
    s.close()
    adm = _mkuser("c2rolesadm@kwf.org", "admin")
    lid2 = client.post("/api/guardian/links", json={"athlete_id": fx["bid"]},
                       headers=fx["guard"]).json()["id"]
    assert client.post(f"/api/guardian/links/{lid2}/approve", headers=adm).status_code == 200
    s = TestSession()
    # admin approved the link but is not a guardian: no helper entry for them,
    # while the real guardian keeps theirs. No admin -> all shortcut.
    assert guardian_athlete_ids(s, _uid(adm)) == set()
    assert fx["bid"] in guardian_athlete_ids(s, _uid(fx["guard"]))
    s.close()
    assert lid and lid2


def _uid(headers):
    from app.core.security import decode_token
    return int(decode_token(headers["Authorization"].split(" ", 1)[1])["sub"])


def test_ward_list_privacy_redaction():
    fx = _setup("priv")
    _approve(fx["coach1"], fx["guard"], fx["aid"])
    wards = client.get("/api/guardian/athletes", headers=fx["guard"]).json()
    assert len(wards) == 1
    w = wards[0]
    assert "age_group" in w and "weight_class" in w
    for forbidden in ("birth_year", "weight", "weight_kg", "user_id", "created_by",
                      "decided_by", "guardian_user_id", "status"):
        assert forbidden not in w, forbidden
    sc = client.get(f"/api/athletes/{fx['aid']}/scoped", headers=fx["guard"]).json()
    assert sc["birth_year"] == 2015
    for forbidden in ("user_id", "created_by"):
        assert forbidden not in sc, forbidden
    # Unauthenticated: shared client carries login cookies, clear first
    # (same as C1 test_unauthenticated_401).
    client.cookies.clear()
    assert client.get("/api/guardian/athletes").status_code == 401
    assert client.get("/api/guardian/registrations").status_code == 401
