"""Wave 1: coach spravki API (practical club documents, no e-sign).

Scope (Wave 7): organizer/coach/admin via require_athlete_scope (same RBAC
as athlete editing, no new permissions) PLUS the linked athlete themselves
for their own profile (Wave 4 self-service). Templates metadata is public
to any authenticated user (no PII).
"""
from __future__ import annotations
import json
import secrets
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.deps import get_current_user, require_athlete_scope
from app.models.club_athlete import Athlete
from app.models.user import User
from app.models.misc import Document
from app.services.spravki import TEMPLATES, VERSION, resolve_data, validate_manual, render_spravka_pdf
from fastapi import Response

router = APIRouter(prefix="/api/spravki", tags=["spravki"])


def _spravki_scope(athlete_id: int, db: Session, user: User):
    """Athlete-scope or self (linked profile). Raises 403 otherwise."""
    from app.core.permissions import has_perm, has_role
    if has_perm(db, user, "athletes.manage"):
        require_athlete_scope(athlete_id, db, user)
        return
    if has_role(db, user, "athlete"):
        a = db.get(Athlete, athlete_id)
        if a and a.user_id == user.id:
            return
    raise HTTPException(403, "Foreign athlete")


class ManualIn(BaseModel):
    fields: dict[str, str] = {}


@router.get("/templates")
def list_templates(lang: str = "ru", db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    kk = lang.lower().startswith("kk")
    return [{"key": k, "title": v["title_kk"] if kk else v["title_ru"],
             "need_tournament": v["need_tournament"],
             "fields": [{"name": f["name"],
                         "label": f["label_kk"] if kk else f["label_ru"],
                         "required": f["required"], "source": f["source"]}
                        for f in v["fields"]]}
            for k, v in TEMPLATES.items()]


@router.get("/data")
def spravka_data(athlete_id: int, tournament_id: int | None = None,
                 db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    _spravki_scope(athlete_id, db, user)
    try:
        return resolve_data(db, athlete_id, tournament_id)
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/issue")
def issue_spravka(template: str, athlete_id: int, tournament_id: int | None = None,
                  lang: str = "ru", body: ManualIn | None = None,
                  db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    _spravki_scope(athlete_id, db, user)
    if template not in TEMPLATES:
        raise HTTPException(400, "Unknown template")
    if TEMPLATES[template]["need_tournament"] and tournament_id is None:
        raise HTTPException(400, "tournament_id required for this template")
    manual = {k: (v[:512] if isinstance(v, str) else v)
              for k, v in (body.fields if body else {}).items()}
    bad = validate_manual(template, manual)
    if bad:
        raise HTTPException(400, f"Missing/invalid fields: {', '.join(bad)}")
    try:
        auto = resolve_data(db, athlete_id, tournament_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    auto["issued_on"] = str(date.today())
    payload = json.dumps({"template": template, "version": VERSION,
                          "lang": lang[:2], "auto": auto, "manual": manual},
                         ensure_ascii=False)
    code = secrets.token_hex(16).upper()
    db.add(Document(code=code, kind="spravka", athlete_id=athlete_id,
                    tournament_id=tournament_id, payload=payload))
    db.commit()
    # Wave 1: if an organizer issued it for someone else's athlete, tell the coach.
    from app.services.notifications import emit_event, coach_of_athlete
    coach = coach_of_athlete(db, athlete_id)
    if coach and coach != user.id:
        emit_event(db, "document", [coach],
                   f"Справка готова: {TEMPLATES[template]['title_ru']}",
                   link="/verify")
    return {"code": code}


@router.get("/{code}.pdf")
def spravka_pdf(code: str, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    d = db.query(Document).filter_by(code=code.upper()).first()
    if not d or d.kind != "spravka":
        raise HTTPException(404, "Document not found")
    if d.athlete_id:
        # Same scope as editing the athlete, plus linked-self (Wave 7).
        # Unknown codes also 404 (no existence oracle either way).
        try:
            _spravki_scope(d.athlete_id, db, user)
        except HTTPException as e:
            if e.status_code == 403:
                raise HTTPException(404, "Document not found")
            raise
    try:
        payload = json.loads(d.payload or "{}")
    except ValueError:
        raise HTTPException(500, "Broken document payload")
    if payload.get("template") not in TEMPLATES:
        raise HTTPException(400, "Unknown template version")
    data = {**(payload.get("auto", {})), **(payload.get("manual", {}))}
    pdf = render_spravka_pdf(payload["template"], data, payload.get("lang", "ru"))
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f"attachment; filename=spravka-{d.code}.pdf"})
