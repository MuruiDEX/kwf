"""C5: adversarial hardening for the full guardian subsystem (C1-C4).

No new features: a complete actor x resource matrix, IDOR/query attacks,
full state-machine walk, audit exactness, FK/cascade + unique-constraint
authority, multi-role and club-move isolation, document file-path gates,
notification-link safety. Findings (if any) get minimal fixes; otherwise
this file is the proof.
"""
import itertools
from sqlalchemy.exc import IntegrityError
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
    """org+tournament/cat/reg(aid), coach1/aid, coach2/bid, five guardians in
    every link state, linked-self athlete, stranger, admin."""
    org = _mkuser(f"c5{tag}org@kwf.org", "organizer")
    coach1 = _mkuser(f"c5{tag}coach1@kwf.org", "coach")
    coach2 = _mkuser(f"c5{tag}coach2@kwf.org", "coach")
    g_pen = _mkuser(f"c5{tag}gpen@kwf.org")
    g_rej = _mkuser(f"c5{tag}grej@kwf.org")
    g_rev = _mkuser(f"c5{tag}grev@kwf.org")
    g_ok = _mkuser(f"c5{tag}gok@kwf.org")
    stranger = _mkuser(f"c5{tag}str@kwf.org")
    adm = _mkuser(f"c5{tag}adm@kwf.org", "admin")
    ath = _mkuser(f"c5{tag}ath@kwf.org", "athlete")
    tid = client.post("/api/tournaments", json={"name": f"C5 Cup {tag}", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M40", "gender": "male", "age_min": 10,
                            "age_max": 12, "weight_min": 30, "weight_max": 45},
                      headers=org).json()["id"]
    aid = client.post("/api/athletes", json={"first_name": "C5", "last_name": f"A{tag}",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 40, "country": "KZ"},
                      headers=coach1).json()["id"]
    bid = client.post("/api/athletes", json={"first_name": "C5", "last_name": f"B{tag}",
                                             "gender": "male", "birth_year": 2014,
                                             "weight_kg": 42, "country": "KZ"},
                      headers=coach2).json()["id"]
    rid = client.post(f"/api/tournaments/{tid}/registrations",
                      json={"athlete_id": aid, "category_id": cat}, headers=coach1).json()["id"]
    assert client.post(f"/api/athletes/{aid}/claim", headers=ath).status_code == 200

    def link(g, final):
        lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=g).json()["id"]
        if final == "rejected":
            assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach1).status_code == 200
        elif final == "revoked":
            assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach1).status_code == 200
            assert client.delete(f"/api/guardian/links/{lid}", headers=g).status_code == 200
        elif final == "approved":
            assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach1).status_code == 200
        return lid

    return {"org": org, "coach1": coach1, "coach2": coach2, "adm": adm, "ath": ath,
            "stranger": stranger, "g_pen": g_pen, "g_rej": g_rej, "g_rev": g_rev,
            "g_ok": g_ok, "tid": tid, "cat": cat, "aid": aid, "bid": bid, "rid": rid,
            "lid_ok": link(g_ok, "approved"), "lid_pen": link(g_pen, "pending"),
            "lid_rej": link(g_rej, "rejected"), "lid_rev": link(g_rev, "revoked")}


def _row(items, aid):
    return next(r for r in items if r["athlete_id"] == aid)


def test_matrix_reads():
    fx = _setup("mx")
    aid, bid, tid = fx["aid"], fx["bid"], fx["tid"]
    # resolved ward lists: approved sees exactly their ward, everyone else []
    assert ([w["id"] for w in client.get("/api/guardian/athletes", headers=fx["g_ok"]).json()] == [aid])
    for h in (fx["g_pen"], fx["g_rej"], fx["g_rev"], fx["stranger"],
              fx["coach1"], fx["org"], fx["adm"], fx["ath"]):
        assert client.get("/api/guardian/athletes", headers=h).json() == []
    client.cookies.clear()
    assert client.get("/api/guardian/athletes").status_code == 401
    # scoped profile: 200 for the four legitimate modes, 403 otherwise
    for h in (fx["g_ok"], fx["ath"], fx["coach1"], fx["org"], fx["adm"]):
        assert client.get(f"/api/athletes/{aid}/scoped", headers=h).status_code == 200
    for h in (fx["g_pen"], fx["g_rej"], fx["g_rev"], fx["stranger"], fx["coach2"]):
        assert client.get(f"/api/athletes/{aid}/scoped", headers=h).status_code == 403
    client.cookies.clear()
    assert client.get(f"/api/athletes/{aid}/scoped").status_code == 401
    # documents: 200 allowed / 404 masked / 401 anon
    for h in (fx["g_ok"], fx["ath"], fx["coach1"], fx["org"], fx["adm"]):
        assert client.get(f"/api/athletes/{aid}/documents", headers=h).status_code == 200
    for h in (fx["g_pen"], fx["g_rej"], fx["g_rev"], fx["stranger"], fx["coach2"]):
        assert client.get(f"/api/athletes/{aid}/documents", headers=h).status_code == 404
    client.cookies.clear()
    assert client.get(f"/api/athletes/{aid}/documents").status_code == 401
    # guardian regs: ONLY the approved guardian (coaches/organizers/admins use
    # their own paths and must 404 here — no cross-mode conflation)
    assert client.get("/api/guardian/registrations", params={"athlete_id": aid},
                      headers=fx["g_ok"]).status_code == 200
    for h in (fx["g_pen"], fx["g_rej"], fx["g_rev"], fx["stranger"],
              fx["coach1"], fx["coach2"], fx["org"], fx["adm"], fx["ath"]):
        assert client.get("/api/guardian/registrations", params={"athlete_id": aid},
                          headers=h).status_code == 404
    client.cookies.clear()
    assert client.get("/api/guardian/registrations").status_code == 401
    # tournament status visibility: ward status for approved, null for others
    items = client.get(f"/api/tournaments/{tid}/registrations", headers=fx["g_ok"]).json()["items"]
    assert _row(items, aid)["status"] == "approved"
    items = client.get(f"/api/tournaments/{tid}/registrations", headers=fx["stranger"]).json()["items"]
    assert _row(items, aid)["status"] is None
    items = client.get(f"/api/tournaments/{tid}/registrations", headers=fx["g_pen"]).json()["items"]
    assert _row(items, aid)["status"] is None


def test_matrix_mutations_and_sensitive_denied():
    fx = _setup("mut")
    aid, tid, rid = fx["aid"], fx["tid"], fx["rid"]
    g = fx["g_ok"]  # even the APPROVED guardian cannot mutate anything
    assert client.put(f"/api/athletes/{aid}",
                      json={"first_name": "X", "last_name": "Y", "gender": "male",
                            "birth_year": 2015, "weight_kg": 40, "country": "KZ"},
                      headers=g).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/weigh-in/{rid}",
                       json={"weigh_in_kg": 40}, headers=g).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/check-in/{rid}",
                       json={}, headers=g).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/registrations/{rid}/status",
                       json={"status": "withdrawn"}, headers=g).status_code == 403
    assert client.post("/api/documents/issue",
                       params={"athlete_id": aid, "tournament_id": tid},
                       headers=g).status_code == 403
    assert client.post(f"/api/tournaments/{tid}/registrations",
                       json={"athlete_id": aid, "category_id": fx["cat"]},
                       headers=g).status_code == 403
    # spravki data: scope passes for coach/org/admin/self (200 or 400 on
    # payload), but the approved guardian is denied like a stranger
    for h in (fx["coach1"], fx["org"], fx["adm"], fx["ath"]):
        assert client.get("/api/spravki/data", params={"athlete_id": aid},
                          headers=h).status_code in (200, 400)
    for h in (g, fx["g_pen"], fx["stranger"]):
        assert client.get("/api/spravki/data", params={"athlete_id": aid},
                          headers=h).status_code == 403
    # audit stays behind audit.view
    assert client.get("/api/audit", headers=g).status_code == 403
    assert client.get("/api/audit", headers=fx["stranger"]).status_code == 403
    assert client.get("/api/audit", headers=fx["org"]).status_code == 200
    assert client.get("/api/audit", headers=fx["adm"]).status_code == 200
    # notifications remain strictly own
    assert client.get("/api/notifications", headers=g).status_code == 200


def test_idor_substitution_and_link_theft():
    fx = _setup("idor")
    aid, bid = fx["aid"], fx["bid"]
    g = fx["g_ok"]
    assert client.get(f"/api/athletes/{bid}/scoped", headers=g).status_code == 403
    assert client.get(f"/api/athletes/{bid}/documents", headers=g).status_code == 404
    assert client.get("/api/guardian/registrations", params={"athlete_id": bid},
                      headers=g).status_code == 404
    # B's link belongs to someone else: approve/reject/revoke all 404, untouched
    # (reuse the stranger account: 10-login rate budget per test is exhausted)
    other = fx["stranger"]
    lid_b = client.post("/api/guardian/links", json={"athlete_id": bid}, headers=other).json()["id"]
    assert client.post(f"/api/guardian/links/{lid_b}/approve", headers=g).status_code == 404
    assert client.post(f"/api/guardian/links/{lid_b}/reject", headers=g).status_code == 404
    assert client.delete(f"/api/guardian/links/{lid_b}", headers=g).status_code == 404
    out = client.get("/api/guardian/links", headers=other).json()
    assert any(x["id"] == lid_b and x["status"] == "pending" for x in out["outgoing"])
    mine = client.get("/api/guardian/links", headers=g).json()
    assert all(x["id"] != lid_b for x in mine["outgoing"] + mine["incoming"])


def test_idor_query_manipulation_no_oracle():
    fx = _setup("qry")
    g = fx["g_ok"]
    # malformed ids: validation, never data
    assert client.post("/api/guardian/links", json={"athlete_id": -5}, headers=g).status_code == 422
    assert client.post("/api/guardian/links", json={"athlete_id": 0}, headers=g).status_code == 422
    assert client.post("/api/guardian/links", json={"athlete_id": "x"}, headers=g).status_code == 422
    assert client.post("/api/guardian/links", json={"athlete_id": 999999999}, headers=g).status_code == 404
    # unknown vs existing-but-forbidden link ids are indistinguishable
    assert client.post("/api/guardian/links/999999999/approve", headers=g).status_code == 404
    assert client.post("/api/guardian/links/-3/approve", headers=g).status_code in (404, 422)
    assert client.delete("/api/guardian/links/999999999", headers=g).status_code == 404
    # unknown vs existing-but-forbidden athlete ids on ward regs read: same 404
    assert client.get("/api/guardian/registrations", params={"athlete_id": 999999999},
                      headers=g).status_code == 404
    assert client.get("/api/guardian/registrations", params={"athlete_id": fx["bid"]},
                      headers=g).status_code == 404
    # unknown athlete scoped read is 404 for everyone (existing B1 contract)
    assert client.get("/api/athletes/999999999/scoped", headers=g).status_code == 404
    assert client.get("/api/athletes/999999999/scoped", headers=fx["stranger"]).status_code == 404


def test_state_machine_walk_with_access_transitions():
    from app.models.misc import AuditLog
    from app.api.guardian import guardian_athlete_ids
    # fresh minimal trio for a clean walk (matrix setup already consumed states)
    coach = _mkuser("c5smcoach@kwf.org", "coach")
    guard = _mkuser("c5smguard@kwf.org")
    r = client.post("/api/athletes", json={"first_name": "C5", "last_name": "Walk",
                                           "gender": "male", "birth_year": 2015,
                                           "weight_kg": 40, "country": "KZ"},
                    headers=coach)
    aid = r.json()["id"]

    def access():
        return client.get(f"/api/athletes/{aid}/scoped", headers=guard).status_code

    def helper():
        s = TestSession()
        try:
            return aid in guardian_athlete_ids(s, _uid(guard))
        finally:
            s.close()

    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert access() == 403 and not helper()  # pending: zero
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    assert access() == 200 and helper()  # approved: access
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=coach).status_code == 200
    assert access() == 403 and not helper()  # approved -> rejected: lost
    r = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard)
    assert r.json()["id"] == lid and r.json()["status"] == "pending"
    assert access() == 403 and not helper()  # reopened: still zero
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    assert access() == 200 and helper()
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    assert access() == 403 and not helper()  # revoked: immediately zero
    r = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard)
    assert r.json()["id"] == lid and r.json()["status"] == "pending"
    assert access() == 403 and not helper()  # revoked -> pending: still zero
    # audit trail is exactly the walk, in order, by the right actors
    s = TestSession()
    rows = s.query(AuditLog).filter_by(entity="guardian_link", entity_id=lid).order_by(AuditLog.id).all()
    s.close()
    assert [x.action for x in rows] == ["guardian link requested", "guardian link approved",
                                        "guardian link rejected", "guardian link requested",
                                        "guardian link approved", "guardian link revoked",
                                        "guardian link requested"]
    assert {x.actor_id for x in rows} == {_uid(coach), _uid(guard)}


def _uid(headers):
    from app.core.security import decode_token
    return int(decode_token(headers["Authorization"].split(" ", 1)[1])["sub"])


def test_audit_exactness_no_duplicates_no_ghost_rows():
    from app.models.misc import AuditLog
    coach = _mkuser("c5audcoach@kwf.org", "coach")
    guard = _mkuser("c5audguard@kwf.org")
    aid = client.post("/api/athletes", json={"first_name": "C5", "last_name": "Audit",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 40, "country": "KZ"},
                      headers=coach).json()["id"]

    def count(lid):
        s = TestSession()
        try:
            return s.query(AuditLog).filter_by(entity="guardian_link", entity_id=lid).count()
        finally:
            s.close()

    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert count(lid) == 1
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    assert count(lid) == 2  # idempotent repeat: no audit
    stranger = _mkuser("c5audstr@kwf.org")
    assert client.post(f"/api/guardian/links/{lid}/reject", headers=stranger).status_code == 404
    assert count(lid) == 2  # failed/unauthorized: no ghost row
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    assert client.delete(f"/api/guardian/links/{lid}", headers=guard).status_code == 200
    assert count(lid) == 3


def test_cascade_delete_and_unique_authority():
    from app.models.guardian import GuardianLink
    from app.api.guardian import guardian_athlete_ids
    coach = _mkuser("c5cascoach@kwf.org", "coach")
    guard = _mkuser("c5casguard@kwf.org")
    aid = client.post("/api/athletes", json={"first_name": "C5", "last_name": "Cascade",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 40, "country": "KZ"},
                      headers=coach).json()["id"]
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    # DB-level unique constraint is authoritative (the race backstop)
    s = TestSession()
    s.add(GuardianLink(guardian_user_id=_uid(guard), athlete_id=aid, status="pending"))
    try:
        s.commit()
        raised = False
    except IntegrityError:
        s.rollback()
        raised = True
    finally:
        s.close()
    assert raised
    # deleting the decider SET NULLs decided_by but keeps the approved link
    s = TestSession()
    from app.models.user import User
    coach_row = s.query(User).filter_by(id=_uid(coach)).first()
    coach_id = coach_row.id
    assert coach_id
    s.delete(coach_row)
    s.commit()
    link = s.get(GuardianLink, lid)
    assert link is not None and link.status == "approved" and link.decided_by is None
    s.close()
    # deleting the athlete CASCADEs the link away (helper goes empty)
    s = TestSession()
    from app.models.club_athlete import Athlete
    s.delete(s.get(Athlete, aid))
    s.commit()
    assert s.get(GuardianLink, lid) is None
    assert guardian_athlete_ids(s, _uid(guard)) == set()
    out = client.get("/api/guardian/links", headers=guard).json()
    assert out["outgoing"] == []
    s.close()


def test_guardian_user_delete_cascades():
    from app.models.guardian import GuardianLink
    coach = _mkuser("c5cdcoach@kwf.org", "coach")
    guard = _mkuser("c5cdguard@kwf.org")
    aid = client.post("/api/athletes", json={"first_name": "C5", "last_name": "Gone",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 40, "country": "KZ"},
                      headers=coach).json()["id"]
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    s = TestSession()
    from app.models.user import User
    s.delete(s.query(User).filter_by(id=_uid(guard)).first())
    s.commit()
    assert s.get(GuardianLink, lid) is None
    s.close()


def test_multirole_no_conflation():
    coach = _mkuser("c5mrcoach@kwf.org", "coach")
    guard = _mkuser("c5mrguard@kwf.org")
    aid = client.post("/api/athletes", json={"first_name": "C5", "last_name": "Dual",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 40, "country": "KZ"},
                      headers=coach).json()["id"]
    # coach asks for a guardian link to their own athlete and self-approves
    # through coach scope: both modes coexist on one user
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=coach).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    assert [w["id"] for w in client.get("/api/guardian/athletes", headers=coach).json()] == [aid]
    # revoking the link removes guardian mode only; coach scope is untouched
    assert client.delete(f"/api/guardian/links/{lid}", headers=coach).status_code == 200
    assert client.get("/api/guardian/athletes", headers=coach).json() == []
    assert client.get(f"/api/athletes/{aid}/scoped", headers=coach).status_code == 200
    # an unrelated guardian approval never widens the coach's list
    lid2 = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid2}/approve", headers=coach).status_code == 200
    assert [w["id"] for w in client.get("/api/guardian/athletes", headers=coach).json()] == []


def test_organizer_guardian_and_club_move():
    org = _mkuser("c5cmorg@kwf.org", "organizer")
    coach1 = _mkuser("c5cmcoach1@kwf.org", "coach")
    coach2 = _mkuser("c5cmcoach2@kwf.org", "coach")
    guard = _mkuser("c5cmguard@kwf.org")
    aid = client.post("/api/athletes", json={"first_name": "C5", "last_name": "Move",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 40, "country": "KZ"},
                      headers=coach1).json()["id"]
    club2 = client.post("/api/clubs", json={"name": "C2 Club", "country": "KZ",
                                            "city": "A", "coach_name": "C2"},
                        headers=coach2)
    # coach2 has no clubs.manage by default; organizer creates the club instead
    if club2.status_code != 200:
        club2 = client.post("/api/clubs", json={"name": "C2 Club", "country": "KZ",
                                                "city": "A", "coach_name": "C2"},
                            headers=org)
    club2id = club2.json()["id"]
    # organizer is also a guardian here: request + self-approve via org scope
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=org).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=org).status_code == 200
    assert [w["id"] for w in client.get("/api/guardian/athletes", headers=org).json()] == [aid]
    # athlete moves to another club: coach1 loses scope, guardian link survives
    assert client.put(f"/api/athletes/{aid}",
                      json={"first_name": "C5", "last_name": "Move", "gender": "male",
                            "birth_year": 2015, "weight_kg": 40, "country": "KZ",
                            "club_id": club2id}, headers=org).status_code == 200
    inc = client.get("/api/guardian/links", headers=coach1).json()["incoming"]
    assert all(x["athlete_id"] != aid for x in inc)
    assert [w["id"] for w in client.get("/api/guardian/athletes", headers=org).json()] == [aid]
    # the move grants the guardian nothing beyond their own ward
    assert client.get("/api/guardian/athletes", headers=guard).json() == []


def test_spravka_file_path_denied_for_guardian():
    from app.models.misc import Document
    coach = _mkuser("c5spdfcoach@kwf.org", "coach")
    guard = _mkuser("c5spdfguard@kwf.org")
    aid = client.post("/api/athletes", json={"first_name": "C5", "last_name": "Spdf",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 40, "country": "KZ"},
                      headers=coach).json()["id"]
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    s = TestSession()
    s.add(Document(code="C5SPDF01", kind="spravka", athlete_id=aid,
                   tournament_id=None, payload="{}"))
    s.commit()
    s.close()
    # scope is checked before the payload is ever parsed: 404, no oracle
    assert client.get("/api/spravki/C5SPDF01.pdf", headers=guard).status_code == 404
    assert client.get("/api/spravki/data", params={"athlete_id": aid},
                      headers=guard).status_code == 403


def test_notification_links_carry_no_ids():
    coach = _mkuser("c5nlnkcoach@kwf.org", "coach")
    guard = _mkuser("c5nlnkguard@kwf.org")
    aid = client.post("/api/athletes", json={"first_name": "C5", "last_name": "Nlnk",
                                             "gender": "male", "birth_year": 2015,
                                             "weight_kg": 40, "country": "KZ"},
                      headers=coach).json()["id"]
    lid = client.post("/api/guardian/links", json={"athlete_id": aid}, headers=guard).json()["id"]
    assert client.post(f"/api/guardian/links/{lid}/approve", headers=coach).status_code == 200
    links = [n["link"] for h in (coach, guard)
               for n in client.get("/api/notifications", headers=h).json()["items"]]
    assert links and all(link == "/me" for link in links)
    assert str(aid) not in " ".join(links) and str(lid) not in " ".join(links)
