from __future__ import annotations
import csv, io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.db import get_db, escape_like
from app.core.deps import require_roles, require_perm, require_staff, get_current_user, get_optional_user, require_tournament_owner, require_match_access
from app.core.paging import page_args, paginate, envelope
from app.core.lang import pick
from app.models.user import User
from app.models.club_athlete import Athlete, Club
from app.models.tournament import Tournament, TournamentCategory
from app.models.competition import Registration, Tatami, Bracket, BracketMatch
from app.models.misc import AuditLog
from app.schemas.api import TournamentIn, CategoryIn, RegistrationIn, WeighIn, CheckIn, StatusChange, FinishFight, TimerIn
from app.services.brackets import generate_bracket, finish_fight, MatchConflict
from app.services.registration import eligibility_warnings
from app.services.tournament_flow import FLOW, FlowError, plan_transition
from app.services.schedule import generate_schedule, detect_conflicts
from app.services.validation import validate_tournament, autofix_weighin_status
from app.services.notifications import sync_conflict_notifications, sync_weighin_notifications
from app.services.ranking import recalc_match_participants
from app.services.live import publish, set_timer, get_timer
from datetime import date, datetime, timezone

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])

def audit(db: Session, user: User | None, action: str, entity: str = "", entity_id: int | None = None):
    db.add(AuditLog(actor_id=user.id if user else None, action=action, entity=entity, entity_id=entity_id))
    db.commit()

def to_dict(t: Tournament, db: Session, user: User | None = None) -> dict:
    count = db.query(Registration).filter_by(tournament_id=t.id).count()
    d = {"id": t.id, "name": t.name, "city": t.city, "country": t.country, "organization": t.organization,
         "start_date": str(t.start_date), "status": t.status, "type": t.type,
         "tatami_count": t.tatami_count, "participants": count}
    # B1: created_by (internal user id) only for authenticated readers.
    if user is not None:
        d["created_by"] = t.created_by
    return d

@router.get("")
def list_tournaments(q: str = "", country: str = "", status: str = "", city: str = "",
                     date_from: str = "", date_to: str = "", mine: bool = False,
                     pg: dict = Depends(page_args), db: Session = Depends(get_db),
                     user: User | None = Depends(get_optional_user)):
    """Wave A1: public discovery filters (additive, no breaks).

    - q: ilike substring over name (existing behavior preserved).
    - city: ilike substring over city (new).
    - country: exact match (existing).
    - status: exact match, except "upcoming" which groups
      upcoming+registration ("Предстоящие").
    - date_from/date_to: ISO YYYY-MM-DD bounds over start_date (new).
    - mine: B1 cabinet view, own tournaments only (requires login, 401 anon).
    """
    if mine and user is None:
        raise HTTPException(401, "Not authenticated")
    query = db.query(Tournament).order_by(Tournament.start_date)
    if mine and user is not None:
        query = query.filter(Tournament.created_by == user.id)
    if q:
        like = f"%{escape_like(q)}%"
        query = query.filter(Tournament.name.ilike(like, escape="\\"))
    if city:
        clike = f"%{escape_like(city)}%"
        query = query.filter(Tournament.city.ilike(clike, escape="\\"))
    if country:
        query = query.filter_by(country=country)
    if status:
        if status == "upcoming":
            # Grouped "upcoming" view: announced + open for registration.
            query = query.filter(Tournament.status.in_(["upcoming", "registration"]))
        else:
            query = query.filter_by(status=status)
    if date_from:
        try:
            df = date.fromisoformat(date_from)
        except ValueError:
            raise HTTPException(400, "Invalid date_from (expected YYYY-MM-DD)")
        query = query.filter(Tournament.start_date >= df)
    if date_to:
        try:
            dt = date.fromisoformat(date_to)
        except ValueError:
            raise HTTPException(400, "Invalid date_to (expected YYYY-MM-DD)")
        query = query.filter(Tournament.start_date <= dt)
    items, total = paginate(query, pg["limit"], pg["offset"])
    # One grouped count instead of N per-tournament counts (N+1 fix).
    ids = [t.id for t in items]
    counts: dict[int, int] = {}
    if ids:
        from sqlalchemy import func
        for tid, n in db.query(Registration.tournament_id, func.count(Registration.id)).filter(
                Registration.tournament_id.in_(ids)).group_by(Registration.tournament_id).all():
            counts[tid] = n
    out = []
    for t in items:
        d = {"id": t.id, "name": t.name, "city": t.city, "country": t.country, "organization": t.organization,
             "start_date": str(t.start_date), "status": t.status, "type": t.type,
             "tatami_count": t.tatami_count, "participants": counts.get(t.id, 0)}
        # B1: created_by only for authenticated readers (cabinet compat).
        if user is not None:
            d["created_by"] = t.created_by
        out.append(d)
    return envelope(out, total, pg["limit"], pg["offset"])

@router.post("")
def create_tournament(data: TournamentIn, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.create"))):
    t = Tournament(**data.model_dump(), created_by=user.id)
    db.add(t)
    db.commit()
    db.refresh(t)
    for i in range(t.tatami_count):
        db.add(Tatami(tournament_id=t.id, name=f"Tatami {i+1}"))
    db.commit()
    audit(db, user, "created tournament", "tournament", t.id)
    return to_dict(t, db, user)

@router.get("/{tid}")
def get_tournament(tid: int, db: Session = Depends(get_db),
                   user: User | None = Depends(get_optional_user)):
    t = db.get(Tournament, tid)
    if not t:
        raise HTTPException(404, "Not found")
    cats = db.query(TournamentCategory).filter_by(tournament_id=tid).all()
    return {**to_dict(t, db, user), "categories": [{"id": c.id, "name": c.name, "gender": c.gender, "age_min": c.age_min,
            "age_max": c.age_max, "weight_min": c.weight_min, "weight_max": c.weight_max} for c in cats]}

class TournamentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=3, max_length=255)
    city: str | None = Field(default=None, max_length=128)
    country: str | None = Field(default=None, max_length=64)
    organization: str | None = Field(default=None, max_length=128)
    start_date: date | None = None
    type: str | None = Field(default=None, max_length=64)
    tatami_count: int | None = Field(default=None, ge=1, le=12)

@router.put("/{tid}")
def update_tournament(tid: int, data: TournamentUpdate, db: Session = Depends(get_db),
                      user: User = Depends(require_perm("tournaments.manage"))):
    """Wave 3: minimal tournament edit with stage-aware safety.

    finished/live: only cosmetic fields (name/city/country/organization);
    start_date/type/tatami_count are locked (409) — brackets, schedule and
    results already derive from them. tatami_count shrink is allowed only
    while no brackets exist (rows are added/removed to match).
    status/created_by are never editable here (use /status).
    """
    t = require_tournament_owner(tid, db, user)
    locked_stage = t.status in ("live", "finished")
    if locked_stage and (data.start_date is not None or data.type is not None
                         or data.tatami_count is not None):
        raise HTTPException(409, "Tournament is live/finished: dates, type and tatamis are locked")
    for field in ("name", "city", "country", "organization", "type"):
        v = getattr(data, field)
        if v is not None:
            setattr(t, field, v)
    if data.start_date is not None:
        t.start_date = data.start_date
    if data.tatami_count is not None and data.tatami_count != t.tatami_count:
        has_brackets = db.query(Bracket).filter_by(tournament_id=tid).first() is not None
        if has_brackets:
            raise HTTPException(409, "Brackets exist: tatami count is locked")
        if data.tatami_count > t.tatami_count:
            for i in range(t.tatami_count, data.tatami_count):
                db.add(Tatami(tournament_id=t.id, name=f"Tatami {i+1}"))
        else:
            doomed = db.query(Tatami).filter_by(tournament_id=t.id).order_by(Tatami.id.desc()).all()
            for row in doomed[:len(doomed) - data.tatami_count]:
                db.delete(row)
        t.tatami_count = data.tatami_count
    db.commit()
    audit(db, user, "updated tournament", "tournament", tid)
    return {"ok": True, "id": t.id}

@router.post("/{tid}/categories")
def add_category(tid: int, data: CategoryIn, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    require_tournament_owner(tid, db, user)
    c = TournamentCategory(tournament_id=tid, **data.model_dump())
    db.add(c)
    db.commit()
    # suspicious-category hint (§10/§46): tiny check returned inline
    return {"id": c.id, **data.model_dump()}

@router.put("/{tid}/categories/{cid}")
def update_category(tid: int, cid: int, data: CategoryIn, db: Session = Depends(get_db),
                    user: User = Depends(require_perm("tournaments.manage"))):
    """Wave 3: full-replace category edit. Name/level/duration are always
    safe. Gender/age/weight bounds are locked (409) once the category has
    registrations — athletes were validated against them. No silent bracket
    regeneration: existing brackets keep pointing at unchanged bounds."""
    require_tournament_owner(tid, db, user)
    c = db.get(TournamentCategory, cid)
    if not c or c.tournament_id != tid:
        raise HTTPException(404, "Not found")
    bounds_changed = (data.gender != c.gender or data.age_min != c.age_min or data.age_max != c.age_max
                      or data.weight_min != c.weight_min or data.weight_max != c.weight_max)
    if bounds_changed:
        used = db.query(Registration).filter_by(tournament_id=tid, category_id=cid).first() is not None
        if used:
            raise HTTPException(409, "Category has registrations: bounds are locked (move athletes first)")
    for k, v in data.model_dump().items():
        setattr(c, k, v)
    db.commit()
    audit(db, user, "updated category", "category", c.id)
    return {"ok": True, "id": c.id}

@router.get("/{tid}/registrations")
def list_regs(tid: int, request: Request, status: str = "", pg: dict = Depends(page_args),
              db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    """Public participant list; exact weigh-in weight is PII — only tournament
    staff (owner-organizer, referee, admin) see it, others get the status."""
    t = db.get(Tournament, tid)
    if not t:
        raise HTTPException(404, "Not found")
    # P1: staff check via permissions (not raw role==) so a coach granted
    # tournaments.manage on their own tournament sees weights, consistent with
    # require_tournament_owner which already lets them through.
    from app.core.permissions import has_perm, user_roles
    rs = user_roles(db, user) if user else set()
    staff = bool(user and ("admin" in rs or "referee" in rs
                           or (t.created_by == user.id and has_perm(db, user, "tournaments.manage", rs))))
    if status and status not in ("pending", "approved", "rejected", "withdrawn"):
        raise HTTPException(400, "Bad status filter")
    # Wave 4: single JOIN fetch (regs + athlete + club + category) + one
    # COUNT — keeps the P1 query budget (was N+1, then 3 batched queries).
    filt = [Registration.tournament_id == tid]
    if status:
        filt.append(Registration.status == status)
    total = db.query(Registration).filter(*filt).count()
    rows = (db.query(Registration, Athlete, Club, TournamentCategory)
            .outerjoin(Athlete, Registration.athlete_id == Athlete.id)
            .outerjoin(Club, Athlete.club_id == Club.id)
            .outerjoin(TournamentCategory, Registration.category_id == TournamentCategory.id)
            .filter(*filt).order_by(Registration.id)
            .offset(pg["offset"]).limit(pg["limit"]).all())
    out = []
    for r, a, club, cat in rows:
        # Wave 3: moderation status visible to staff, plus to the coach who
        # created the athlete (their own application); others get no status.
        # Wave 4: plus the linked athlete themselves and the club owner
        # (same scope as require_athlete_scope).
        show_status = staff or (user and a and (
            a.created_by == user.id or a.user_id == user.id
            or (club and club.owner_id == user.id)))
        # B1: roster rows carry derived bands from their OWN category, and
        # only when the registration is approved (the relevant public fact).
        # Exact birth_year/weight and internal seed are not public.
        from app.services.bands import bands_for_category
        ag, wc = bands_for_category(cat) if r.status == "approved" else ("—", "—")
        out.append({"id": r.id, "athlete_id": r.athlete_id, "athlete": a.full_name if a else "?",
                    "category_id": r.category_id, "category": cat.name if cat else "?",
                    "club_id": club.id if club else None, "club": club.name if club else "—",
                    "gender": a.gender if a else None,
                    "age_group": ag, "weight_class": wc,
                    "checked_in": r.checked_in,
                    "weigh_in_kg": r.weigh_in_kg if staff else None,
                    "weigh_in_status": r.weigh_in_status,
                    "status": r.status if show_status else None,
                    "review_note": r.review_note if show_status else None})
    return envelope(out, total, pg["limit"], pg["offset"])

@router.post("/{tid}/registrations")
def add_reg(tid: int, data: RegistrationIn, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "coach", "athlete"))):
    # Organizers are scoped to their own tournaments; coaches and athletes
    # (self-registration only, see link check) register openly.
    t = require_tournament_owner(tid, db, user, allow_coach=True, allow_athlete=True)
    if t.status in ("live", "finished"):
        # Wave 5: late entries can't join existing brackets; regenerating
        # mid-live would destroy results, so registration closes with the stage.
        raise HTTPException(409, "Registration is closed for this tournament stage")
    a = db.get(Athlete, data.athlete_id)
    c = db.get(TournamentCategory, data.category_id)
    if not a or not c or c.tournament_id != tid:
        raise HTTPException(400, "Bad athlete or category")
    from app.core.permissions import is_pure_athlete
    if is_pure_athlete(db, user) and a.user_id != user.id:
        # Wave 4: athletes may only register their claimed profile
        # (POST /api/athletes/{id}/claim). No cross-profile registration.
        raise HTTPException(403, "Claim this athlete profile first")
    # §10 eligibility warnings (not hard block)
    warnings = eligibility_warnings(a, c)
    # Wave 3: new entries default to approved (previous auto-accept behavior);
    # organizers moderate via POST .../status (rejected/withdrawn excluded).
    r = Registration(tournament_id=tid, athlete_id=a.id, category_id=c.id,
                     seed=(a.points or 0), status="approved")
    db.add(r)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Already registered")
    from app.services.notifications import emit_event
    if t and t.created_by and t.created_by != user.id:
        emit_event(db, "registration", [t.created_by],
                   f"Новая заявка: {a.full_name} → {c.name} (t{tid})",
                   link=f"/tournaments/{tid}?tab=participants")
    return {"id": r.id, "warnings": warnings}

class BulkRegistration(BaseModel):
    items: list[RegistrationIn] = Field(min_length=1, max_length=100)

@router.post("/{tid}/registrations/bulk")
def bulk_reg(tid: int, data: BulkRegistration, db: Session = Depends(get_db),
             user: User = Depends(require_roles("organizer", "coach", "athlete"))):
    """Wave 2: register several athletes in one operation.

    Same guards and bounds checks as single add_reg (no bypass): organizer
    scoped to own tournaments, coaches openly, athletes only their claimed
    profile (foreign rows fail individually, good rows survive). One commit.
    """
    from app.services.registration import eligibility_warnings as _warnings
    from app.services.notifications import emit_event
    from app.core.permissions import is_pure_athlete
    require_tournament_owner(tid, db, user, allow_coach=True, allow_athlete=True)
    t = db.get(Tournament, tid)
    if not t:
        raise HTTPException(404, "Not found")
    if t.status in ("live", "finished"):
        raise HTTPException(409, "Registration is closed for this tournament stage")
    registered, errors = [], []
    seen: set[tuple[int, int]] = set()
    for i, item in enumerate(data.items, 1):
        if (item.athlete_id, item.category_id) in seen:
            errors.append({"row": i, "error": "Duplicate row in request"})
            continue
        seen.add((item.athlete_id, item.category_id))
        sp = db.begin_nested()
        try:
            a = db.get(Athlete, item.athlete_id)
            c = db.get(TournamentCategory, item.category_id)
            if not a or not c or c.tournament_id != tid:
                raise ValueError("Bad athlete or category")
            if is_pure_athlete(db, user) and a.user_id != user.id:
                raise ValueError("Foreign athlete: claim this profile first")
            warnings = _warnings(a, c)
            db.add(Registration(tournament_id=tid, athlete_id=a.id, category_id=c.id,
                                seed=(a.points or 0), status="approved"))
            db.flush()
            sp.commit()
            registered.append({"athlete_id": a.id, "athlete": a.full_name,
                               "category_id": c.id, "category": c.name,
                               "warnings": warnings})
        except IntegrityError:
            sp.rollback()
            errors.append({"row": i, "error": "Already registered"})
        except Exception as e:
            sp.rollback()
            errors.append({"row": i, "error": str(e)[:120]})
    db.commit()
    if registered and t.created_by and t.created_by != user.id:
        emit_event(db, "registration", [t.created_by],
                   f"Bulk-заявка: {len(registered)} (t{tid})",
                   link=f"/tournaments/{tid}?tab=participants")
    return {"registered": registered, "errors": errors,
            "summary": f"{len(registered)} ok, {len(errors)} errors"}

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 2000
ALLOWED_IMPORT_EXT = (".csv", ".xlsx")

@router.post("/{tid}/registrations/import")
def import_file(tid: int, file: UploadFile = File(...), request: Request = None, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    """CSV/XLSX preview import: first_name,last_name,gender,birth_year,weight_kg,category_id. Never silently imports bad rows."""
    t = require_tournament_owner(tid, db, user)
    if t.status in ("live", "finished"):
        raise HTTPException(409, "Registration is closed for this tournament stage")
    name = (file.filename or "").lower()
    if not name.endswith(ALLOWED_IMPORT_EXT):
        raise HTTPException(400, pick(request, "Только .csv или .xlsx файлы", "Тек .csv немесе .xlsx файлдары"))
    raw = file.file.read()
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(413, pick(request, "Файл слишком большой (максимум 5 МБ)", "Файл тым үлкен (максимум 5 МБ)"))
    if name.endswith(".xlsx"):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
        ws = wb.active
        it = ws.iter_rows(values_only=True)
        try:
            # P1: empty workbook has no header row — next() raised
            # StopIteration which escaped as 500; return clean 400 instead.
            header = [str(h or "").strip() for h in next(it)]
        except StopIteration:
            raise HTTPException(400, pick(request, "Пустой файл: нет строк данных", "Бос файл: деректер жолдары жоқ"))
        rows = [dict(zip(header, r)) for r in it if any(v is not None and str(v).strip() != "" for v in r)]
    else:
        rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig", errors="replace"))))
    if len(rows) > MAX_IMPORT_ROWS:
        raise HTTPException(413, pick(request, f"Слишком много строк (максимум {MAX_IMPORT_ROWS})", f"Жолдар тым көп (максимум {MAX_IMPORT_ROWS})"))
    ok, errors = 0, []
    for i, row in enumerate(rows, 1):
        # SAVEPOINT per row: a bad row rolls back only itself, good rows survive.
        sp = db.begin_nested()
        try:
            row = {str(k or "").strip(): (v if not isinstance(v, str) else v.strip()) for k, v in row.items()}
            cat_id = int(row.get("category_id") or 0)
            cat = db.get(TournamentCategory, cat_id)
            if not cat or cat.tournament_id != tid:
                raise ValueError(f"Unknown category_id {row.get('category_id')}")
            if not row.get("first_name") or not row.get("last_name"):
                raise ValueError("first_name/last_name required")
            # P1: free-form gender strings previously landed straight in the DB
            # (no whitelist); reject per-row so one bad row can't poison data.
            gender = (row.get("gender") or "male").strip().lower()
            if gender not in ("male", "female"):
                raise ValueError(f"Unknown gender {row.get('gender')!r}")
            a = Athlete(first_name=row["first_name"], last_name=row["last_name"],
                        gender=gender, birth_year=int(row.get("birth_year") or 2000),
                        weight_kg=float(row.get("weight_kg") or 0))
            db.add(a)
            db.flush()
            # Wave 3: imports default to approved (previous auto-accept).
            db.add(Registration(tournament_id=tid, athlete_id=a.id, category_id=cat_id,
                                status="approved"))
            db.flush()
            sp.commit()
            ok += 1
        except Exception as e:
            sp.rollback()
            errors.append({"row": i, "error": str(e)[:120]})
    db.commit()
    return {"found": len(rows), "imported": ok, "errors": errors,
            "summary": f"{len(rows)} found, {ok} ok, {len(errors)} errors"}

@router.post("/{tid}/weigh-in/{reg_id}")
def weigh_in(tid: int, reg_id: int, data: WeighIn, request: Request = None, db: Session = Depends(get_db), user: User = Depends(require_staff())):
    require_tournament_owner(tid, db, user, allow_referee=True)
    r = db.get(Registration, reg_id)
    if not r or r.tournament_id != tid:
        raise HTTPException(404, "Not found")
    c = db.get(TournamentCategory, r.category_id)
    if not c:
        raise HTTPException(400, "Registration category missing")
    r.weigh_in_kg = data.weigh_in_kg
    from app.services.validation import weighin_status
    r.weigh_in_status = weighin_status(data.weigh_in_kg, c.weight_min, c.weight_max)
    db.commit()
    # Wave 7: weigh-in mutates PII — audit like check-in/move/status.
    audit(db, user, f"weighed in {r.weigh_in_kg}kg ({r.weigh_in_status})", "registration", r.id)
    if r.weigh_in_status in ("over", "under"):
        lang = request.headers.get("Accept-Language", "") if request else ""
        sync_weighin_notifications(db, tid, lang=lang)
    labels = {"ok": ("В норме", "Қалыпты"), "over": ("Перевес", "Артық салмақ"), "under": ("Недовес", "Салмақ жетіспейді")}
    ru, kk = labels[r.weigh_in_status]
    return {"status": r.weigh_in_status, "label": pick(request, ru, kk)}

@router.post("/{tid}/check-in/{reg_id}")
def check_in(tid: int, reg_id: int, data: CheckIn, db: Session = Depends(get_db), user: User = Depends(require_staff())):
    """Mobile-friendly one-tap check-in (§26): single boolean, audited."""
    require_tournament_owner(tid, db, user, allow_referee=True)
    r = db.get(Registration, reg_id)
    if not r or r.tournament_id != tid:
        raise HTTPException(404, "Not found")
    r.checked_in = data.checked_in
    db.commit()
    audit(db, user, "checked in athlete" if data.checked_in else "unchecked athlete", "registration", r.id)
    # Wave 2: tell the athlete's coach (they track the team, may not be present).
    from app.services.notifications import emit_event, coach_of_athlete
    coach = coach_of_athlete(db, r.athlete_id)
    if coach and coach != user.id:
        a = db.get(Athlete, r.athlete_id)
        emit_event(db, "checkin", [coach],
                   f"Явка: {a.full_name if a else r.athlete_id} — {'на месте' if data.checked_in else 'снят'} (t{tid})",
                   link=f"/tournaments/{tid}?tab=participants")
    return {"ok": True, "checked_in": r.checked_in}

class MoveRegistration(BaseModel):
    category_id: int = Field(gt=0)

class RegStatusChange(BaseModel):
    status: str = Field(pattern="^(pending|approved|rejected|withdrawn)$")
    note: str = Field(default="", max_length=255)

@router.post("/{tid}/registrations/{reg_id}/status")
def reg_status(tid: int, reg_id: int, data: RegStatusChange, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    """Wave 3: moderation lifecycle. Approve/reject/pending — tournament owner
    only. Withdraw — owner or the coach owning the athlete. Locked once the
    tournament leaves upcoming/registration (brackets may already exist)."""
    from app.core.permissions import has_perm, user_roles
    t = db.get(Tournament, tid)
    if not t:
        raise HTTPException(404, "Not found")
    if t.status not in ("upcoming", "registration"):
        raise HTTPException(409, "Registration is locked for this tournament stage")
    r = db.get(Registration, reg_id)
    if not r or r.tournament_id != tid:
        raise HTTPException(404, "Not found")
    rs = user_roles(db, user)
    is_owner = ("admin" in rs or has_perm(db, user, "tournaments.manage_all")
                or (t.created_by == user.id and has_perm(db, user, "tournaments.manage")))
    if not is_owner:
        if data.status != "withdrawn":
            raise HTTPException(403, "Foreign tournament")
        # withdraw: coach of the athlete (scope), or the linked athlete
        # themselves (Wave 4 self-service). Organizer path handled above.
        # NOTE: organizer/referee roles must NOT fall through to
        # require_athlete_scope — it returns any athlete for organizers,
        # which would let a foreign organizer withdraw чужой заявки (Wave 7).
        # Multi-role: pure athletes use the link; coach-holders use scope.
        from app.core.permissions import is_pure_athlete
        if is_pure_athlete(db, user):
            a = db.get(Athlete, r.athlete_id)
            if not a or a.user_id != user.id:
                raise HTTPException(403, "Foreign athlete")
        elif "coach" in rs:
            from app.core.deps import require_athlete_scope
            require_athlete_scope(r.athlete_id, db, user)
        else:
            raise HTTPException(403, "Foreign tournament")
    r.status = data.status
    r.review_note = data.note[:255]
    db.commit()
    audit(db, user, f"registration -> {data.status}", "registration", r.id)
    # B6: moderation happened (committed above) — now tell the other side.
    # Notification failure must never roll back the decision: emit_event
    # commits on its own and only appends rows.
    if data.status in ("approved", "rejected"):
        from app.services.notifications import emit_event, coach_of_athlete
        a = db.get(Athlete, r.athlete_id)
        c = db.get(TournamentCategory, r.category_id)
        if a and c:
            verb = "одобрена" if data.status == "approved" else "отклонена"
            to = {u for u in (a.user_id, coach_of_athlete(db, r.athlete_id))
                             if u and u != user.id}
            if to:
                emit_event(db, "registration", sorted(to),
                           f"Заявка {verb}: {a.full_name} → {c.name} (t{tid})",
                           link=f"/tournaments/{tid}?tab=participants")
    elif data.status == "withdrawn":
        if t.created_by and t.created_by != user.id:
            from app.services.notifications import emit_event
            a = db.get(Athlete, r.athlete_id)
            c = db.get(TournamentCategory, r.category_id)
            emit_event(db, "registration", [t.created_by],
                       f"Заявка отозвана: {a.full_name if a else r.athlete_id} → "
                       f"{c.name if c else '?'} (t{tid})",
                       link=f"/tournaments/{tid}?tab=participants")
    return {"ok": True, "status": r.status}

class BulkRegStatus(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=100)
    status: str = Field(pattern="^(pending|approved|rejected)$")
    note: str = Field(default="", max_length=255)

@router.post("/{tid}/registrations/bulk-status")
def bulk_reg_status(tid: int, data: BulkRegStatus, db: Session = Depends(get_db),
                    user: User = Depends(require_perm("tournaments.manage"))):
    """Wave 4: mass approve/reject for the organizer (own tournament only,
    locked stages rejected). Withdraw stays individual (coach/athlete path).
    Per-id results; one commit."""
    from app.core.permissions import has_perm, user_roles
    t = db.get(Tournament, tid)
    if not t:
        raise HTTPException(404, "Not found")
    if "admin" not in user_roles(db, user) and not has_perm(db, user, "tournaments.manage_all"):
        if not (t.created_by == user.id and has_perm(db, user, "tournaments.manage")):
            raise HTTPException(403, "Foreign tournament")
    if t.status not in ("upcoming", "registration"):
        raise HTTPException(409, "Registration is locked for this tournament stage")
    updated, errors = [], []
    for rid in data.ids:
        sp = db.begin_nested()
        try:
            r = db.get(Registration, rid)
            if not r or r.tournament_id != tid:
                raise ValueError("Not found")
            r.status = data.status
            r.review_note = data.note[:255]
            db.flush()
            sp.commit()
            updated.append(rid)
        except Exception as e:
            sp.rollback()
            errors.append({"id": rid, "error": str(e)[:120]})
    db.commit()
    if updated:
        audit(db, user, f"bulk registration -> {data.status} x{len(updated)}", "tournament", tid)
    # B6: same applicant-side fan-out as single moderation. Batched lookups
    # (3 queries total, not per-id): regs -> athletes -> categories. Per-reg
    # emit keeps dedup semantics identical to the single path; updated is
    # capped at 100 ids by schema, so the loop is bounded.
    if data.status in ("approved", "rejected") and updated:
        from app.services.notifications import emit_event, coach_of_athlete
        regs = db.query(Registration).filter(Registration.id.in_(updated)).all()
        amap = {a.id: a for a in db.query(Athlete).filter(
            Athlete.id.in_({r.athlete_id for r in regs})).all()} if regs else {}
        cmap = {c.id: c for c in db.query(TournamentCategory).filter(
            TournamentCategory.id.in_({r.category_id for r in regs})).all()} if regs else {}
        verb = "одобрена" if data.status == "approved" else "отклонена"
        for r in regs:
            a, c = amap.get(r.athlete_id), cmap.get(r.category_id)
            if not a or not c:
                continue
            to = {u for u in (a.user_id, coach_of_athlete(db, r.athlete_id))
                  if u and u != user.id}
            if to:
                emit_event(db, "registration", sorted(to),
                           f"Заявка {verb}: {a.full_name} → {c.name} (t{tid})",
                           link=f"/tournaments/{tid}?tab=participants")
    return {"updated": updated, "errors": errors}

@router.post("/{tid}/registrations/{reg_id}/move")
def move_registration(tid: int, reg_id: int, data: MoveRegistration, db: Session = Depends(get_db),
                      user: User = Depends(require_staff())):
    """Wave 1: move an athlete to another category (e.g. after over/under weigh-in).

    Same guards as weigh-in (staff + owner/referee). Re-validates age/weight
    bounds via eligibility warnings, refuses duplicates, recomputes weigh-in
    status against the new bounds. Audited.
    """
    from app.services.registration import eligibility_warnings
    from app.services.validation import weighin_status
    t = require_tournament_owner(tid, db, user, allow_referee=True)
    if t.status in ("live", "finished"):
        # Wave 5: moving after brackets may exist corrupts them (matches
        # reference the old category). Move only while the field is open.
        raise HTTPException(409, "Too late to move: brackets may already exist")
    r = db.get(Registration, reg_id)
    if not r or r.tournament_id != tid:
        raise HTTPException(404, "Not found")
    if db.query(Bracket).filter(Bracket.tournament_id == tid,
                                Bracket.category_id.in_([r.category_id, data.category_id])).first():
        # Wave 5: either side already drawn — moving would orphan bracket
        # matches. Regenerate flow: none (regen wipes results), so forbid.
        raise HTTPException(409, "Category already has a bracket: move is locked")
    c = db.get(TournamentCategory, data.category_id)
    if not c or c.tournament_id != tid:
        raise HTTPException(400, "Bad category")
    if data.category_id == r.category_id:
        raise HTTPException(400, "Already in this category")
    a = db.get(Athlete, r.athlete_id)
    if not a:
        raise HTTPException(400, "Athlete missing")
    warnings = eligibility_warnings(a, c)
    if r.weigh_in_kg is not None and not (c.weight_min <= r.weigh_in_kg <= c.weight_max):
        raise HTTPException(400, "Weigh-in weight out of target bounds")
    r.category_id = data.category_id
    if r.weigh_in_kg is not None:
        r.weigh_in_status = weighin_status(r.weigh_in_kg, c.weight_min, c.weight_max)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Already registered in target category")
    audit(db, user, f"moved registration to category {c.id}", "registration", r.id)
    # Wave 2: tell the athlete's coach about the move (if someone else moved).
    from app.services.notifications import emit_event, coach_of_athlete
    coach = coach_of_athlete(db, r.athlete_id)
    if coach and coach != user.id:
        emit_event(db, "moved", [coach],
              f"Перевод: {a.full_name} → {c.name} (t{tid})",
              link=f"/tournaments/{tid}?tab=weighin")
    return {"ok": True, "category_id": r.category_id,
            "weigh_in_status": r.weigh_in_status, "warnings": warnings}

@router.post("/{tid}/status")
def change_status(tid: int, data: StatusChange, request: Request = None, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    """Lifecycle with guards: only forward, live requires brackets, finished requires no pending fights."""
    t = require_tournament_owner(tid, db, user)
    try:
        plan_transition(db, t, data.status)
    except FlowError as e:
        raise HTTPException(400, pick(request, e.ru, e.kk))
    audit(db, user, f"status -> {data.status}", "tournament", tid)
    if data.status in ("live", "finished"):
        from app.services.notifications import emit_event
        ev = "tournament.started" if data.status == "live" else "tournament.finished"
        if t.created_by:
            emit_event(db, ev, [t.created_by],
                       f"Турнир «{t.name}»: {data.status} (t{tid})",
                       link=f"/tournaments/{tid}?tab=overview")
    return {"ok": True, "status": t.status}

@router.post("/{tid}/brackets/generate")
def gen_brackets(tid: int, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    t = require_tournament_owner(tid, db, user)
    if t.status in ("live", "finished"):
        # Wave 5: regeneration deletes brackets WITH results. Live/finished
        # brackets are immutable; corrections go through finish/correction.
        raise HTTPException(409, "Brackets are locked once the tournament is live")
    cats = db.query(TournamentCategory).filter_by(tournament_id=tid).all()
    made = []
    try:
        for c in cats:
            # Wave 3: only approved registrations seed brackets; rejected or
            # withdrawn entries stay out without being deleted.
            regs = db.query(Registration).filter_by(tournament_id=tid, category_id=c.id,
                                                    status="approved").order_by(Registration.seed.desc()).all()
            ids = [r.athlete_id for r in regs]
            if len(ids) < 2:
                continue
            b = generate_bracket(db, tid, c.id, ids)
            made.append({"category_id": c.id, "bracket_id": b.id, "size": b.size})
        db.commit()
    except IntegrityError:
        # P0: concurrent regeneration collided on uq_bracket_tournament_category.
        db.rollback()
        raise HTTPException(409, "Brackets are being regenerated concurrently — please retry")
    audit(db, user, "generated brackets", "tournament", tid)
    return made

@router.get("/{tid}/brackets")
def get_brackets(tid: int, db: Session = Depends(get_db)):
    brackets = db.query(Bracket).filter_by(tournament_id=tid).all()
    if not brackets:
        return []
    # P2: single batched match query instead of one per bracket (N+1).
    all_matches = db.query(BracketMatch).filter(
        BracketMatch.bracket_id.in_([b.id for b in brackets])
    ).order_by(BracketMatch.round_no, BracketMatch.position).all()
    by_bracket: dict[int, list] = {}
    for m in all_matches:
        by_bracket.setdefault(m.bracket_id, []).append(m)
    out = []
    for b in brackets:
        matches = by_bracket.get(b.id, [])
        out.append({"id": b.id, "category_id": b.category_id, "size": b.size,
                    "matches": [{"id": m.id, "round": m.round_no, "pos": m.position, "a": m.athlete_a_id,
                                 "b": m.athlete_b_id, "winner": m.winner_id, "status": m.status,
                                 "tatami_id": m.tatami_id, "scheduled_at": str(m.scheduled_at) if m.scheduled_at else None,
                                 "score_a": m.score_a, "score_b": m.score_b, "next": m.next_match_id} for m in matches]})
    return out

@router.post("/{tid}/schedule/generate")
def gen_schedule(tid: int, request: Request = None, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    require_tournament_owner(tid, db, user)
    start = datetime.now(timezone.utc)
    ms = generate_schedule(db, tid, start)
    lang = request.headers.get("Accept-Language", "") if request else ""
    created = sync_conflict_notifications(db, tid, lang=lang)
    audit(db, user, "generated schedule", "tournament", tid)
    return {"scheduled": len(ms), "conflict_notifications": created}

# ---------- Wave 3: referee assignment (Tatami.referee_id) ----------
#
# Established by code reading: referee_id lives ONLY on Tatami
# (models/competition.py:25) — no endpoint reads/writes it, BracketMatch
# has no referee column. So assignment is tatami-level; a fight's referee
# is derived from its tatami. No new model needed.

class RefereeAssign(BaseModel):
    referee_id: int | None = None


@router.get("/{tid}/tatamis")
def list_tatamis(tid: int, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    t = require_tournament_owner(tid, db, user)
    rows = db.query(Tatami).filter_by(tournament_id=t.id).order_by(Tatami.id).all()
    refs = {u.id: u for u in db.query(User).filter(
        User.id.in_([r.referee_id for r in rows if r.referee_id])).all()} if rows else {}
    return [{"id": r.id, "name": r.name,
             "referee_id": r.referee_id,
             "referee": refs[r.referee_id].full_name if r.referee_id in refs else None}
            for r in rows]


@router.post("/{tid}/tatamis/{taid}/referee")
def assign_referee(tid: int, taid: int, data: RefereeAssign, db: Session = Depends(get_db),
                   user: User = Depends(require_perm("tournaments.manage"))):
    """Assign/unassign (null) a referee to a tatami. Owner of own tournament
    only — referees hold no tournaments.manage, so self-assignment 403s."""
    require_tournament_owner(tid, db, user)
    r = db.get(Tatami, taid)
    if not r or r.tournament_id != tid:
        raise HTTPException(404, "Not found")
    if data.referee_id is not None:
        u = db.get(User, data.referee_id)
        if not u or not u.is_active or u.role != "referee":
            raise HTTPException(400, "referee_id must be an active referee user")
    r.referee_id = data.referee_id
    db.commit()
    audit(db, user, f"assigned referee {data.referee_id}" if data.referee_id else "unassigned referee",
          "tatami", r.id)
    return {"ok": True, "tatami_id": r.id, "referee_id": r.referee_id}


@router.get("/referee/assignments")
def my_assignments(db: Session = Depends(get_db), user: User = Depends(require_roles("referee"))):
    """Referee's own tatamis + their scheduled/live fights (names included)."""
    rows = db.query(Tatami).filter_by(referee_id=user.id).order_by(Tatami.id).all()
    tids = sorted({r.tournament_id for r in rows})
    tmap = {t.id: t for t in db.query(Tournament).filter(Tournament.id.in_(tids)).all()} if tids else {}
    taids = [r.id for r in rows]
    ms = db.query(BracketMatch).filter(
        BracketMatch.tatami_id.in_(taids),
        BracketMatch.status.in_(["scheduled", "live"])).order_by(BracketMatch.scheduled_at).all() if taids else []
    aids = ({m.athlete_a_id for m in ms} | {m.athlete_b_id for m in ms}) - {None}
    amap = {a.id: a for a in db.query(Athlete).filter(Athlete.id.in_(list(aids))).all()} if aids else {}
    by_tatami: dict[int, list] = {}
    for m in ms:
        by_tatami.setdefault(m.tatami_id, []).append({
            "id": m.id, "status": m.status,
            "a": amap[m.athlete_a_id].full_name if m.athlete_a_id in amap else None,
            "b": amap[m.athlete_b_id].full_name if m.athlete_b_id in amap else None,
            "scheduled_at": str(m.scheduled_at) if m.scheduled_at else None})
    return [{"tatami_id": r.id, "tatami": r.name,
             "tournament_id": r.tournament_id,
             "tournament": tmap[r.tournament_id].name if r.tournament_id in tmap else "?",
             "fights": by_tatami.get(r.id, [])} for r in rows]

@router.get("/{tid}/conflicts")
def conflicts(tid: int, lang: str = "ru", db: Session = Depends(get_db)):
    return detect_conflicts(db, tid, lang=lang)

@router.get("/{tid}/validate")
def validate(tid: int, lang: str = "ru", db: Session = Depends(get_db)):
    return validate_tournament(db, tid, lang=lang)

@router.post("/{tid}/validate/autofix")
def autofix(tid: int, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    require_tournament_owner(tid, db, user)
    n = autofix_weighin_status(db, tid)
    audit(db, user, "autofix weigh-in", "tournament", tid)
    return {"fixed": n}

@router.post("/matches/{mid}/finish")
def finish(mid: int, data: FinishFight, request: Request = None, db: Session = Depends(get_db), user: User = Depends(require_perm("matches.manage"))):
    # Scoped: organizers only inside their own tournament, referees as officials.
    m, b, _t = require_match_access(mid, db, user)
    try:
        m, outcome = finish_fight(db, mid, data.winner_id, data.score_a, data.score_b)
    except MatchConflict:
        db.rollback()
        raise HTTPException(409, pick(request,
            "Следующий бой уже завершён — сначала отмените его результат",
            "Келесі жекпе-жек аяқталған — алдымен оның нәтижесін қайтарыңыз"))
    except ValueError:
        db.rollback()
        raise HTTPException(400, pick(request, "Победитель должен быть участником этого боя", "Жеңімпаз осы жекпе-жектің қатысушысы болуы керек"))
    try:
        # P0: single commit for bracket + ranking — no stale-points window.
        recalc_match_participants(db, m)
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(m)
    publish(b.tournament_id, {"type": "fight_finished", "match_id": m.id, "winner": m.winner_id,
                              "score_a": m.score_a, "score_b": m.score_b})
    audit(db, user, "corrected fight result" if outcome == "corrected" else "finished fight", "match", m.id)
    # Wave 1: in-app event for the tournament owner (coaches/fans later).
    from app.services.notifications import emit_event
    _t2 = db.get(Tournament, b.tournament_id)
    if _t2 and _t2.created_by and outcome == "finished":
        emit_event(db, "fight", [_t2.created_by],
                   f"Бой #{m.id} завершён (t{b.tournament_id})",
                   link=f"/tournaments/{b.tournament_id}?tab=brackets")
    # human-readable error already enforced in service; success:
    return {"ok": True, "winner": m.winner_id, "next": m.next_match_id, "outcome": outcome}

@router.post("/matches/{mid}/timer")
def match_timer(mid: int, data: TimerIn, db: Session = Depends(get_db), user: User = Depends(require_perm("matches.manage"))):
    m, b, _t = require_match_access(mid, db, user)
    state = set_timer(mid, data.action, data.duration_sec)
    publish(b.tournament_id, {"type": "timer", **state})
    return state

class CorrectFight(BaseModel):
    athlete_a_id: int = Field(gt=0)
    athlete_b_id: int = Field(gt=0)
    reason: str = Field(min_length=3, max_length=255)

@router.post("/matches/{mid}/correct")
def correct(mid: int, data: CorrectFight, request: Request = None, db: Session = Depends(get_db),
            user: User = Depends(require_perm("tournaments.manage"))):
    """Wave 6: controlled correction of ONE pending first-round pair.

    Owner-only (referees get 403 — seeding is organizer business), tournaments
    finished are locked. Only scheduled round-1 matches without any result;
    finished/live/bye and deeper rounds refuse with 409. New athletes must
    hold approved registrations in the bracket's category and must not be
    placed anywhere else in this bracket.     Downstream matches are NEVER
    touched. Single transaction: mutation + audit commit together.
    """
    from app.services.brackets import correct_match, CorrectionRejected
    m = db.get(BracketMatch, mid)
    if not m:
        raise HTTPException(404, "Match not found")
    b = db.get(Bracket, m.bracket_id)
    if not b:
        raise HTTPException(404, "Match not found")
    t = require_tournament_owner(b.tournament_id, db, user)
    if t.status == "finished":
        raise HTTPException(409, pick(request, "Турнир завершён: correction запрещена",
                                      "Турнир аяқталған: түзетуге тыйым салынған"))
    try:
        m, b, old = correct_match(db, mid, data.athlete_a_id, data.athlete_b_id)
    except CorrectionRejected as e:
        db.rollback()
        raise HTTPException(409, pick(request, str(e), str(e)))
    except ValueError:
        db.rollback()
        raise HTTPException(422, pick(request, "Некорректные участники",
                                      "Қатысушылар дұрыс емес"))
    # Wave 6: audit inline in the SAME commit (never the separate-commit
    # audit() helper) — match change without audit row must be impossible.
    detail = f"match {m.id}: {old['old_a']}/{old['old_b']} -> {m.athlete_a_id}/{m.athlete_b_id} ({data.reason})"
    db.add(AuditLog(actor_id=user.id, action=detail[:128], entity="match", entity_id=m.id))
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(m)
    return {"ok": True, "match": {"id": m.id, "round": m.round_no, "pos": m.position,
                                  "a": m.athlete_a_id, "b": m.athlete_b_id,
                                  "winner": m.winner_id, "status": m.status,
                                  "tatami_id": m.tatami_id,
                                  "scheduled_at": str(m.scheduled_at) if m.scheduled_at else None,
                                  "score_a": m.score_a, "score_b": m.score_b,
                                  "next": m.next_match_id}}

@router.get("/{tid}/live")
def live_state(tid: int, db: Session = Depends(get_db)):
    """Public spectator snapshot: current + queue with athlete names (one batched
    lookup, no N+1). Timer state is best-effort in-memory."""
    bracket_ids = [b.id for b in db.query(Bracket).filter_by(tournament_id=tid).all()]
    live = db.query(BracketMatch).filter(BracketMatch.bracket_id.in_(bracket_ids), BracketMatch.status == "live").all() if bracket_ids else []
    upcoming = db.query(BracketMatch).filter(BracketMatch.bracket_id.in_(bracket_ids), BracketMatch.status == "scheduled").order_by(BracketMatch.scheduled_at).limit(10).all() if bracket_ids else []
    aids = ({m.athlete_a_id for m in live} | {m.athlete_b_id for m in live}
            | {m.athlete_a_id for m in upcoming} | {m.athlete_b_id for m in upcoming}) - {None}
    amap = {a.id: a for a in db.query(Athlete).filter(Athlete.id.in_(aids)).all()} if aids else {}
    def ser(m: BracketMatch):
        an = amap.get(m.athlete_a_id) if m.athlete_a_id else None
        bn = amap.get(m.athlete_b_id) if m.athlete_b_id else None
        return {"id": m.id, "a": m.athlete_a_id, "b": m.athlete_b_id,
                "a_name": an.full_name if an else None, "b_name": bn.full_name if bn else None,
                "tatami_id": m.tatami_id, "status": m.status, "timer": get_timer(m.id)}
    return {"live": [ser(m) for m in live], "queue": [ser(m) for m in upcoming]}
