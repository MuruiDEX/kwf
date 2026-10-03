"""Wave 7 hardening: withdraw scope, claim roles, spravka self-access + oracle,
admin-demotion guard, weigh-in audit, single-issue idempotency."""
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


def _setup(email="w7hard@kwf.org", ath_email="w7hardath@kwf.org"):
    org = _mkuser(email, "organizer")
    coach = _mkuser("w7hardcoach@kwf.org", "coach")
    ath = _mkuser(ath_email, "athlete")
    tid = client.post("/api/tournaments", json={"name": "Hard Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aid = client.post("/api/athletes", json={"first_name": "Hd", "last_name": "Kid",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 68, "country": "KZ"},
                      headers=coach).json()["id"]
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": cat}, headers=coach).json()["id"]
    return org, coach, ath, tid, cat, aid, rid


def test_foreign_organizer_cannot_withdraw():
    org, coach, ath, tid, cat, aid, rid = _setup("w7wdraw@kwf.org")
    org_b = _mkuser("w7wdrawB@kwf.org", "organizer")
    # foreign organizer withdraw on someone else's tournament -> 403
    # (previously slipped through require_athlete_scope, which trusts organizers)
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/status",
                       json={"status": "withdrawn"}, headers=org_b).status_code == 403
    # referee cannot withdraw either
    ref = _mkuser("w7wdrawref@kwf.org", "referee")
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/status",
                       json={"status": "withdrawn"}, headers=ref).status_code == 403
    # status untouched
    rows = client.get(f"/api/tournaments/{tid}/registrations", headers=org).json()["items"]
    assert [x for x in rows if x["id"] == rid][0]["status"] == "approved"


def test_claim_roles_and_audit():
    org, coach, ath, tid, cat, aid, rid = _setup("w7claim@kwf.org")
    # non-athlete roles cannot claim
    assert client.post(f"/api/athletes/{aid}/claim", headers=coach).status_code == 403
    assert client.post(f"/api/athletes/{aid}/claim", headers=org).status_code == 403
    # athlete claims ok + audited
    assert client.post(f"/api/athletes/{aid}/claim", headers=ath).status_code == 200
    rows = TestSession().query(AuditLog).filter_by(entity="athlete", entity_id=aid).all()
    TestSession().close()
    assert any("claimed" in a.action for a in rows)


def test_spravka_self_access_and_oracle():
    org, coach, ath, tid, cat, aid, rid = _setup("w7self@kwf.org", "w7selfath@kwf.org")
    assert client.post(f"/api/athletes/{aid}/claim", headers=ath).status_code == 200
    # templates metadata visible to athlete (no PII)
    assert client.get("/api/spravki/templates", headers=ath).status_code == 200
    # own data/issue/pdf work for the linked athlete
    assert client.get("/api/spravki/data", params={"athlete_id": aid}, headers=ath).status_code == 200
    code = client.post("/api/spravki/issue", params={"template": "attendance", "athlete_id": aid},
                       json={"fields": {"period": "nov"}}, headers=ath).json()["code"]
    assert client.get(f"/api/spravki/{code}.pdf", headers=ath).status_code == 200
    # unknown code and foreign code both 404 (no oracle)
    assert client.get("/api/spravki/DEADCODE1234567890ABCD.pdf", headers=ath).status_code == 404


def test_decide_request_keeps_admin():
    s = TestSession()
    if not s.query(User).filter_by(email="w7adm@kwf.org").first():
        s.add(User(email="w7adm@kwf.org", password_hash=hash_password("pw123456"),
                   full_name="a", role="admin"))
        s.commit()
    # an admin files an organizer request (odd but possible); approving must
    # not demote them to organizer
    adm = s.query(User).filter_by(email="w7adm@kwf.org").first()
    from app.models.misc import OrganizerRequest
    s.add(OrganizerRequest(user_id=adm.id, org_name="Adm Org"))
    s.commit()
    rid = s.query(OrganizerRequest).filter_by(user_id=adm.id, status="pending").first().id
    s.close()
    adm_h = {"Authorization": f"Bearer {client.post('/api/auth/login', json={'email': 'w7adm@kwf.org', 'password': 'pw123456'}).json()['token']}"}
    assert client.post(f"/api/admin/organizer-requests/{rid}/decision?approve=true",
                       headers=adm_h).status_code == 200
    assert TestSession().query(User).filter_by(email="w7adm@kwf.org").first().role == "admin"
    TestSession().close()


def test_weighin_audited_and_issue_idempotent():
    org, coach, ath, tid, cat, aid, rid = _setup("w7aud@kwf.org", "w7audath@kwf.org")
    client.post(f"/api/tournaments/{tid}/weigh-in/{rid}",
                json={"weigh_in_kg": 68}, headers=org)
    rows = TestSession().query(AuditLog).filter_by(entity="registration", entity_id=rid).all()
    TestSession().close()
    assert any("weighed" in a.action for a in rows)
    c1 = client.post("/api/documents/issue",
                     params={"athlete_id": aid, "tournament_id": tid,
                             "kind": "diploma", "place": "1", "category": "M70"},
                     headers=org).json()["code"]
    c2 = client.post("/api/documents/issue",
                     params={"athlete_id": aid, "tournament_id": tid,
                             "kind": "diploma", "place": "1", "category": "M70"},
                     headers=org).json()["code"]
    assert c1 == c2, "double issue must return the existing code, not mint duplicates"
