from fastapi import APIRouter, Depends, HTTPException
import json
from sqlalchemy.orm import Session
from app.core.db import get_db, escape_like
from app.core.deps import require_perm, get_current_user, get_optional_user, require_athlete_scope
from app.core.paging import page_args, paginate, envelope
from app.models.user import User
from app.models.club_athlete import Athlete, Club
from app.models.tournament import Tournament, TournamentCategory
from app.models.competition import Registration, Bracket, BracketMatch
from app.models.misc import News, Notification, Document, AuditLog
from app.schemas.api import AthleteIn, ClubIn, NewsIn

router = APIRouter(tags=["core"])

@router.get("/api/athletes")
def list_athletes(q: str = "", mine: bool = False, pg: dict = Depends(page_args),
                  db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    query = db.query(Athlete).order_by(Athlete.points.desc())
    if mine:
        if not user:
            raise HTTPException(401, "Not authenticated")
        own_clubs = [c.id for c in db.query(Club).filter_by(owner_id=user.id).all()]
        query = query.filter((Athlete.created_by == user.id) | (Athlete.club_id.in_(own_clubs)) if own_clubs
                             else (Athlete.created_by == user.id))
    if q:
        like = f"%{escape_like(q)}%"
        query = query.filter((Athlete.first_name.ilike(like, escape="\\")) | (Athlete.last_name.ilike(like, escape="\\")))
    rows, total = paginate(query, pg["limit"], pg["offset"])
    # Wave 2: gender/birth_year included so the coach bulk-registration UI
    # can auto-suggest a fitting category client-side (additive, no break).
    return envelope([{"id": a.id, "name": a.full_name, "club_id": a.club_id, "country": a.country, "points": a.points,
             "wins": a.wins, "losses": a.losses, "weight": a.weight_kg,
             "gender": a.gender, "birth_year": a.birth_year} for a in rows],
             total, pg["limit"], pg["offset"])

def _placement_from_matches(matches: list[BracketMatch], athlete_id: int) -> str:
    """champion > finalist > semifinalist > participant, pure python over preloaded matches."""
    if not matches:
        return "registered"
    by_id = {m.id: m for m in matches}
    finals = [m for m in matches if m.next_match_id is None]
    if any(m.winner_id == athlete_id for m in finals):
        return "champion"
    if any(m.athlete_a_id == athlete_id or m.athlete_b_id == athlete_id for m in finals):
        return "finalist"
    # semifinal = a fight whose winner goes straight into the final.
    semis = [m for m in matches if m.next_match_id is not None
             and (nxt := by_id.get(m.next_match_id)) is not None
             and nxt.next_match_id is None]
    if any(m.athlete_a_id == athlete_id or m.athlete_b_id == athlete_id for m in semis):
        return "semifinalist"
    return "participant"

@router.get("/api/athletes/{aid}")
def athlete_profile(aid: int, db: Session = Depends(get_db)):
    a = db.get(Athlete, aid)
    if not a:
        raise HTTPException(404, "Not found")
    club = db.get(Club, a.club_id) if a.club_id else None
    regs = db.query(Registration).filter_by(athlete_id=aid).all()
    tmap = {t.id: t for t in db.query(Tournament).filter(
        Tournament.id.in_([r.tournament_id for r in regs])).all()} if regs else {}
    cmap = {c.id: c for c in db.query(TournamentCategory).filter(
        TournamentCategory.id.in_([r.category_id for r in regs])).all()} if regs else {}
    brackets = db.query(Bracket).filter(
        Bracket.tournament_id.in_([r.tournament_id for r in regs])).all() if regs else []
    bmap = {(b.tournament_id, b.category_id): b for b in brackets}
    all_matches = db.query(BracketMatch).filter(
        BracketMatch.bracket_id.in_([b.id for b in brackets])).all() if brackets else []
    by_bracket: dict[int, list[BracketMatch]] = {}
    for m in all_matches:
        by_bracket.setdefault(m.bracket_id, []).append(m)
    history = []
    for r in regs:
        t = tmap.get(r.tournament_id)
        c = cmap.get(r.category_id)
        b = bmap.get((r.tournament_id, r.category_id))
        history.append({"tournament_id": r.tournament_id, "tournament": t.name if t else "?",
                        "date": str(t.start_date) if t else "", "category": c.name if c else "?",
                        "result": _placement_from_matches(by_bracket.get(b.id, []) if b else [], aid)})
    return {"id": a.id, "name": a.full_name, "first_name": a.first_name, "last_name": a.last_name,
            "gender": a.gender, "birth_year": a.birth_year,
            "weight": a.weight_kg, "level": a.level, "country": a.country,
            "club": club.name if club else "—", "club_id": a.club_id,
            "points": a.points, "wins": a.wins, "losses": a.losses, "history": history}

@router.post("/api/athletes")
def create_athlete(data: AthleteIn, db: Session = Depends(get_db), user=Depends(require_perm("athletes.manage"))):
    if data.club_id is not None:
        from app.core.permissions import has_role
        club = db.get(Club, data.club_id)
        if not club:
            raise HTTPException(400, "Unknown club_id")
        # P0: coach may attach athletes only to clubs they own; otherwise any
        # coach could hijack a foreign club by setting club_id on creation
        # (scope check in require_athlete_scope would then grant access via created_by).
        # Multi-role: organizer/admin scope is wider — restrict coaches only.
        if has_role(db, user, "coach") and not has_role(db, user, "organizer", "admin") \
                and club.owner_id != user.id:
            raise HTTPException(403, "Foreign club")
    a = Athlete(**data.model_dump(), created_by=user.id)
    db.add(a)
    db.commit()
    db.refresh(a)
    return {"id": a.id}

@router.put("/api/athletes/{aid}")
def update_athlete(aid: int, data: AthleteIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Edit an athlete. Organizer/admin: any; coach: only own athletes
    (created by them or in their club). Other roles: denied."""
    a = require_athlete_scope(aid, db, user)
    if data.club_id is not None:
        from app.core.permissions import has_role
        club = db.get(Club, data.club_id)
        if not club:
            raise HTTPException(400, "Unknown club_id")
        # P0: prevent moving an athlete into a foreign club without its owner's
        # consent. Organizer/admin may move freely; coach only into own clubs.
        if has_role(db, user, "coach") and not has_role(db, user, "organizer", "admin") \
                and club.owner_id != user.id:
            raise HTTPException(403, "Foreign club")
    for k, v in data.model_dump().items():
        setattr(a, k, v)
    db.commit()
    return {"ok": True, "id": a.id}

@router.get("/api/clubs")
def list_clubs(q: str = "", mine: bool = False, pg: dict = Depends(page_args),
               db: Session = Depends(get_db), user: User | None = Depends(get_optional_user)):
    query = db.query(Club).order_by(Club.id.desc())
    if mine:
        if not user:
            raise HTTPException(401, "Not authenticated")
        query = query.filter(Club.owner_id == user.id)
    if q:
        like = f"%{escape_like(q)}%"
        query = query.filter(Club.name.ilike(like, escape="\\"))
    rows, total = paginate(query, pg["limit"], pg["offset"])
    return envelope([{"id": c.id, "name": c.name, "country": c.country, "city": c.city, "coach": c.coach_name} for c in rows],
             total, pg["limit"], pg["offset"])

@router.post("/api/clubs")
def create_club(data: ClubIn, db: Session = Depends(get_db), user: User = Depends(require_perm("clubs.manage"))):
    c = Club(**data.model_dump(), owner_id=user.id)
    db.add(c)
    db.commit()
    return {"id": c.id}

@router.get("/api/clubs/{cid}")
def club_detail(cid: int, db: Session = Depends(get_db)):
    c = db.get(Club, cid)
    if not c:
        raise HTTPException(404, "Not found")
    athletes = db.query(Athlete).filter_by(club_id=cid).order_by(Athlete.points.desc()).all()
    titles = 0
    if athletes:
        from sqlalchemy import func
        titles = db.query(func.count(BracketMatch.id)).filter(
            BracketMatch.winner_id.in_([a.id for a in athletes]),
            BracketMatch.status == "finished",
            BracketMatch.next_match_id.is_(None)).scalar() or 0
    return {"id": c.id, "name": c.name, "country": c.country, "city": c.city, "coach": c.coach_name,
            "athletes": [{"id": a.id, "name": a.full_name, "points": a.points, "wins": a.wins, "losses": a.losses} for a in athletes],
            "titles": titles}

@router.get("/api/rankings")
def rankings(gender: str = "", country: str = "", weight_min: float = 0, weight_max: float = 999,
             pg: dict = Depends(page_args), db: Session = Depends(get_db)):
    q = db.query(Athlete).filter(Athlete.weight_kg >= weight_min, Athlete.weight_kg <= weight_max)
    if gender:
        q = q.filter(Athlete.gender == gender)
    if country:
        q = q.filter(Athlete.country == country)
    q = q.order_by(Athlete.points.desc())
    rows, total = paginate(q, pg["limit"], pg["offset"])
    return envelope([{"rank": pg["offset"] + i + 1, "id": a.id, "name": a.full_name, "club_id": a.club_id, "weight": a.weight_kg,
             "points": a.points, "wins": a.wins, "losses": a.losses} for i, a in enumerate(rows)],
             total, pg["limit"], pg["offset"])

@router.get("/api/news")
def list_news(pg: dict = Depends(page_args), db: Session = Depends(get_db)):
    rows, total = paginate(db.query(News).order_by(News.id.desc()), pg["limit"], pg["offset"])
    return envelope([{"id": n.id, "title": n.title, "slug": n.slug, "excerpt": n.excerpt, "category": n.category} for n in rows],
             total, pg["limit"], pg["offset"])

@router.post("/api/news")
def create_news(data: NewsIn, db: Session = Depends(get_db), user: User = Depends(require_perm("news.manage"))):
    if db.query(News).filter_by(slug=data.slug).first():
        raise HTTPException(400, "Slug already used")
    n = News(**data.model_dump(), author_id=user.id)
    db.add(n)
    db.commit()
    db.refresh(n)
    return {"id": n.id, "slug": n.slug}

@router.get("/api/news/{slug}")
def get_news(slug: str, db: Session = Depends(get_db)):
    n = db.query(News).filter_by(slug=slug).first()
    if not n:
        raise HTTPException(404, "Not found")
    return {"id": n.id, "title": n.title, "slug": n.slug, "excerpt": n.excerpt,
            "body": n.body, "category": n.category, "created_at": str(n.created_at)}

@router.put("/api/news/{nid}")
def update_news(nid: int, data: NewsIn, db: Session = Depends(get_db), user: User = Depends(require_perm("news.manage"))):
    n = db.get(News, nid)
    if not n:
        raise HTTPException(404, "Not found")
    # slug is the public URL: immutable after creation (prevents hijack/rot).
    for k, v in data.model_dump(exclude={"slug"}).items():
        setattr(n, k, v)
    db.commit()
    return {"ok": True}

@router.get("/api/referees")
def list_referees(db: Session = Depends(get_db), user: User = Depends(require_perm("tournaments.manage"))):
    """Wave 3: users available for tatami assignment (organizer tool, names only)."""
    rows = db.query(User).filter_by(role="referee", is_active=True).order_by(User.full_name).all()
    return [{"id": u.id, "name": u.full_name or u.email} for u in rows]


@router.get("/api/search")
def search(q: str, db: Session = Depends(get_db)):
    like = f"%{escape_like(q)}%"
    athletes = db.query(Athlete).filter((Athlete.first_name.ilike(like, escape="\\")) | (Athlete.last_name.ilike(like, escape="\\"))).limit(5).all()
    clubs = db.query(Club).filter(Club.name.ilike(like, escape="\\")).limit(5).all()
    return {"athletes": [{"id": a.id, "name": a.full_name} for a in athletes],
            "clubs": [{"id": c.id, "name": c.name} for c in clubs]}

@router.get("/api/notifications")
def list_notifications(unread_only: bool = False, pg: dict = Depends(page_args),
                       db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(Notification).filter_by(user_id=user.id)
    if unread_only:
        q = q.filter_by(is_read=False)
    q = q.order_by(Notification.id.desc())
    rows, total = paginate(q, pg["limit"], pg["offset"])
    unread = db.query(Notification).filter_by(user_id=user.id, is_read=False).count()
    return {"unread": unread,
            "items": [{"id": r.id, "type": r.type, "message": r.message, "link": r.link,
                       "is_read": r.is_read, "at": str(r.created_at)} for r in rows],
            "total": total, "limit": pg["limit"], "offset": pg["offset"]}

@router.post("/api/notifications/{nid}/read")
def read_notification(nid: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    n = db.get(Notification, nid)
    if not n or n.user_id != user.id:
        raise HTTPException(404, "Not found")
    n.is_read = True
    db.commit()
    return {"ok": True}


@router.post("/api/notifications/read-all")
def read_all_notifications(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Wave 2: mark all own notifications read in one atomic update."""
    n = db.query(Notification).filter_by(user_id=user.id, is_read=False).update({"is_read": True})
    db.commit()
    return {"ok": True, "marked": n}


@router.get("/api/athletes/{aid}/documents")
def athlete_documents(aid: int, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """Wave 2: athlete's public-kind documents (diplomas/participation/protocol).

    Requires login (codes are unguessable but enumerable per athlete).
    `spravka` kind is excluded — it carries PII and has its own scoped
    endpoint (`GET /api/spravki/{code}.pdf` with athlete-scope check).
    """
    a = db.get(Athlete, aid)
    if not a:
        raise HTTPException(404, "Not found")
    rows = db.query(Document).filter(
        Document.athlete_id == aid,
        Document.kind.in_(["participation", "diploma", "protocol"])).order_by(
        Document.id.desc()).all()
    tmap = {t.id: t for t in db.query(Tournament).filter(
        Tournament.id.in_([d.tournament_id for d in rows if d.tournament_id])).all()} if rows else {}
    out = []
    for d in rows:
        try:
            payload = json.loads(d.payload or "{}")
        except ValueError:
            payload = {}
        t = tmap.get(d.tournament_id) if d.tournament_id else None
        out.append({"code": d.code, "kind": d.kind,
                    "tournament": t.name if t else "?",
                    "date": str(t.start_date) if t else "",
                    "place": payload.get("place", ""),
                    "category": payload.get("category", "")})
    return out


# ---------- Wave 4: athlete identity (claim) + my applications ----------

@router.post("/api/athletes/{aid}/claim")
def claim_athlete(aid: int, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    """Wave 4: link my user to an athlete profile (1:1, first-claim-wins).

    Athlete role only (Wave 7): a coach/organizer linking a foreign profile
    would gain status visibility + withdraw paths via the link. Enables
    athlete self-service: apply/withdraw/list own applications.
    403 wrong role; 404 unknown athlete; 409 profile already linked to
    someone else (incl. concurrent-claim race via unique constraint);
    400 this user already linked to another profile.
    """
    from sqlalchemy.exc import IntegrityError
    from app.core.permissions import has_role
    if not has_role(db, user, "athlete"):
        raise HTTPException(403, "Only athletes claim profiles")
    a = db.get(Athlete, aid)
    if not a:
        raise HTTPException(404, "Not found")
    if a.user_id is not None:
        if a.user_id == user.id:
            return {"ok": True, "athlete_id": a.id}
        raise HTTPException(409, "Profile already claimed")
    mine = db.query(Athlete).filter_by(user_id=user.id).first()
    if mine:
        raise HTTPException(400, "Already linked to another profile")
    a.user_id = user.id
    db.add(AuditLog(actor_id=user.id, action=f"claimed athlete profile",
                    entity="athlete", entity_id=a.id))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Profile already claimed")
    return {"ok": True, "athlete_id": a.id}


@router.get("/api/me/athlete")
def my_athlete(db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    """Wave 4: my claimed athlete profile (id+name) for self-service UI."""
    a = db.query(Athlete).filter_by(user_id=user.id).first()
    if not a:
        return None
    club = db.get(Club, a.club_id) if a.club_id else None
    return {"id": a.id, "name": a.full_name, "gender": a.gender,
            "birth_year": a.birth_year, "weight": a.weight_kg,
            "club": club.name if club else "—"}


@router.get("/api/me/registrations")
def my_registrations(db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    """Wave 4: applications of my linked athlete profile(s) with statuses."""
    aids = [r[0] for r in db.query(Athlete.id).filter_by(user_id=user.id).all()]
    if not aids:
        return []
    regs = db.query(Registration).filter(Registration.athlete_id.in_(aids)).order_by(
        Registration.id.desc()).all()
    tids = sorted({r.tournament_id for r in regs})
    tmap = {t.id: t for t in db.query(Tournament).filter(Tournament.id.in_(tids)).all()} if tids else {}
    cmap = {c.id: c for c in db.query(TournamentCategory).filter(
        TournamentCategory.id.in_([r.category_id for r in regs])).all()} if regs else {}
    out = []
    for r in regs:
        t = tmap.get(r.tournament_id)
        c = cmap.get(r.category_id)
        out.append({"id": r.id, "athlete_id": r.athlete_id,
                    "tournament_id": r.tournament_id,
                    "tournament": t.name if t else "?",
                    "date": str(t.start_date) if t else "",
                    "status": t.status if t else "",
                    "category_id": r.category_id, "category": c.name if c else "?",
                    "reg_status": r.status, "review_note": r.review_note,
                    "checked_in": r.checked_in, "weigh_in_status": r.weigh_in_status})
    return out

