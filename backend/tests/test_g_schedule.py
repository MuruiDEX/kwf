"""D2 P3: session <-> group link (nullable group_id, same-club rule).

Covers: own/foreign/archived/NULL group, unlink, filters, malformed ids,
public privacy, PUT destination-club fix, group-delete SET NULL, migration.
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
    org = _mkuser(f"s{tag}org@kwf.org", "organizer")
    coach = _mkuser(f"s{tag}coach@kwf.org", "coach")
    adm = _mkuser(f"s{tag}adm@kwf.org", "admin")
    me = client.get("/api/auth/me", headers=coach).json()
    assert client.put(f"/api/admin/users/{me['id']}", json={"add_permissions": ["clubs.manage"]},
                      headers=adm).status_code == 200
    club = client.post("/api/clubs", json={"name": f"S Club {tag}", "country": "KZ",
                                           "city": "A", "coach_name": "C"}, headers=coach).json()["id"]
    gid = client.post("/api/groups", json={"club_id": club, "name": f"Squad {tag}"},
                      headers=coach).json()["id"]
    return {"org": org, "coach": coach, "adm": adm, "club": club, "gid": gid}


def _mk(coach, club, title="Drill", group_id=None):
    body = {"club_id": club, "title": title, "starts_at": "2026-12-10T10:00:00",
            "ends_at": "2026-12-10T11:00:00", "note": "n"}
    if group_id is not None:
        body["group_id"] = group_id
    r = client.post("/api/schedule", json=body, headers=coach)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_create_with_own_group_and_null():
    fx = _setup("ok")
    sid = _mk(fx["coach"], fx["club"], group_id=fx["gid"])
    items = client.get("/api/schedule", params={"club_id": fx["club"]}, headers=fx["coach"]).json()["items"]
    row = next(x for x in items if x["id"] == sid)
    assert row["group_id"] == fx["gid"] and row["group"] is not None and row["note"] == "n"
    sid2 = _mk(fx["coach"], fx["club"])
    items = client.get("/api/schedule", params={"club_id": fx["club"]}, headers=fx["coach"]).json()["items"]
    row2 = next(x for x in items if x["id"] == sid2)
    assert row2["group_id"] is None and row2["group"] is None


def test_foreign_crossclub_archived_denied():
    fx = _setup("deny")
    other = _mkuser("sdenyother@kwf.org", "coach")
    oclub = client.post("/api/clubs", json={"name": "S Foreign", "country": "KZ",
                                            "city": "B", "coach_name": "O"},
                        headers=fx["org"]).json()["id"]
    gg = client.post("/api/groups", json={"club_id": oclub, "name": "Foreign Squad"},
                     headers=fx["org"])
    # organizer owns no club -> cannot manage groups; admin creates it instead
    if gg.status_code != 200:
        gg = client.post("/api/groups", json={"club_id": oclub, "name": "Foreign Squad"},
                         headers=fx["adm"])
    fgid = gg.json()["id"]
    body = {"club_id": fx["club"], "title": "X", "starts_at": "2026-12-10T10:00:00"}
    assert client.post("/api/schedule", json={**body, "group_id": fgid},
                       headers=fx["coach"]).status_code == 404
    assert client.post("/api/schedule", json={**body, "group_id": 999999999},
                       headers=fx["coach"]).status_code == 404
    assert client.post("/api/groups", json={"club_id": fx["club"], "name": "Tmp"},
                       headers=other).status_code == 404
    # archived group rejects new links but stays readable
    gid = client.post("/api/groups", json={"club_id": fx["club"], "name": "Old"},
                      headers=fx["coach"]).json()["id"]
    sid = _mk(fx["coach"], fx["club"], title="Linked", group_id=gid)
    assert client.put(f"/api/groups/{gid}", json={"is_active": False}, headers=fx["coach"]).status_code == 200
    assert client.post("/api/schedule", json={**body, "group_id": gid},
                       headers=fx["coach"]).status_code == 409
    got = client.get(f"/api/groups/{gid}", headers=fx["coach"]).json()
    assert got["is_active"] is False
    items = client.get("/api/schedule", params={"club_id": fx["club"]}, headers=fx["coach"]).json()["items"]
    assert any(x["id"] == sid and x["group_id"] == gid for x in items)
    # malformed group_id -> 422
    assert client.post("/api/schedule", json={**body, "group_id": -2},
                       headers=fx["coach"]).status_code == 422


def test_unlink_and_group_filter():
    fx = _setup("flt")
    g2 = client.post("/api/groups", json={"club_id": fx["club"], "name": "Second"},
                     headers=fx["coach"]).json()["id"]
    a = _mk(fx["coach"], fx["club"], title="A", group_id=fx["gid"])
    _mk(fx["coach"], fx["club"], title="B", group_id=g2)
    _mk(fx["coach"], fx["club"], title="C")
    rows = client.get("/api/schedule", params={"club_id": fx["club"], "group_id": fx["gid"]},
                      headers=fx["coach"]).json()["items"]
    assert [x["id"] for x in rows] == [a]
    # unlink via PUT
    assert client.put(f"/api/schedule/{a}", json={"club_id": fx["club"], "title": "A",
                                                 "starts_at": "2026-12-10T10:00:00"},
                      headers=fx["coach"]).status_code == 200
    rows = client.get("/api/schedule", params={"club_id": fx["club"], "group_id": fx["gid"]},
                      headers=fx["coach"]).json()["items"]
    assert rows == []
    # foreign filter -> 404, unknown filter -> 404
    assert client.get("/api/schedule", params={"club_id": fx["club"], "group_id": 999999999},
                      headers=fx["coach"]).status_code == 404


def test_put_destination_club_fix_and_roles():
    fx = _setup("dst")
    sid = _mk(fx["coach"], fx["club"])
    oclub = client.post("/api/clubs", json={"name": "S Dst", "country": "KZ",
                                            "city": "B", "coach_name": "O"},
                        headers=fx["org"]).json()["id"]
    # D2 P3 fix: moving own session into a foreign club is denied
    assert client.put(f"/api/schedule/{sid}", json={"club_id": oclub, "title": "Hijack",
                                                   "starts_at": "2026-12-10T10:00:00"},
                      headers=fx["coach"]).status_code == 403
    got = client.get("/api/schedule", params={"club_id": fx["club"]}, headers=fx["coach"]).json()["items"]
    assert any(x["id"] == sid for x in got)
    # ... while admin keeps full authority
    assert client.put(f"/api/schedule/{sid}", json={"club_id": oclub, "title": "Moved",
                                                    "starts_at": "2026-12-10T10:00:00"},
                      headers=fx["adm"]).status_code == 200
    # athlete / anonymous cannot write
    ath = _mkuser("sdstath@kwf.org", "athlete")
    assert client.post("/api/schedule", json={"club_id": fx["club"], "title": "X",
                                              "starts_at": "2026-12-10T10:00:00"},
                       headers=ath).status_code == 403
    client.cookies.clear()
    assert client.post("/api/schedule", json={"club_id": fx["club"], "title": "X",
                                              "starts_at": "2026-12-10T10:00:00"}).status_code == 401


def test_public_serializer_carries_group_name_only():
    fx = _setup("pub")
    _mk(fx["coach"], fx["club"], title="Morning", group_id=fx["gid"])
    client.cookies.clear()
    items = client.get(f"/api/clubs/{fx['club']}/schedule").json()["items"]
    assert items and all(set(x) <= {"id", "title", "starts_at", "ends_at", "group_id", "group"}
                         for x in items)
    assert any(x["group"] for x in items)
    blob = str(items)
    for needle in ("note", "coach_id", "user_id", "birth", "weight", "guardian"):
        assert needle not in blob, needle


def test_group_delete_set_nulls_sessions():
    from app.models.club_athlete import TrainingSession
    from app.models.training_group import TrainingGroup
    fx = _setup("del")
    sid = _mk(fx["coach"], fx["club"], group_id=fx["gid"])
    s = TestSession()
    s.delete(s.get(TrainingGroup, fx["gid"]))
    s.commit()
    row = s.get(TrainingSession, sid)
    assert row is not None and row.group_id is None
    s.close()
    items = client.get("/api/schedule", params={"club_id": fx["club"]}, headers=fx["coach"]).json()["items"]
    assert any(x["id"] == sid and x["group_id"] is None for x in items)
