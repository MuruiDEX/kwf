"""Wave 1: notification events — registration, status, fight, document, decision."""
from tests.db import client, TestSession
from app.models.user import User
from app.models.misc import Notification
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
    u = TestSession().query(User).filter_by(email=email).first()
    uid = u.id
    TestSession().close()
    return {"Authorization": f"Bearer {r.json()['token']}"}, uid


def _notes(headers):
    return client.get("/api/notifications", headers=headers).json()["items"]


def test_registration_status_fight_document_decision_events():
    org, org_id = _mkuser("w1evorg@kwf.org", "organizer")
    coach, coach_id = _mkuser("w1evcoach@kwf.org", "coach")
    tid = client.post("/api/tournaments", json={"name": "Ev Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aids = []
    for i in range(4):
        aid = client.post("/api/athletes",
                          json={"first_name": "Ev", "last_name": f"F{i}",
                                "gender": "male", "birth_year": 2000,
                                "weight_kg": 68, "country": "KZ"},
                          headers=coach).json()["id"]
        aids.append(aid)
    # coach registers first athlete -> owner gets registration event
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aids[0], "category_id": cat}, headers=coach)
    assert any(n["type"] == "registration" for n in _notes(org))
    # owner self-registering must NOT notify themselves
    before = len([n for n in _notes(org) if n["type"] == "registration"])
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aids[1], "category_id": cat}, headers=org)
    # organizer lacks open-registration? organizer IS allowed on own tournament;
    # actor == owner so no new notification
    after = len([n for n in _notes(org) if n["type"] == "registration"])
    assert after == before
    # status -> registration: owner event
    client.post(f"/api/tournaments/{tid}/status",
                json={"status": "registration"}, headers=org)
    # register remaining athletes so round 1 has real fights
    for aid in aids[2:]:
        client.post(f"/api/tournaments/{tid}/registrations",
                    json={"athlete_id": aid, "category_id": cat}, headers=coach)
    # brackets + finish one fight -> fight event for owner
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    m = [x for x in br if x["status"] not in ("bye", "finished") and x["a"] and x["b"]][0]
    # referee finishes (needs referee role)
    s = TestSession()
    ref = User(email="w1evref@kwf.org", password_hash=hash_password("pw123456"),
               full_name="r", role="referee")
    s.add(ref)
    s.commit()
    s.close()
    rr = client.post("/api/auth/login", json={"email": "w1evref@kwf.org",
                                              "password": "pw123456"})
    ref_h = {"Authorization": f"Bearer {rr.json()['token']}"}
    fin = client.post(f"/api/tournaments/matches/{m['id']}/finish",
                      json={"winner_id": m["a"], "score_a": 1, "score_b": 0},
                      headers=ref_h)
    assert fin.status_code == 200, fin.text
    assert any(n["type"] == "fight" for n in _notes(org))
    # diploma issued by organizer for coach's athlete -> coach notified
    d = client.post("/api/documents/issue",
                    params={"athlete_id": aids[0], "tournament_id": tid,
                            "kind": "diploma", "place": "1", "category": "M70"},
                    headers=org)
    assert d.status_code == 200, d.text
    assert any(n["type"] == "document" for n in _notes(coach))
    # organizer decision -> applicant notified
    client.post("/api/auth/register", json={"email": "w1evapp@kwf.org",
                                            "password": "pw123456",
                                            "full_name": "a", "role": "coach"})
    app_h = {"Authorization": f"Bearer {client.post('/api/auth/login', json={'email': 'w1evapp@kwf.org', 'password': 'pw123456'}).json()['token']}"}
    rq = client.post("/api/auth/request-organizer", json={"org_name": "Ev Org"},
                     headers=app_h).json()
    # approve as admin
    s = TestSession()
    adm = User(email="w1evadm@kwf.org", password_hash=hash_password("pw123456"),
               full_name="a", role="admin")
    s.add(adm)
    s.commit()
    s.close()
    adm_h = {"Authorization": f"Bearer {client.post('/api/auth/login', json={'email': 'w1evadm@kwf.org', 'password': 'pw123456'}).json()['token']}"}
    reqs = client.get("/api/admin/organizer-requests", headers=adm_h).json()["items"]
    rid = [x for x in reqs if x["id"] == rq["id"]][0]["id"]
    client.post(f"/api/admin/organizer-requests/{rid}/decision?approve=true",
                headers=adm_h)
    assert any(n["type"] == "organizer" for n in _notes(app_h))
