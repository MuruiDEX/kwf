"""Coach 2.0 P2: club self-create, update, logo, transfer (ownership kept)."""
import base64
import itertools
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password

_SEQ = itertools.count()
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")


def _mkuser(email, role="public"):
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


def _uid(headers):
    from app.core.security import decode_token
    return int(decode_token(headers["Authorization"].split(" ", 1)[1])["sub"])


def _mkclub(coach, name="C2 Dojo"):
    r = client.post("/api/clubs/self", json={"name": name, "country": "KZ", "city": "Almaty",
                                             "coach_name": "C", "description": "Kyokushin kids"},
                    headers=coach)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_self_create_and_owner_assignment():
    coach = _mkuser("c2cacoach@kwf.org", "coach")
    cid = _mkclub(coach)
    body = client.get(f"/api/clubs/{cid}").json()
    assert body["description"] == "Kyokushin kids"
    assert body["owner"] is not None and body["owner"]["id"] == _uid(coach)
    # owner_id cannot be forged through self-create (unknown field dropped)
    r = client.post("/api/clubs/self", json={"name": "C2 Evil", "owner_id": 1}, headers=coach)
    assert r.status_code == 200, r.text
    evil = client.get(f"/api/clubs/{r.json()['id']}").json()
    assert evil["owner"]["id"] == _uid(coach)
    # public/athlete/referee cannot self-create; anonymous 401
    for role in ("public", "athlete", "referee"):
        h = _mkuser(f"c2ca{role}@kwf.org", role)
        assert client.post("/api/clubs/self", json={"name": "C2 No"}, headers=h).status_code == 403
    client.cookies.clear()
    assert client.post("/api/clubs/self", json={"name": "C2 No"}).status_code == 401
    # organizer path untouched (still needs clubs.manage grant path)
    org = _mkuser("c2caorg@kwf.org", "organizer")
    assert client.post("/api/clubs/self", json={"name": "C2 Org Club"}, headers=org).status_code == 200


def test_update_logo_transfer_matrix():
    coach = _mkuser("c2cbcoach@kwf.org", "coach")
    other = _mkuser("c2cbother@kwf.org", "coach")
    pub = _mkuser("c2cbpub@kwf.org", "public")
    adm = _mkuser("c2cbadm@kwf.org", "admin")
    cid = _mkclub(coach, "C2 Transfer Dojo")
    # update: owner ok, foreign 404, validation
    assert client.put(f"/api/clubs/{cid}", json={"description": "New desc"}, headers=coach).status_code == 200
    assert client.get(f"/api/clubs/{cid}").json()["description"] == "New desc"
    assert client.put(f"/api/clubs/{cid}", json={"description": "Hack"}, headers=other).status_code == 404
    assert client.get(f"/api/clubs/{cid}").json()["description"] == "New desc"
    assert client.put(f"/api/clubs/{cid}", json={"name": "x"}, headers=coach).status_code == 422
    # logo: owner upload + serve + replace; foreign 404
    r = client.post(f"/api/clubs/{cid}/logo", files={"file": ("l.png", PNG, "image/png")}, headers=coach)
    assert r.status_code == 200, r.text
    url = r.json()["logo"]
    g = client.get(url)
    assert g.status_code == 200 and g.headers["content-type"] == "image/png"
    assert client.get(f"/api/clubs/{cid}").json()["logo"] == url
    assert client.post(f"/api/clubs/{cid}/logo", files={"file": ("l.png", PNG, "image/png")},
                       headers=other).status_code == 404
    r = client.post(f"/api/clubs/{cid}/logo", files={"file": ("l2.png", PNG, "image/png")}, headers=coach)
    assert r.status_code == 200 and client.get(url).status_code == 404  # old file gone
    # transfer to a coach: old denied, new allowed, admin allowed, other denied
    assert client.put(f"/api/clubs/{cid}/transfer", json={"new_owner_id": _uid(other)},
                      headers=coach).status_code == 200
    assert client.put(f"/api/clubs/{cid}", json={"description": "Old tries"},
                      headers=coach).status_code == 404
    assert client.put(f"/api/clubs/{cid}", json={"description": "New desc 2"},
                      headers=other).status_code == 200
    assert client.put(f"/api/clubs/{cid}", json={"description": "Admin edit"},
                      headers=adm).status_code == 200
    stranger = _mkuser("c2cbstr@kwf.org", "coach")
    assert client.put(f"/api/clubs/{cid}", json={"description": "Stranger"},
                      headers=stranger).status_code == 404
    # transfer guards: public target 400, unknown 404, foreign initiator 404
    assert client.put(f"/api/clubs/{cid}/transfer", json={"new_owner_id": _uid(pub)},
                      headers=other).status_code == 400
    assert client.put(f"/api/clubs/{cid}/transfer", json={"new_owner_id": 999999999},
                      headers=other).status_code == 404
    assert client.put(f"/api/clubs/{cid}/transfer", json={"new_owner_id": _uid(coach)},
                      headers=stranger).status_code == 404
    # audit trail exists
    from app.models.misc import AuditLog
    s = TestSession()
    acts = {a.action for a in s.query(AuditLog).filter_by(entity="club", entity_id=cid).all()}
    s.close()
    assert {"created club", "updated club", "updated club logo"} <= acts
    assert any(a.startswith("transferred club") for a in acts)
