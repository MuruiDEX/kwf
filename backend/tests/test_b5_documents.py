"""B5: ownership/scope gate for GET /api/athletes/{aid}/documents.

Target contract (mirrors _spravki_scope, no new permissions):
- anonymous -> 401 (unchanged)
- unknown athlete -> 404 (unchanged, checked before scope)
- admin / organizer / authorized manager scope (require_athlete_scope) -> 200
- athlete linked to this athlete (user_id) -> 200
- coach own athlete -> 200
- foreign coach / unrelated authenticated user -> 404 (no oracle, no code)
- spravka still excluded; response shape for authorized users unchanged
- public /api/verify/{code} and certificate PDF unchanged (intentional)
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


def _setup():
    """Organizer + coach + athlete user; athlete created by coach;
    diploma issued by organizer. Returns dict of headers + ids."""
    org = _mkuser("b5docorg@kwf.org", "organizer")
    coach = _mkuser("b5doccoach@kwf.org", "coach")
    stranger = _mkuser("b5docstranger@kwf.org", "athlete")
    tid = client.post("/api/tournaments", json={"name": "B5 Doc Cup", "city": "A",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aid = client.post("/api/athletes", json={"first_name": "B5", "last_name": "Kid",
                                             "gender": "male", "birth_year": 2000,
                                             "weight_kg": 68, "country": "KZ"},
                      headers=coach).json()["id"]
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aid, "category_id": cat}, headers=coach)
    d = client.post("/api/documents/issue",
                    params={"athlete_id": aid, "tournament_id": tid,
                            "kind": "diploma", "place": "1", "category": "M70"},
                    headers=org)
    assert d.status_code == 200, d.text
    return {"org": org, "coach": coach, "stranger": stranger,
            "tid": tid, "aid": aid, "code": d.json()["code"]}


def test_anonymous_documents_401():
    fx = _setup()
    client.cookies.clear()
    assert client.get(f"/api/athletes/{fx['aid']}/documents").status_code == 401


def test_unrelated_authenticated_user_404_no_code():
    fx = _setup()
    r = client.get(f"/api/athletes/{fx['aid']}/documents", headers=fx["stranger"])
    assert r.status_code == 404, r.text
    assert "code" not in r.text


def test_foreign_coach_404_no_code():
    fx = _setup()
    foreign = _mkuser("b5docforeign@kwf.org", "coach")
    r = client.get(f"/api/athletes/{fx['aid']}/documents", headers=foreign)
    assert r.status_code == 404, r.text
    assert "code" not in r.text


def test_own_coach_200_shape_unchanged():
    fx = _setup()
    docs = client.get(f"/api/athletes/{fx['aid']}/documents", headers=fx["coach"])
    assert docs.status_code == 200, docs.text
    rows = docs.json()
    assert rows and rows[0]["code"] == fx["code"]
    assert set(rows[0]) == {"code", "kind", "tournament", "date", "place", "category"}
    assert rows[0]["tournament"] == "B5 Doc Cup" and rows[0]["place"] == "1"


def test_self_athlete_200():
    fx = _setup()
    me = _mkuser("b5docme@kwf.org", "athlete")
    assert client.post(f"/api/athletes/{fx['aid']}/claim", headers=me).status_code == 200
    r = client.get(f"/api/athletes/{fx['aid']}/documents", headers=me)
    assert r.status_code == 200, r.text
    assert r.json()[0]["code"] == fx["code"]


def test_organizer_scope_200():
    fx = _setup()
    r = client.get(f"/api/athletes/{fx['aid']}/documents", headers=fx["org"])
    assert r.status_code == 200, r.text
    assert r.json()[0]["code"] == fx["code"]


def test_unknown_athlete_404():
    fx = _setup()
    assert client.get("/api/athletes/999999/documents", headers=fx["coach"]).status_code == 404


def test_spravka_still_excluded():
    fx = _setup()
    s = client.post("/api/spravki/issue",
                    params={"template": "attendance", "athlete_id": fx["aid"]},
                    json={"fields": {"period": "nov"}}, headers=fx["coach"])
    assert s.status_code == 200, s.text
    kinds = [x["kind"] for x in
             client.get(f"/api/athletes/{fx['aid']}/documents", headers=fx["coach"]).json()]
    assert "spravka" not in kinds
    assert kinds == ["diploma"]


def test_public_verify_and_certificate_unchanged():
    fx = _setup()
    client.cookies.clear()
    v = client.get(f"/api/documents/verify/{fx['code']}")
    assert v.status_code == 200 and v.json()["valid"] is True
    pdf = client.get(f"/api/documents/{fx['code']}/certificate.pdf")
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"
