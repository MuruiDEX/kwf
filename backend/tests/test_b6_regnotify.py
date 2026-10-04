"""B6: registration decision notifications (TDD).

Approve/reject -> linked athlete + coach_of_athlete (deduped).
Withdraw -> tournament owner (never the actor themselves).
Bulk applies the same per-id semantics. No new permissions, no migration.
"""
from tests.db import client, TestSession
from app.models.user import User
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


def _register(email, role):
    r = client.post("/api/auth/register", json={
        "email": email, "password": "pw123456", "full_name": role, "role": role})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _setup(tag):
    """Organizer + coach-owned athlete + linked athlete user + tournament."""
    org = _mkuser(f"b6{tag}org@kwf.org", "organizer")
    coach = _mkuser(f"b6{tag}coach@kwf.org", "coach")
    tid = client.post("/api/tournaments", json={"name": f"B6 Cup {tag}", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aid = client.post("/api/athletes", json={"first_name": "B6", "last_name": f"Kid{tag}",
                                             "gender": "male", "birth_year": 2000,
                                             "weight_kg": 68, "country": "KZ"},
                      headers=coach).json()["id"]
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": cat}, headers=coach).json()["id"]
    return {"org": org, "coach": coach, "tid": tid, "cat": cat, "aid": aid, "rid": rid}


def _notes(headers, needle):
    items = client.get("/api/notifications", headers=headers).json()["items"]
    return [n for n in items if needle in n["message"]]


def test_approve_notifies_linked_athlete():
    fx = _setup("appr")
    ath = _register("b6apprath@kwf.org", "athlete")
    assert client.post(f"/api/athletes/{fx['aid']}/claim", headers=ath).status_code == 200
    r = client.post(f"/api/tournaments/{fx['tid']}/registrations/{fx['rid']}/status",
                    json={"status": "approved"}, headers=fx["org"])
    assert r.status_code == 200 and r.json() == {"ok": True, "status": "approved"}
    got = _notes(ath, f"t{fx['tid']}")
    assert len(got) == 1 and got[0]["type"] == "registration"
    assert f"/tournaments/{fx['tid']}?tab=participants" in got[0]["link"]


def test_approve_notifies_coach_and_dedups():
    fx = _setup("coach")
    r = client.post(f"/api/tournaments/{fx['tid']}/registrations/{fx['rid']}/status",
                    json={"status": "approved"}, headers=fx["org"])
    assert r.status_code == 200
    got = _notes(fx["coach"], f"t{fx['tid']}")
    assert len(got) == 1 and got[0]["type"] == "registration"
    # repeat approve -> dedup, still exactly one unread identical row
    client.post(f"/api/tournaments/{fx['tid']}/registrations/{fx['rid']}/status",
                json={"status": "approved"}, headers=fx["org"])
    assert len(_notes(fx["coach"], f"t{fx['tid']}")) == 1


def test_reject_notifies_applicant_side():
    fx = _setup("rej")
    r = client.post(f"/api/tournaments/{fx['tid']}/registrations/{fx['rid']}/status",
                    json={"status": "rejected"}, headers=fx["org"])
    assert r.status_code == 200 and r.json() == {"ok": True, "status": "rejected"}
    got = _notes(fx["coach"], f"t{fx['tid']}")
    assert len(got) == 1 and got[0]["type"] == "registration"


def test_withdraw_notifies_owner_not_applicant():
    fx = _setup("wd")
    ath = _register("b6wdath@kwf.org", "athlete")
    assert client.post(f"/api/athletes/{fx['aid']}/claim", headers=ath).status_code == 200
    r = client.post(f"/api/tournaments/{fx['tid']}/registrations/{fx['rid']}/status",
                    json={"status": "withdrawn"}, headers=ath)
    assert r.status_code == 200
    owner_notes = _notes(fx["org"], "отозв")
    assert len(owner_notes) == 1 and owner_notes[0]["type"] == "registration"
    assert f"/tournaments/{fx['tid']}?tab=participants" in owner_notes[0]["link"]
    # applicant gets nothing for their own withdraw
    assert _notes(ath, "отозв") == []


def test_bulk_approve_fanout_and_isolation():
    fx = _setup("bulk")
    aids, rids = [fx["aid"]], [fx["rid"]]
    for i in range(2):
        a = client.post("/api/athletes", json={"first_name": "B6", "last_name": f"Bulk{i}",
                                                "gender": "male", "birth_year": 2000,
                                                "weight_kg": 68, "country": "KZ"},
                        headers=fx["coach"]).json()["id"]
        r = client.post(f"/api/tournaments/{fx['tid']}/registrations",
                        json={"athlete_id": a, "category_id": fx["cat"]},
                        headers=fx["coach"]).json()["id"]
        aids.append(a)
        rids.append(r)
    other_org = _mkuser("b6bulkother@kwf.org", "organizer")
    other_coach = _mkuser("b6bulkcoach2@kwf.org", "coach")
    r = client.post(f"/api/tournaments/{fx['tid']}/registrations/bulk-status",
                    json={"ids": rids, "status": "approved"}, headers=fx["org"])
    assert r.status_code == 200 and r.json()["updated"] == rids
    got = _notes(fx["coach"], f"t{fx['tid']}")
    assert len(got) == 3 and all(n["type"] == "registration" for n in got)
    assert _notes(other_org, f"t{fx['tid']}") == []
    assert _notes(other_coach, f"t{fx['tid']}") == []


def test_owner_self_action_no_self_notify():
    fx = _setup("self")
    # owner withdrawing (is_owner path) must not notify themselves
    r = client.post(f"/api/tournaments/{fx['tid']}/registrations/{fx['rid']}/status",
                    json={"status": "withdrawn"}, headers=fx["org"])
    assert r.status_code == 200
    assert _notes(fx["org"], "отозв") == []
