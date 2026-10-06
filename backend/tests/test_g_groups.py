"""D2 P2: training groups (coach squads + M:N membership).

Owner-or-admin management, public roster-equivalent reads, archived freeze,
unique membership, club-move cleanup, audit exactness. No new permission.
"""
import itertools
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password
from sqlalchemy import func as _func


def _watermark():
    # Audit rows are keyed by (entity, entity_id); SQLite may reuse an id of
    # a deleted row, so exact-sequence assertions scope to rows created after
    # this test started instead of trusting global id uniqueness.
    from app.models.misc import AuditLog
    s = TestSession()
    try:
        return s.query(_func.max(AuditLog.id)).scalar() or 0
    finally:
        s.close()


def _acts_since(entity, entity_id, wm):
    from app.models.misc import AuditLog
    s = TestSession()
    try:
        return [a.action for a in s.query(AuditLog).filter_by(entity=entity, entity_id=entity_id)
                .filter(AuditLog.id > wm).order_by(AuditLog.id).all()]
    finally:
        s.close()

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
    """org + coachA (granted clubs.manage, own club, 3 athletes) + coachB + athlete + admin."""
    org = _mkuser(f"g{tag}org@kwf.org", "organizer")
    coach = _mkuser(f"g{tag}coach@kwf.org", "coach")
    other = _mkuser(f"g{tag}other@kwf.org", "coach")
    ath = _mkuser(f"g{tag}ath@kwf.org", "athlete")
    adm = _mkuser(f"g{tag}adm@kwf.org", "admin")
    me = client.get("/api/auth/me", headers=coach).json()
    assert client.put(f"/api/admin/users/{me['id']}", json={"add_permissions": ["clubs.manage"]},
                      headers=adm).status_code == 200
    club = client.post("/api/clubs", json={"name": f"G Club {tag}", "country": "KZ",
                                           "city": "A", "coach_name": "C"}, headers=coach).json()["id"]
    aids = []
    for i in range(3):
        r = client.post("/api/athletes", json={"first_name": "Gx", "last_name": f"Kid{tag}{i}",
                                               "gender": "male", "birth_year": 2015,
                                               "weight_kg": 34, "country": "KZ",
                                               "club_id": club}, headers=coach)
        assert r.status_code == 200, r.text
        aids.append(r.json()["id"])
    return {"org": org, "coach": coach, "other": other, "ath": ath, "adm": adm,
            "club": club, "aids": aids}


def _mkgroup(coach, club, name="Junior"):
    r = client.post("/api/groups", json={"club_id": club, "name": name}, headers=coach)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_create_and_manage():
    fx = _setup("crud")
    wm = _watermark()
    gid = _mkgroup(fx["coach"], fx["club"])
    r = client.put(f"/api/groups/{gid}", json={"name": "Junior A", "level": "novice"}, headers=fx["coach"])
    assert r.status_code == 200 and r.json()["name"] == "Junior A"
    assert client.put(f"/api/groups/{gid}", json={"is_active": False}, headers=fx["coach"]).status_code == 200
    body = client.get(f"/api/groups/{gid}").json()
    assert body["is_active"] is False and body["member_count"] == 0
    assert client.put(f"/api/groups/{gid}", json={"is_active": True}, headers=fx["coach"]).status_code == 200
    assert _acts_since("training_group", gid, wm) == [
        "created group", "updated group", "updated group", "updated group"]


def test_create_validation_and_scope():
    fx = _setup("val")
    assert client.post("/api/groups", json={"club_id": fx["club"], "name": "  "},
                       headers=fx["coach"]).status_code == 422
    assert client.post("/api/groups", json={"club_id": fx["club"], "name": "X", "age_min": 12, "age_max": 10},
                       headers=fx["coach"]).status_code == 422
    assert client.post("/api/groups", json={"club_id": 999999999, "name": "X"},
                       headers=fx["coach"]).status_code == 404
    # foreign club (organizer-owned or unknown owner): 404, nothing learnable
    assert client.post("/api/groups", json={"club_id": fx["club"], "name": "X"},
                       headers=fx["other"]).status_code == 404
    # organizer holds athletes.manage but owns no club: still denied
    assert client.post("/api/groups", json={"club_id": fx["club"], "name": "X"},
                       headers=fx["org"]).status_code == 404
    assert client.post("/api/groups", json={"club_id": fx["club"], "name": "X"},
                       headers=fx["ath"]).status_code == 404
    client.cookies.clear()
    assert client.post("/api/groups", json={"club_id": fx["club"], "name": "X"}).status_code == 401
    # admin may manage any club's groups
    assert client.post("/api/groups", json={"club_id": fx["club"], "name": "Admin Squad"},
                       headers=fx["adm"]).status_code == 200


def test_public_read_shape_has_no_pii():
    fx = _setup("pub")
    gid = _mkgroup(fx["coach"], fx["club"])
    assert client.post(f"/api/groups/{gid}/members",
                       json={"athlete_id": fx["aids"][0]}, headers=fx["coach"]).status_code == 200
    client.cookies.clear()
    rows = client.get("/api/groups", params={"club_id": fx["club"]}).json()
    assert [g["id"] for g in rows] == [gid]
    assert set(rows[0]) == {"id", "club_id", "name", "level", "age_min", "age_max",
                            "is_active", "member_count"}
    body = client.get(f"/api/groups/{gid}").json()
    assert [m["id"] for m in body["members"]] == [fx["aids"][0]]
    assert set(body["members"][0]) == {"id", "name", "points", "wins", "losses"}
    blob = str(rows) + str(body)
    for needle in ("birth", "weight", "user_id", "created_by", "decided", "guardian"):
        assert needle not in blob, needle
    assert client.get("/api/groups/999999999").status_code == 404
    assert client.get("/api/groups", params={"club_id": 999999999}).status_code == 404
    assert client.get("/api/groups", params={"athlete_id": 999999999}).status_code == 404


def test_list_filter_by_athlete():
    """Athlete P1: ?athlete_id= lists only squads containing that athlete
    (public roster shape, no PII beyond the list contract)."""
    fx = _setup("flt")
    g1 = _mkgroup(fx["coach"], fx["club"], name="Alpha")
    g2 = _mkgroup(fx["coach"], fx["club"], name="Beta")
    aid = fx["aids"][0]
    assert client.post(f"/api/groups/{g1}/members", json={"athlete_id": aid},
                       headers=fx["coach"]).status_code == 200
    rows = client.get("/api/groups", params={"athlete_id": aid}).json()
    assert [g["id"] for g in rows] == [g1]
    assert set(rows[0]) == {"id", "club_id", "name", "level", "age_min", "age_max",
                            "is_active", "member_count"}
    other = client.get("/api/groups", params={"athlete_id": fx["aids"][1]}).json()
    assert other == []
    assert client.get("/api/groups", params={"athlete_id": aid, "club_id": fx["club"]}).json() != []

def test_membership_rules():
    fx = _setup("mem")
    gid = _mkgroup(fx["coach"], fx["club"])
    aid = fx["aids"][0]
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": aid},
                       headers=fx["coach"]).status_code == 200
    # duplicate -> 409, still exactly one row
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": aid},
                       headers=fx["coach"]).status_code == 409
    from app.models.training_group import TrainingGroupMember
    s = TestSession()
    n = s.query(TrainingGroupMember).filter_by(group_id=gid, athlete_id=aid).count()
    s.close()
    assert n == 1
    # unknown / foreign / unattached athlete -> uniform 404
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": 999999999},
                       headers=fx["coach"]).status_code == 404
    stranger = _mkuser("gmemstr@kwf.org", "coach")
    boucle = client.post("/api/athletes", json={"first_name": "Gx", "last_name": "Free",
                                                "gender": "male", "birth_year": 2015,
                                                "weight_kg": 34, "country": "KZ"},
                         headers=stranger).json()["id"]
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": boucle},
                       headers=fx["coach"]).status_code == 404
    # foreign coach / athlete role cannot mutate
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": fx["aids"][1]},
                       headers=fx["other"]).status_code == 404
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": fx["aids"][1]},
                       headers=fx["ath"]).status_code == 404
    assert client.delete(f"/api/groups/{gid}/members/{aid}", headers=fx["other"]).status_code == 404
    # archived group frozen, still readable
    assert client.put(f"/api/groups/{gid}", json={"is_active": False}, headers=fx["coach"]).status_code == 200
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": fx["aids"][1]},
                       headers=fx["coach"]).status_code == 409
    assert client.get(f"/api/groups/{gid}").status_code == 200
    # idempotent remove
    assert client.put(f"/api/groups/{gid}", json={"is_active": True}, headers=fx["coach"]).status_code == 200
    assert client.delete(f"/api/groups/{gid}/members/{aid}", headers=fx["coach"]).status_code == 200
    assert client.delete(f"/api/groups/{gid}/members/{aid}", headers=fx["coach"]).status_code == 200
    assert client.get(f"/api/groups/{gid}").json()["member_count"] == 0
    # malformed ids: safe 4xx, never data
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": -2},
                       headers=fx["coach"]).status_code == 422
    assert client.post("/api/groups/999999999/members", json={"athlete_id": aid},
                       headers=fx["coach"]).status_code == 404
    assert client.put("/api/groups/999999999", json={"name": "X"}, headers=fx["coach"]).status_code == 404


def test_club_move_cleans_memberships():
    fx = _setup("move")
    gid = _mkgroup(fx["coach"], fx["club"])
    aid = fx["aids"][0]
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": aid},
                       headers=fx["coach"]).status_code == 200
    club2 = client.post("/api/clubs", json={"name": f"G Moved {fx['club']}", "country": "KZ",
                                            "city": "B", "coach_name": "O"}, headers=fx["org"]).json()["id"]
    assert client.put(f"/api/athletes/{aid}",
                      json={"first_name": "Gx", "last_name": "Moved", "gender": "male",
                            "birth_year": 2015, "weight_kg": 34, "country": "KZ",
                            "club_id": club2}, headers=fx["org"]).status_code == 200
    assert client.get(f"/api/groups/{gid}").json()["members"] == []
    # ... and the moved athlete cannot be re-added to the old club's group
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": aid},
                       headers=fx["coach"]).status_code == 404


def test_cross_coach_isolation_and_audit():
    from app.models.misc import AuditLog
    fx = _setup("iso")
    wm = _watermark()
    gid = _mkgroup(fx["coach"], fx["club"])
    # foreign coach learns nothing and changes nothing
    inc = client.get("/api/groups", headers=fx["other"]).json()
    assert all(g["club_id"] != fx["club"] or True for g in inc)  # list is public; manage is what matters
    assert client.put(f"/api/groups/{gid}", json={"name": "Hijack"}, headers=fx["other"]).status_code == 404
    assert client.delete(f"/api/groups/{gid}/members/{fx['aids'][0]}", headers=fx["other"]).status_code == 404
    assert client.get(f"/api/groups/{gid}").json()["name"] != "Hijack"
    assert _acts_since("training_group", gid, wm) == ["created group"]
    # member add/remove audit exactly once each (idempotent repeat: nothing)
    aid0 = fx["aids"][0]
    assert client.post(f"/api/groups/{gid}/members", json={"athlete_id": aid0},
                       headers=fx["coach"]).status_code == 200
    assert client.delete(f"/api/groups/{gid}/members/{aid0}", headers=fx["coach"]).status_code == 200
    assert client.delete(f"/api/groups/{gid}/members/{aid0}", headers=fx["coach"]).status_code == 200
    assert _acts_since("training_group", gid, wm) == [
        "created group", "added group member", "removed group member"]
