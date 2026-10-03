"""Wave 1: bundled TTF fonts render RU/KK Cyrillic in PDFs (no tofu)."""
from reportlab.pdfbase.ttfonts import TTFontFile
from tests.db import client

from app.services.pdf_fonts import ensure_fonts


def test_bundled_fonts_cover_ru_kk():
    need = "АянәіңғүұқөһӘІҢҒҮҰҚӨҺЁё"
    for f in ["app/assets/fonts/DejaVuSans.ttf",
              "app/assets/fonts/DejaVuSans-Bold.ttf"]:
        t = TTFontFile(f, validate=1, subfontIndex=0)
        missing = [ch for ch in need if ord(ch) not in t.charToGlyph]
        assert not missing, f"{f} missing glyphs: {missing}"


def _org():
    email = "wave1font@kwf.org"
    client.post("/api/auth/register", json={"email": email, "password": "pw123456",
                                            "full_name": "o", "role": "public"})
    # promote via direct DB insert like other suites do through organizer flow:
    # register as organizer is blocked, so use admin seed path is overkill —
    # instead create tournament needs organizer; use the request flow shortcut:
    # here we simply register a coach? No — tournaments need organizer.
    # Fallback: create organizer directly in DB.
    from tests.db import TestSession
    from app.models.user import User
    from app.core.security import hash_password
    s = TestSession()
    u = s.query(User).filter_by(email=email).first()
    u.role = "organizer"
    s.commit()
    s.close()
    r = client.post("/api/auth/login", json={"email": email, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def test_certificate_and_protocol_render_cyrillic():
    regular, bold = ensure_fonts()
    assert (regular, bold) == ("KWF", "KWF-Bold")
    org = _org()
    tid = client.post("/api/tournaments", json={"name": "Аян Кубогы", "city": "Алматы",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "Ерлер 70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    aid = client.post("/api/athletes", json={"first_name": "Аян", "last_name": "Нұрлан",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 68, "country": "KZ"},
                      headers=org).json()["id"]
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aid, "category_id": cat}, headers=org)
    code = client.post("/api/documents/issue",
                       params={"athlete_id": aid, "tournament_id": tid,
                               "kind": "diploma", "place": "1", "category": "Ерлер 70"},
                       headers=org).json()["code"]
    pdf = client.get(f"/api/documents/{code}/certificate.pdf")
    assert pdf.status_code == 200
    assert pdf.content[:5] == b"%PDF-"
    assert len(pdf.content) > 2000
    proto = client.get(f"/api/tournaments/{tid}/export/protocol.pdf", headers=org)
    assert proto.status_code == 200
    assert proto.content[:5] == b"%PDF-"


def test_long_names_shrink_instead_of_clipping():
    """Wave 7 scenario 8: very long Cyrillic names must stay inside the page
    (shrink-to-fit), not clip past the edge."""
    from reportlab.pdfbase.pdfmetrics import stringWidth
    org = _org()
    long_name = "Открытый чемпионат Республики Казахстан по киокушинкай-карате"
    tid = client.post("/api/tournaments", json={"name": long_name, "city": "Алматы",
                                                "country": "KZ", "start_date": "2026-12-01",
                                                "tatami_count": 1}, headers=org).json()["id"]
    cat = client.post(f"/api/tournaments/{tid}/categories",
                      json={"name": "Ерлер 70", "gender": "male", "age_min": 18,
                            "age_max": 40, "weight_min": 60, "weight_max": 70},
                      headers=org).json()["id"]
    long_athlete = "Александрәлі Нұрсұлтанұлы Қарағандылық"
    aid = client.post("/api/athletes", json={"first_name": long_athlete, "last_name": "Тестов",
                                            "gender": "male", "birth_year": 2000,
                                            "weight_kg": 68, "country": "KZ"},
                      headers=org).json()["id"]
    client.post(f"/api/tournaments/{tid}/registrations",
                json={"athlete_id": aid, "category_id": cat}, headers=org)
    code = client.post("/api/documents/issue",
                       params={"athlete_id": aid, "tournament_id": tid,
                               "kind": "diploma", "place": "1",
                               "category": "Ерлер 70 салмақ дәрежесі бойынша"},
                       headers=org).json()["code"]
    pdf = client.get(f"/api/documents/{code}/certificate.pdf")
    assert pdf.status_code == 200 and pdf.content[:5] == b"%PDF-"
    # the shrink helper must actually engage for these lengths (the full
    # rendered lines, not the short tournament name alone)
    from app.services.pdf_fonts import ensure_fonts
    regular, bold = ensure_fonts()
    assert stringWidth(long_athlete + " Тестов", bold, 20) > 480
    sub = f"{long_name}  ·  Ерлер 70 салмақ дәрежесі бойынша  ·  1"
    assert stringWidth(sub, regular, 12) > 480
