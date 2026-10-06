"""Coach 2.0 P1: self profile + avatar (ownership, validation, serving)."""
import base64
import itertools
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password

_SEQ = itertools.count()
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
JPG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + bytes(64)
WEBP = b"RIFF" + bytes(4) + b"WEBP" + bytes(32)


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


def test_profile_self_read_edit():
    coach = _mkuser("c2p1coach@kwf.org", "coach")
    r = client.get("/api/auth/profile", headers=coach).json()
    assert set(r) == {"user_id", "full_name", "bio", "city", "country", "specialization",
                      "experience_years", "is_public", "avatar"}
    assert r["is_public"] is False and r["avatar"] is None
    r = client.put("/api/auth/profile", json={"full_name": "Coach One", "bio": "Kyokushin 10y",
                                              "city": "Almaty", "country": "KZ",
                                              "specialization": "Kids", "experience_years": 10,
                                              "is_public": True}, headers=coach)
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["full_name"], body["city"], body["experience_years"], body["is_public"]) == \
        ("Coach One", "Almaty", 10, True)
    # forbidden fields are dropped, never applied
    before = client.get("/api/auth/me", headers=coach).json()
    r = client.put("/api/auth/profile", json={"role": "admin", "email": "x@kwf.org",
                                              "is_active": False, "permissions": ["x"]},
                   headers=coach)
    assert r.status_code == 200, r.text
    after = client.get("/api/auth/me", headers=coach).json()
    assert (after["role"], after["email"]) == (before["role"], before["email"])
    # validation
    assert client.put("/api/auth/profile", json={"experience_years": 99},
                      headers=coach).status_code == 422
    assert client.put("/api/auth/profile", json={"bio": "x" * 2001},
                      headers=coach).status_code == 422
    # audit
    from app.models.misc import AuditLog
    s = TestSession()
    n = s.query(AuditLog).filter_by(entity="user", action="updated profile").count()
    s.close()
    assert n >= 1
    client.cookies.clear()
    assert client.get("/api/auth/profile").status_code == 401
    assert client.put("/api/auth/profile", json={"bio": "x"}).status_code == 401


def test_avatar_lifecycle_and_attacks():
    coach = _mkuser("c2p1ava@kwf.org", "coach")
    other = _mkuser("c2p1avb@kwf.org", "coach")
    for data, name, mime in ((PNG, "a.png", "image/png"), (JPG, "a.jpg", "image/jpeg"),
                             (WEBP, "a.webp", "image/webp")):
        r = client.post("/api/auth/avatar", files={"file": (name, data, mime)}, headers=coach)
        assert r.status_code == 200, (name, r.text)
        url = r.json()["avatar"]
        assert url.startswith("/api/media/avatar/") and ".." not in url
        g = client.get(url)
        assert g.status_code == 200 and g.headers["content-type"] == mime
        assert "Cache-Control" in g.headers
        assert client.get("/api/auth/profile", headers=coach).json()["avatar"] == url
    first_url = client.get("/api/auth/profile", headers=coach).json()["avatar"]
    # replacement deletes the old file (second upload keeps working, old URL 404s)
    r = client.post("/api/auth/avatar", files={"file": ("b.png", PNG, "image/png")}, headers=coach)
    assert r.status_code == 200
    assert client.get(first_url).status_code == 404
    # fake extension with text payload, oversize, empty
    assert client.post("/api/auth/avatar", files={"file": ("evil.png", b"not an image", "image/png")},
                       headers=coach).status_code == 400
    assert client.post("/api/auth/avatar", files={"file": ("big.png", b"\x89PNG\r\n\x1a\n" + bytes(2 * 1024 * 1024), "image/png")},
                       headers=coach).status_code == 413
    assert client.post("/api/auth/avatar", files={"file": ("e.png", b"", "image/png")},
                       headers=coach).status_code == 400
    # traversal + unknown tokens
    assert client.get("/api/media/avatar/../app.py").status_code in (404, 422)
    assert client.get("/api/media/avatar/nonexistent123.png").status_code == 404
    # anonymous upload denied; other coach cannot touch my avatar (self-only path)
    client.cookies.clear()
    assert client.post("/api/auth/avatar", files={"file": ("a.png", PNG, "image/png")}).status_code == 401
    mine_before = client.get("/api/auth/profile", headers=coach).json()["avatar"]
    assert client.post("/api/auth/avatar", files={"file": ("a.png", PNG, "image/png")},
                       headers=other).status_code == 200
    assert client.get("/api/auth/profile", headers=coach).json()["avatar"] == mine_before
