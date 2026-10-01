"""P2 tests: auto-ranking, XLSX import, conflict/weigh-in notifications, referee timer."""
import io
from tests.db import client, TestSession
from app.models.user import User
from app.core.security import hash_password
from app.services.notifications import sync_conflict_notifications
from app.models.competition import Bracket, BracketMatch

_N = [0]
def auth_headers(role="organizer"):
    _N[0] += 1
    email = f"{role}{_N[0]}@p2.org"
    if role in ("organizer", "admin"):
        # granted by admin approval (see test_org.py); tests set them up directly
        s = TestSession()
        s.add(User(email=email, password_hash=hash_password("pw123456"), full_name=role, role=role))
        s.commit()
        s.close()
    else:
        client.post("/api/auth/register", json={"email": email, "password": "pw123456", "full_name": role, "role": role})
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}

def admin_headers():
    s = TestSession()
    if not s.query(User).filter_by(email="admin@p2.org").first():
        s.add(User(email="admin@p2.org", password_hash=hash_password("pw123456"), full_name="a", role="admin"))
        s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": "admin@p2.org", "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}

def make_tournament(org, name="P2 Cup", tatamis=1):
    tid = client.post("/api/tournaments", json={"name": name, "city": "A", "country": "KZ",
                                                "start_date": "2026-12-01", "tatami_count": tatamis}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "M70", "gender": "male", "age_min": 18, "age_max": 40,
                            "weight_min": 60, "weight_max": 70}, headers=org).json()["id"]
    return tid, cat

def test_ranking_auto_updates_on_finish():
    org, ref = auth_headers(), auth_headers("referee")
    tid, cat = make_tournament(org)
    aids = []
    for i in range(4):
        aid = client.post("/api/athletes", json={"first_name": "R", "last_name": f"Rank{i}", "gender": "male",
                                                 "birth_year": 2000, "weight_kg": 68, "country": "KZ"}, headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations", json={"athlete_id": aid, "category_id": cat}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    br = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"]
    semi = [m for m in br if m["round"] == 1 and m["status"] != "bye"][0]
    winner = semi["a"]
    r = client.post(f"/api/tournaments/matches/{semi['id']}/finish",
                    json={"winner_id": winner, "score_a": 1, "score_b": 0}, headers=ref)
    assert r.status_code == 200, r.text
    final_id = r.json()["next"]
    athletes = {a["id"]: a for a in client.get("/api/athletes").json()["items"]}
    assert athletes[winner]["wins"] == 1 and athletes[winner]["points"] == 3  # semifinal: win, no title yet
    assert athletes[semi["b"]]["losses"] == 1 and athletes[semi["b"]]["points"] == 0
    # winner takes the final -> title bonus
    r = client.post(f"/api/tournaments/matches/{final_id}/finish",
                    json={"winner_id": winner, "score_a": 2, "score_b": 1}, headers=ref)
    assert r.status_code == 200, r.text
    athletes = {a["id"]: a for a in client.get("/api/athletes").json()["items"]}
    assert athletes[winner]["wins"] == 2 and athletes[winner]["points"] == 2 * 3 + 10

def test_xlsx_import_with_preview():
    from openpyxl import Workbook
    org = auth_headers()
    tid, cat = make_tournament(org, name="P2 Import Cup")
    wb = Workbook()
    ws = wb.active
    ws.append(["first_name", "last_name", "gender", "birth_year", "weight_kg", "category_id"])
    ws.append(["Xl", "Good", "male", 2001, 68, cat])
    ws.append(["Xl", "BadCat", "male", 2001, 68, 99999])
    ws.append(["", "NoName", "male", 2001, 68, cat])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    r = client.post(f"/api/tournaments/{tid}/registrations/import", headers=org,
                    files={"file": ("athletes.xlsx", buf, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["found"] == 3 and body["imported"] == 1 and len(body["errors"]) == 2, body

def test_conflict_and_weighin_notifications():
    org = auth_headers()
    tid, cat = make_tournament(org, name="P2 Notify Cup")
    aids = []
    for i in range(2):
        aid = client.post("/api/athletes", json={"first_name": "N", "last_name": f"Ntf{i}", "gender": "male",
                                                 "birth_year": 2000, "weight_kg": 68, "country": "KZ"}, headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations", json={"athlete_id": aid, "category_id": cat}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    client.post(f"/api/tournaments/{tid}/schedule/generate", headers=org)
    # force a short-rest conflict: move final right after semifinal
    s = TestSession()
    try:
        bids = [b.id for b in s.query(Bracket).filter_by(tournament_id=tid).all()]
        ms = s.query(BracketMatch).filter(BracketMatch.bracket_id.in_(bids), BracketMatch.scheduled_at.isnot(None)).order_by(BracketMatch.scheduled_at).all()
        assert len(ms) == 1  # size-2 bracket: single final
        ms[0].scheduled_at = ms[0].scheduled_at  # keep; craft second close fight below
        s.commit()
        # duplicate scenario: schedule same athlete twice within 2 minutes
        from datetime import timedelta
        m2 = BracketMatch(bracket_id=ms[0].bracket_id, round_no=1, position=99, athlete_a_id=ms[0].athlete_a_id,
                          athlete_b_id=ms[0].athlete_b_id, status="scheduled",
                          scheduled_at=ms[0].scheduled_at + timedelta(minutes=2))
        s.add(m2)
        s.commit()
        assert sync_conflict_notifications(s, tid) >= 1
    finally:
        s.close()
    notes = client.get("/api/notifications", headers=org).json()
    assert notes["unread"] >= 1 and any(n["type"] == "conflict" for n in notes["items"])
    # weigh-in problem triggers notification through the API
    reg = client.get(f"/api/tournaments/{tid}/registrations", headers=org).json()["items"][0]
    r = client.post(f"/api/tournaments/{tid}/weigh-in/{reg['id']}", json={"weigh_in_kg": 85}, headers=org)
    assert r.json()["status"] == "over"
    notes = client.get("/api/notifications", headers=org).json()
    assert any(n["type"] == "weighin" for n in notes["items"])
    # mark read
    nid = notes["items"][0]["id"]
    assert client.post(f"/api/notifications/{nid}/read", headers=org).json() == {"ok": True}

def test_referee_timer():
    org, ref = auth_headers(), auth_headers("referee")
    tid, cat = make_tournament(org, name="P2 Timer Cup")
    aids = []
    for i in range(2):
        aid = client.post("/api/athletes", json={"first_name": "T", "last_name": f"Tmr{i}", "gender": "male",
                                                 "birth_year": 2000, "weight_kg": 68, "country": "KZ"}, headers=org).json()["id"]
        aids.append(aid)
        client.post(f"/api/tournaments/{tid}/registrations", json={"athlete_id": aid, "category_id": cat}, headers=org)
    client.post(f"/api/tournaments/{tid}/brackets/generate", headers=org)
    mid = client.get(f"/api/tournaments/{tid}/brackets").json()[0]["matches"][0]["id"]
    r = client.post(f"/api/tournaments/matches/{mid}/timer", json={"action": "start", "duration_sec": 180}, headers=ref)
    assert r.status_code == 200 and r.json()["action"] == "running" and r.json()["ends_at"], r.text
    r = client.post(f"/api/tournaments/matches/{mid}/timer", json={"action": "pause", "duration_sec": 180}, headers=ref)
    assert r.json()["action"] == "paused"
    r = client.post(f"/api/tournaments/matches/{mid}/timer", json={"action": "warp", "duration_sec": 180}, headers=ref)
    assert r.status_code == 422  # schema validation rejects unknown actions
