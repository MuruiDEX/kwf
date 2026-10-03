"""Wave 1: coach spravki (practical club documents, no legal e-sign).

Design: template registry `template_key -> metadata -> fields -> renderer`.
Auto-filled data comes from Athlete/Club/Coach/Tournament rows; only the
fields missing from the DB are typed by the coach (e.g. birth_date, periods).
`template_key` + `version` live inside Document.payload JSON — no migration,
one table for all spravki kinds. PDFs render on-the-fly (ReportLab + BytesIO).
"""
from __future__ import annotations
import io
from sqlalchemy.orm import Session
from app.models.club_athlete import Athlete, Club
from app.models.tournament import Tournament, TournamentCategory
from app.models.competition import Registration
from app.models.user import User

VERSION = 1

# field: name / labels / required / source
TEMPLATES: dict[str, dict] = {
    "school": {
        "title_ru": "Справка для школы",
        "title_kk": "Мектепке анықтама",
        "need_tournament": False,
        "fields": [
            {"name": "full_name", "label_ru": "ФИО", "label_kk": "Аты-жөні", "required": True, "source": "auto"},
            {"name": "club", "label_ru": "Клуб", "label_kk": "Клуб", "required": True, "source": "auto"},
            {"name": "coach_name", "label_ru": "Тренер", "label_kk": "Жаттықтырушы", "required": True, "source": "auto"},
            {"name": "country", "label_ru": "Страна", "label_kk": "Елі", "required": False, "source": "auto"},
            {"name": "birth_date", "label_ru": "Дата рождения", "label_kk": "Туған күні", "required": True, "source": "manual", "max": 32},
            {"name": "train_period", "label_ru": "Период занятий", "label_kk": "Айнылысу кезеңі", "required": True, "source": "manual", "max": 64},
            {"name": "absence_period", "label_ru": "Период отсутствия", "label_kk": "Болмау кезеңі", "required": True, "source": "manual", "max": 64},
            {"name": "reason", "label_ru": "Причина", "label_kk": "Себебі", "required": True, "source": "manual", "max": 255},
            {"name": "extra_text", "label_ru": "Дополнительно", "label_kk": "Қосымша", "required": False, "source": "manual", "max": 512},
        ],
    },
    "participation": {
        "title_ru": "Справка об участии в соревновании",
        "title_kk": "Жарысқа қатысқаны туралы анықтама",
        "need_tournament": True,
        "fields": [
            {"name": "full_name", "label_ru": "ФИО", "label_kk": "Аты-жөні", "required": True, "source": "auto"},
            {"name": "club", "label_ru": "Клуб", "label_kk": "Клуб", "required": True, "source": "auto"},
            {"name": "coach_name", "label_ru": "Тренер", "label_kk": "Жаттықтырушы", "required": True, "source": "auto"},
            {"name": "tournament", "label_ru": "Соревнование", "label_kk": "Жарыс", "required": True, "source": "auto"},
            {"name": "tournament_city", "label_ru": "Город", "label_kk": "Қала", "required": False, "source": "auto"},
            {"name": "tournament_date", "label_ru": "Дата", "label_kk": "Күні", "required": False, "source": "auto"},
            {"name": "category", "label_ru": "Категория", "label_kk": "Санаты", "required": False, "source": "auto"},
            {"name": "place", "label_ru": "Место", "label_kk": "Орын", "required": False, "source": "manual", "max": 32},
            {"name": "extra_text", "label_ru": "Дополнительно", "label_kk": "Қосымша", "required": False, "source": "manual", "max": 512},
        ],
    },
    "attendance": {
        "title_ru": "Справка о посещении тренировок",
        "title_kk": "Жаттығуға қатысқаны туралы анықтама",
        "need_tournament": False,
        "fields": [
            {"name": "full_name", "label_ru": "ФИО", "label_kk": "Аты-жөні", "required": True, "source": "auto"},
            {"name": "club", "label_ru": "Клуб", "label_kk": "Клуб", "required": True, "source": "auto"},
            {"name": "coach_name", "label_ru": "Тренер", "label_kk": "Жаттықтырушы", "required": True, "source": "auto"},
            {"name": "period", "label_ru": "Период", "label_kk": "Кезең", "required": True, "source": "manual", "max": 64},
            {"name": "extra_text", "label_ru": "Дополнительно", "label_kk": "Қосымша", "required": False, "source": "manual", "max": 512},
        ],
    },
    "trip": {
        "title_ru": "Справка о выезде на соревнования",
        "title_kk": "Жарысқа шығу туралы анықтама",
        "need_tournament": True,
        "fields": [
            {"name": "full_name", "label_ru": "ФИО", "label_kk": "Аты-жөні", "required": True, "source": "auto"},
            {"name": "club", "label_ru": "Клуб", "label_kk": "Клуб", "required": True, "source": "auto"},
            {"name": "coach_name", "label_ru": "Тренер", "label_kk": "Жаттықтырушы", "required": True, "source": "auto"},
            {"name": "tournament", "label_ru": "Соревнование", "label_kk": "Жарыс", "required": True, "source": "auto"},
            {"name": "tournament_city", "label_ru": "Город", "label_kk": "Қала", "required": False, "source": "auto"},
            {"name": "tournament_date", "label_ru": "Дата", "label_kk": "Күні", "required": False, "source": "auto"},
            {"name": "travel_dates", "label_ru": "Даты поездки", "label_kk": "Сапар күндері", "required": True, "source": "manual", "max": 64},
            {"name": "accompanying", "label_ru": "Сопровождающий", "label_kk": "Алып жүруші", "required": False, "source": "manual", "max": 128},
            {"name": "extra_text", "label_ru": "Дополнительно", "label_kk": "Қосымша", "required": False, "source": "manual", "max": 512},
        ],
    },
}


def _coach_name(db: Session, a: Athlete) -> str:
    club = db.get(Club, a.club_id) if a.club_id else None
    if club and club.owner_id:
        u = db.get(User, club.owner_id)
        if u and u.full_name:
            return u.full_name
    if a.created_by:
        u = db.get(User, a.created_by)
        if u and u.full_name:
            return u.full_name
    if club and club.coach_name:
        return club.coach_name
    return ""


def resolve_data(db: Session, athlete_id: int, tournament_id: int | None = None) -> dict:
    """Auto-fill every `source: auto` field for the athlete (+tournament)."""
    a = db.get(Athlete, athlete_id)
    if not a:
        raise ValueError("Athlete not found")
    club = db.get(Club, a.club_id) if a.club_id else None
    data = {
        "full_name": a.full_name,
        "club": club.name if club else "",
        "coach_name": _coach_name(db, a),
        "country": a.country or "",
        "birth_year": str(a.birth_year or ""),
    }
    if tournament_id is not None:
        t = db.get(Tournament, tournament_id)
        if not t:
            raise ValueError("Tournament not found")
        data.update({
            "tournament": t.name,
            "tournament_city": t.city or "",
            "tournament_date": str(t.start_date),
        })
        reg = db.query(Registration).filter_by(
            tournament_id=tournament_id, athlete_id=athlete_id).first()
        if reg:
            c = db.get(TournamentCategory, reg.category_id)
            data["category"] = c.name if c else ""
    return data


def validate_manual(template_key: str, manual: dict) -> list[str]:
    """Return names of missing/invalid manual fields (empty = ok)."""
    meta = TEMPLATES[template_key]
    bad = []
    for f in meta["fields"]:
        if f["source"] != "manual":
            continue
        v = manual.get(f["name"], "")
        v = v.strip() if isinstance(v, str) else v
        if f["required"] and not v:
            bad.append(f["name"])
        elif v and len(str(v)) > int(f.get("max", 512)):
            bad.append(f["name"])
    return bad


def render_spravka_pdf(template_key: str, data: dict, lang: str = "ru") -> bytes:
    """Render a spravka on A4 with bundled Cyrillic fonts. On-the-fly bytes."""
    from reportlab.pdfgen import canvas
    from reportlab.lib.pagesizes import A4
    from app.services.pdf_fonts import ensure_fonts

    meta = TEMPLATES[template_key]
    kk = lang.lower().startswith("kk")
    regular, bold = ensure_fonts()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setFont(bold, 20)
    c.drawCentredString(300, 750, meta["title_kk"] if kk else meta["title_ru"])
    c.setFont(regular, 12)
    y = 710
    for f in meta["fields"]:
        label = f["label_kk"] if kk else f["label_ru"]
        value = str(data.get(f["name"], "") or "")
        c.setFont(bold, 12)
        c.drawString(60, y, f"{label}:")
        c.setFont(regular, 12)
        # wrap long values within the page width
        x = 60 + c.stringWidth(f"{label}: ", bold, 12) + 6
        max_w = 535 - x
        words, line = value.split(), ""
        first = True
        for w_ in words:
            trial = f"{line} {w_}".strip()
            if c.stringWidth(trial, regular, 12) <= max_w or not line:
                line = trial
            else:
                c.drawString(x if first else 60, y, line)
                y -= 20
                line, first = w_, False
        c.drawString(x if first else 60, y, line)
        y -= 26
        if y < 120:
            c.showPage()
            c.setFont(regular, 12)
            y = 760
    c.setFont(regular, 11)
    c.drawString(60, 80, ("Күні" if kk else "Дата") + f": {data.get('issued_on', '')}")
    c.drawString(60, 60, ("Жаттықтырушы" if kk else "Тренер") + f": {data.get('coach_name', '')}  __________")
    c.showPage()
    c.save()
    return buf.getvalue()
