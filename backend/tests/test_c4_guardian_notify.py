"""C4: guardian lifecycle notifications via the existing emit_event seam.

In-app only (type "guardian"), post-commit like B6, self-action suppressed.
No-op transitions and unauthorized actions notify nobody.
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


def _mkadmin():
    email = f"c4adm+t{next(_SEQ)}@kwf.org"
    s = TestSession()
    s.add(User(email=email, password_hash=hash_password("pw123456"),
               full_name="a", role="admin"))
    s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _setup(tag):
    coach1 = _mkuser(f"c4{tag}coach@kwf.org", "coach")
    guard = _mkuser(f"c4{tag}guard@kwf.org")
    r = client.post("/api/athletes", json={"first_name": "C4", "last_name": f"Kid{tag}",
                                           "gender": "male", "birth_year": 2015,
                                           "weight_kg": 40, "country": "KZ"},
                    headers=coach1)
    assert r.status_code == 200, r.text
    return coach1, guard, r.json()["id"]


def _notes(headers, ntype="guardian"):
    items = client.get("/api/notifications", headers=headers).json()["items"]
    return [n for n in items if n["type"] == ntype]


def _request(coach, guard, aid):
    r = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_request_notifies_coach_approver():
    coach, guard, aid = _setup("req")
    lid = _request(coach, guard, aid)
    got = _notes(coach)
    assert len(got) == 1 and lid
    assert "ожидает рассмотрения" in got[0]["message"]
    assert got[0]["link"] == "/me" and not got[0]["is_read"]


def test_request_notifies_linked_self():
    coach, guard, aid = _setup("self")
    ath = _mkuser("c4selfath@kwf.org", "athlete")
    assert client.post(f"/api/athletes/{aid}/claim", headers=ath).status_code == 200
    _request(coach, guard, aid)
    got = _notes(ath)
    assert len(got) == 1 and "ожидает рассмотрения" in got[0]["message"]


def test_no_recipient_invented():
    # Athlete with no linked user and no coach/club owner: request succeeds,
    # links as pending, but notifies nobody (no fabricated recipients).
    from app.models.club_athlete import Athlete
    coach, guard, aid = _setup("orph")
    s = TestSession()
    a = s.get(Athlete, aid)
    a.created_by = None
    a.club_id = None
    s.commit()
    s.close()
    stranger = _mkuser("c4orphstr@kwf.org")
    _request(coach, guard, aid)
    assert _notes(coach) == [] and _notes(stranger) == []


def test_approve_notifies_guardian():
    coach, guard, aid = _setup("appr")
    lid = _request(coach, guard, aid)
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    got = _notes(guard)
    assert len(got) == 1 and "одобрен" in got[0]["message"]
    assert got[0]["link"] == "/me"


def test_reject_notifies_guardian():
    coach, guard, aid = _setup("rej")
    lid = _request(coach, guard, aid)
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach).status_code == 200
    got = _notes(guard)
    assert len(got) == 1 and "отклонён" in got[0]["message"]


def test_admin_revoke_notifies_guardian_self_revoke_silent():
    coach, guard, aid = _setup("rev")
    adm = _mkadmin()
    lid = _request(coach, guard, aid)
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    assert client.delete(f"/api/guardian/links/{lid}", headers=adm).status_code == 200
    got = _notes(guard)
    assert any("отозван" in n["message"] for n in got)
    # self-revoke: B6-style self-suppression, no self-notification
    lid2 = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid2}/approve", headers=coach).status_code == 200
    n0 = len(_notes(guard))
    assert client.delete(f"/api/guardian/links/{lid2}", headers=guard).status_code == 200
    assert len(_notes(guard)) == n0


def test_reopen_creates_pending_notification():
    coach, guard, aid = _setup("reo")
    lid = _request(coach, guard, aid)
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach).status_code == 200
    assert client.post("/api/notifications/read-all", headers=coach).status_code == 200
    assert _notes(coach) and all(n["is_read"] for n in _notes(coach))
    r = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard)
    assert r.status_code == 200 and r.json()["id"] == lid
    fresh = [n for n in _notes(coach) if not n["is_read"]]
    assert len(fresh) == 1 and "ожидает рассмотрения" in fresh[0]["message"]


def test_idempotent_transitions_notify_nobody():
    coach, guard, aid = _setup("idem")
    lid = _request(coach, guard, aid)
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    n0 = len(_notes(guard))
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    assert len(_notes(guard)) == n0
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach).status_code == 200
    n1 = len(_notes(guard))
    assert n1 == n0 + 1  # approved -> rejected IS a transition
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach).status_code == 200
    assert len(_notes(guard)) == n1
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    n2 = len(_notes(guard))
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    assert len(_notes(guard)) == n2
    # 409 paths notify nobody
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 409
    assert len(_notes(guard)) == n2
    # revoked -> re-request is a REAL transition (C1: same id, pending again)
    # and re-nudges the approver once the old nudge was read (dedup by design).
    assert client.post("/api/notifications/read-all", headers=coach).status_code == 200
    r = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard)
    assert r.status_code == 200 and r.json()["id"] == lid
    fresh = [n for n in _notes(coach) if not n["is_read"]]
    assert len(fresh) == 1 and "ожидает рассмотрения" in fresh[0]["message"]


def test_unauthorized_and_foreign_actions_silent():
    coach, guard, aid = _setup("sil")
    lid = _request(coach, guard, aid)
    n_coach, n_guard = len(_notes(coach)), len(_notes(guard))
    coach2 = _mkuser("c4silforeign@kwf.org", "coach")
    stranger = _mkuser("c4silstr@kwf.org")
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach2).status_code == 404
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=stranger).status_code == 404
    assert client.delete(f"/api/guardian/links/{lid}", headers=stranger).status_code == 404
    client.cookies.clear()
    assert client.post(f"/api/guardian/links/{lid}/approve").status_code == 401
    assert len(_notes(coach)) == n_coach and len(_notes(guard)) == n_guard
    assert _notes(coach2) == [] and _notes(stranger) == []


def test_guardians_isolated_from_each_other():
    coach, guard, aid = _setup("iso")
    guard2 = _mkuser("c4isog2@kwf.org")
    _request(coach, guard, aid)
    _request(coach, guard2, aid)
    # requests notify the coach, never fellow guardians. Both requests
    # describe the same pending fact, so the existing unread-identical
    # dedup collapses them into one nudge (the actionable queue is
    # GET /api/guardian/links incoming, not the notification list).
    assert _notes(guard) == [] and _notes(guard2) == []
    co = _notes(coach)
    assert len(co) == 1 and "ожидает рассмотрения" in co[0]["message"]


def test_coach_gets_request_only_no_decision_spam():
    coach, guard, aid = _setup("dspam")
    lid = _request(coach, guard, aid)
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    msgs = [n["message"] for n in _notes(coach)]
    assert len(msgs) == 1 and "ожидает рассмотрения" in msgs[0]


def test_messages_carry_no_pii_and_links_safe():
    coach, guard, aid = _setup("pii")
    lid = _request(coach, guard, aid)
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    texts = [n["message"] for n in _notes(coach)] + [n["message"] for n in _notes(guard)]
    assert texts
    blob = "\n".join(texts)
    for needle in ("2015", "40 кг", "weight", "spravka", "документ", "взвеш"):
        assert needle not in blob, needle
    links = [n["link"] for n in _notes(coach)] + [n["link"] for n in _notes(guard)]
    assert links and all(l == "/me" for l in links)


def test_read_unread_flow_still_works():
    coach, guard, aid = _setup("ru")
    _request(coach, guard, aid)
    body = client.get("/api/notifications", headers=coach).json()
    assert body["unread"] == 1
    nid = _notes(coach)[0]["id"]
    assert client.post(f"/api/notifications/{nid}/read", headers=coach).status_code == 200
    assert client.get("/api/notifications", headers=coach).json()["unread"] == 0
    # stranger cannot flip чужой notification state
    stranger = _mkuser("c4rustr@kwf.org")
    assert client.post(f"/api/notifications/{nid}/read", headers=stranger).status_code == 404


def test_guardian_flow_emits_no_registration_type():
    coach, guard, aid = _setup("ntype")
    lid = _request(coach, guard, aid)
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    for h in (coach, guard):
        items = client.get("/api/notifications", headers=h).json()["items"]
        assert items and {n["type"] for n in items} == {"guardian"}
