from __future__ import annotations
import csv, io
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Request
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
from datetime import datetime, timezone

router = APIRouter(prefix="/api/tournaments", tags=["tournaments"])

def audit(db: Session, user: User | None, action: str, entity: str = "", entity_id: int | None = None):
    db.add(AuditLog(actor_id=user.id if user else None, action=action, entity=entity, entity_id=entity_id))
    db.commit()

def to_dict(t: Tournament, db: Session) -> dict:
    count = db.query(Registration).filter_by(tournament_id=t.id).count()
    return {"id": t.id, "name": t.name, "city": t.city, "country": t.country, "organization": t.organization,
            "start_date": str(t.start_date), "status": t.status, "type": t.type,
            "tatami_count": t.tatami_count, "participants": count, "created_by": t.created_by}

@router.get("")
def list_tournaments(q: str = "", country: str = "", status: str = "",
                     pg: dict = Depends(page_args), db: Session = Depends(get_db)):
    query = db.query(Tournament).order_by(Tournament.start_date)
    if q:
        like = f"%{escape_like(q)}%"
        query = query.filter(Tournament.name.ilike(like, escape="\\"))
    if country:
        query = query.filter_by(country=country)
    if status:
        query = query.filter_by(status=status)
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
             "tatami_count": t.tatami_count, "participants": counts.get(t.id, 0),
             "created_by": t.created_by}
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
    return to_dict(t, db)

@router.get("/{tid}")
def get_tournament(tid: int, db: Session = Depends(get_db)):
    t = db.get(Tournament, tid)
    if not t:
        raise HTTPException(404, "Not found")
    cats = db.query(TournamentCategory).filter_by(tournament_id=tid).all()
    return {**to_dict(t, db), "categories": [{"id": c.id, "name": c.name, "gender": c.gender, "age_min": c.age_min,
            "age_max": c.age_max, "weight_min": c.weight_min, "weight_max": c.weight_max} for c in cats]}

@router.post("/{tid}/categories")
def add_category(tid: int, data: CategoryIn, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    require_tournament_owner(tid, db, user)
    c = TournamentCategory(tournament_id=tid, **data.model_dump())
    db.add(c)
    db.commit()
    # suspicious-category hint (§10/§46): tiny check returned inline
    return {"id": c.id, **data.model_dump()}

@router.get("/{tid}/registrations")
def list_regs(tid: int, request: Request, pg: dict = Depends(page_args),
              db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    """Public participant list; exact weigh-in weight is PII — only tournament
    staff (owner-organizer, referee, admin) see it, others get the status."""
    t = db.get(Tournament, tid)
    if not t:
        raise HTTPException(404, "Not found")
    # P1: staff check via permissions (not raw role==) so a coach granted
    # tournaments.manage on their own tournament sees weights, consistent with
    # require_tournament_owner which already lets them through.
    from app.core.permissions import has_perm
    staff = bool(user and (user.role == "admin" or user.role == "referee"
                           or (t.created_by == user.id and has_perm(db, user, "tournaments.manage"))))
    regs, total = paginate(db.query(Registration).filter_by(tournament_id=tid).order_by(Registration.id),
                           pg["limit"], pg["offset"])
    amap = {a.id: a for a in db.query(Athlete).filter(
        Athlete.id.in_([r.athlete_id for r in regs])).all()} if regs else {}
    out = []
    for r in regs:
        a = amap.get(r.athlete_id)
        out.append({"id": r.id, "athlete_id": r.athlete_id, "athlete": a.full_name if a else "?",
                    "category_id": r.category_id, "seed": r.seed, "checked_in": r.checked_in,
                    "weigh_in_kg": r.weigh_in_kg if staff else None,
                    "weigh_in_status": r.weigh_in_status})
    return envelope(out, total, pg["limit"], pg["offset"])

@router.post("/{tid}/registrations")
def add_reg(tid: int, data: RegistrationIn, db: Session = Depends(get_db), user: User = Depends(require_roles("organizer", "coach"))):
    # Organizers are scoped to their own tournaments; coaches register openly.
    require_tournament_owner(tid, db, user, allow_coach=True)
    a = db.get(Athlete, data.athlete_id)
    c = db.get(TournamentCategory, data.category_id)
    if not a or not c or c.tournament_id != tid:
        raise HTTPException(400, "Bad athlete or category")
    # §10 eligibility warnings (not hard block)
    warnings = eligibility_warnings(a, c)
    r = Registration(tournament_id=tid, athlete_id=a.id, category_id=c.id,
                     seed=(a.points or 0))
    db.add(r)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, "Already registered")
    return {"id": r.id, "warnings": warnings}

MAX_IMPORT_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 2000
ALLOWED_IMPORT_EXT = (".csv", ".xlsx")

@router.post("/{tid}/registrations/import")
def import_file(tid: int, file: UploadFile = File(...), request: Request = None, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    """CSV/XLSX preview import: first_name,last_name,gender,birth_year,weight_kg,category_id. Never silently imports bad rows."""
    require_tournament_owner(tid, db, user)
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
            db.add(Registration(tournament_id=tid, athlete_id=a.id, category_id=cat_id))
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
    return {"ok": True, "checked_in": r.checked_in}

@router.post("/{tid}/status")
def change_status(tid: int, data: StatusChange, request: Request = None, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    """Lifecycle with guards: only forward, live requires brackets, finished requires no pending fights."""
    t = require_tournament_owner(tid, db, user)
    try:
        plan_transition(db, t, data.status)
    except FlowError as e:
        raise HTTPException(400, pick(request, e.ru, e.kk))
    audit(db, user, f"status -> {data.status}", "tournament", tid)
    return {"ok": True, "status": t.status}

@router.post("/{tid}/brackets/generate")
def gen_brackets(tid: int, db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    require_tournament_owner(tid, db, user)
    cats = db.query(TournamentCategory).filter_by(tournament_id=tid).all()
    made = []
    try:
        for c in cats:
            regs = db.query(Registration).filter_by(tournament_id=tid, category_id=c.id).order_by(Registration.seed.desc()).all()
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
    # human-readable error already enforced in service; success:
    return {"ok": True, "winner": m.winner_id, "next": m.next_match_id, "outcome": outcome}

@router.post("/matches/{mid}/timer")
def match_timer(mid: int, data: TimerIn, db: Session = Depends(get_db), user: User = Depends(require_perm("matches.manage"))):
    m, b, _t = require_match_access(mid, db, user)
    state = set_timer(mid, data.action, data.duration_sec)
    publish(b.tournament_id, {"type": "timer", **state})
    return state

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
