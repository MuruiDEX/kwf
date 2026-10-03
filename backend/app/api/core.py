from fastapi import APIRouter, Depends, HTTPException, Query
import json
from sqlalchemy.orm import Session
from app.core.db import get_db, escape_like
from app.core.deps import require_perm, get_current_user, get_optional_user, require_athlete_scope
from app.core.paging import page_args, paginate, envelope
from app.models.user import User
from app.models.club_athlete import Athlete, Club, TrainingSession
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
    if mine:
        # Scoped cabinet view (authenticated, own athletes only): exact
        # fields retained so BulkReg auto-suggest keeps working.
        return envelope([{"id": a.id, "name": a.full_name, "club_id": a.club_id, "country": a.country, "points": a.points,
                 "wins": a.wins, "losses": a.losses, "weight": a.weight_kg,
                 "gender": a.gender, "birth_year": a.birth_year} for a in rows],
                 total, pg["limit"], pg["offset"])
    # B1: public list exposes derived bands only, never exact birth_year/weight.
    from app.services.bands import bands_for_category, latest_public_categories_bulk
    cats = latest_public_categories_bulk(db, [a.id for a in rows])
    out = []
    for a in rows:
        ag, wc = bands_for_category(cats.get(a.id))
        out.append({"id": a.id, "name": a.full_name, "club_id": a.club_id, "country": a.country,
                    "points": a.points, "wins": a.wins, "losses": a.losses,
                    "gender": a.gender, "age_group": ag, "weight_class": wc})
    return envelope(out, total, pg["limit"], pg["offset"])

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
    # B3: finished-podium lookup per (tournament, category), computed from
    # the ALREADY loaded brackets/matches (no new queries). place is only
    # set for actual finished podiums; anything else stays None.
    from app.api.exports import _assemble_podium
    pod_by_tc: dict[tuple[int, int], dict] = {}
    for b in brackets:
        for e in _assemble_podium([b], cmap, by_bracket):
            pod_by_tc.setdefault((b.tournament_id, e["category_id"]), e)
    history = []
    places: list[int | None] = []
    for r in regs:
        t = tmap.get(r.tournament_id)
        c = cmap.get(r.category_id)
        b = bmap.get((r.tournament_id, r.category_id))
        history.append({"tournament_id": r.tournament_id, "tournament": t.name if t else "?",
                        "date": str(t.start_date) if t else "", "category": c.name if c else "?",
                        "result": _placement_from_matches(by_bracket.get(b.id, []) if b else [], aid)})
        e = pod_by_tc.get((r.tournament_id, r.category_id))
        if e is not None and e["gold_id"] == aid:
            places.append(1)
        elif e is not None and e["silver_id"] == aid:
            places.append(2)
        elif e is not None and aid in e["bronze_ids"]:
            places.append(3)
        else:
            places.append(None)
    order = sorted(range(len(regs)),
                   key=lambda i: (history[i]["date"] or "", regs[i].tournament_id),
                   reverse=True)[:5]
    recent = [{"tournament_id": history[i]["tournament_id"],
               "tournament": history[i]["tournament"],
               "date": history[i]["date"], "category": history[i]["category"],
               "result": history[i]["result"], "place": places[i]} for i in order]
    gold = sum(1 for p in places if p == 1)
    silver = sum(1 for p in places if p == 2)
    bronze = sum(1 for p in places if p == 3)
    fights = (a.wins or 0) + (a.losses or 0)
    # B3: dense rank shared on ties: 1 + COUNT(points > mine).
    # Single extra query; total profile budget stays <= 10 SELECTs.
    from sqlalchemy import func as _func
    rank = db.query(_func.count(Athlete.id)).filter(Athlete.points > (a.points or 0)).scalar() + 1
    # B1: public profile exposes derived bands only (exact fields live
    # behind GET /api/athletes/{aid}/scoped + /api/me/athlete).
    from app.services.bands import public_bands
    ag, wc = public_bands(db, aid)
    return {"id": a.id, "name": a.full_name, "first_name": a.first_name, "last_name": a.last_name,
            "gender": a.gender, "age_group": ag, "weight_class": wc,
            "level": a.level, "country": a.country,
            "club": club.name if club else "—", "club_id": a.club_id,
            "points": a.points, "wins": a.wins, "losses": a.losses,
            "rank": int(rank),
            "stats": {"fights": fights,
                      "win_rate": round((a.wins or 0) / fights, 3) if fights else 0,
                      "titles": gold},
            "medals": {"gold": gold, "silver": silver, "bronze": bronze},
            "recent_results": recent, "history": history}


@router.get("/api/athletes/{aid}/scoped")
def athlete_scoped(aid: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    """B1: exact birth_year/weight_kg for coach scope or linked self.

    Explicit allowlist (NOT an alias of any future parent view): public
    fields + birth_year + weight. user_id/created_by are never returned.
    Mirrors _spravki_scope (spravki.py): athletes.manage -> require_athlete_scope,
    else linked athlete self, else 403.
    """
    from app.core.permissions import has_perm, has_role
    a = db.get(Athlete, aid)
    if not a:
        raise HTTPException(404, "Not found")
    if has_perm(db, user, "athletes.manage"):
        require_athlete_scope(aid, db, user)
    elif not (has_role(db, user, "athlete") and a.user_id == user.id):
        raise HTTPException(403, "Foreign athlete")
    club = db.get(Club, a.club_id) if a.club_id else None
    from app.services.bands import public_bands as _bands
    ag, wc = _bands(db, aid)
    return {"id": a.id, "name": a.full_name, "first_name": a.first_name, "last_name": a.last_name,
            "gender": a.gender, "birth_year": a.birth_year, "weight": a.weight_kg,
            "age_group": ag, "weight_class": wc,
            "level": a.level, "country": a.country,
            "club": club.name if club else "—", "club_id": a.club_id,
            "points": a.points, "wins": a.wins, "losses": a.losses}

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
def club_detail(cid: int, athletes_limit: int = Query(50, ge=1, le=100),
                athletes_offset: int = Query(0, ge=0),
                db: Session = Depends(get_db)):
    """B2 public club profile. All public (no auth), PII-free by construction:
    roster items carry id/name/points/wins/losses only (no birth_year,
    weight, user_id, owner_id anywhere). Roster paginated; counts (titles,
    athlete_count) always cover the WHOLE club, never just the page."""
    from datetime import date as _date
    from sqlalchemy import func
    c = db.get(Club, cid)
    if not c:
        raise HTTPException(404, "Not found")
    athlete_count = db.query(func.count(Athlete.id)).filter_by(club_id=cid).scalar() or 0
    athletes = (db.query(Athlete).filter_by(club_id=cid).order_by(Athlete.points.desc())
                .offset(athletes_offset).limit(athletes_limit).all())
    # Full-club titles via join (same semantics as before: finished finals
    # won by club athletes) — independent of the roster page.
    titles = (db.query(func.count(BracketMatch.id))
              .join(Athlete, BracketMatch.winner_id == Athlete.id)
              .filter(Athlete.club_id == cid,
                      BracketMatch.status == "finished",
                      BracketMatch.next_match_id.is_(None)).scalar() or 0)
    today = _date.today()
    up_rows = (db.query(Tournament, func.count(Registration.id))
               .join(Registration, Registration.tournament_id == Tournament.id)
               .join(Athlete, Registration.athlete_id == Athlete.id)
               .filter(Athlete.club_id == cid,
                       Tournament.status.in_(["upcoming", "registration"]),
                       Tournament.start_date >= today)
               .group_by(Tournament.id)
               .order_by(Tournament.start_date).limit(5).all())
    upcoming = [{"id": t.id, "name": t.name, "city": t.city,
                 "start_date": str(t.start_date), "status": t.status,
                 "participants": int(n)} for t, n in up_rows]
    rt = (db.query(Registration.tournament_id, Tournament.name,
                   func.max(Tournament.start_date).label("d"))
          .join(Athlete, Registration.athlete_id == Athlete.id)
          .join(Tournament, Registration.tournament_id == Tournament.id)
          .filter(Athlete.club_id == cid, Tournament.status == "finished")
          .group_by(Registration.tournament_id, Tournament.name)
          .order_by(func.max(Tournament.start_date).desc()).limit(5).all())
    recent_meta = [(tid, name, d) for tid, name, d in rt]
    aids = {r[0] for r in db.query(Athlete.id).filter_by(club_id=cid).all()}
    from app.api.exports import _podiums_bulk
    podiums = _podiums_bulk(db, [tid for tid, _, _ in recent_meta]) if recent_meta else {}
    recent = []
    for tid, name, d in recent_meta:
        g = s = b = 0
        for p in podiums.get(tid, []):
            if p["gold_id"] in aids:
                g += 1
            if p["silver_id"] in aids:
                s += 1
            b += len([x for x in p["bronze_ids"] if x in aids])
        recent.append({"tournament_id": tid, "tournament": name,
                       "date": str(d), "gold": g, "silver": s, "bronze": b})
    return {"id": c.id, "name": c.name, "country": c.country, "city": c.city, "coach": c.coach_name,
            "athletes": [{"id": a.id, "name": a.full_name, "points": a.points, "wins": a.wins, "losses": a.losses} for a in athletes],
            "athlete_count": int(athlete_count), "titles": int(titles),
            "upcoming_tournaments": upcoming, "recent_results": recent}


@router.get("/api/clubs/{cid}/schedule")
def club_schedule(cid: int, from_date: str = Query(default="", alias="from"),
                  limit: int = Query(default=20, ge=1, le=50),
                  offset: int = Query(default=0, ge=0),
                  db: Session = Depends(get_db)):
    """B2 public club schedule (read-only). Future sessions only
    (starts_at >= from/today), public-safe serializer: id/title/starts_at/
    ends_at — NEVER note (coach planning PII) or coach_id. ?limit>50 -> 422
    via Query validation; unknown club -> 404."""
    from datetime import date as _date
    from sqlalchemy import func
    c = db.get(Club, cid)
    if not c:
        raise HTTPException(404, "Not found")
    if from_date:
        try:
            start = _date.fromisoformat(from_date)
        except ValueError:
            raise HTTPException(400, "Invalid from (expected YYYY-MM-DD)")
    else:
        start = _date.today()
    base = db.query(TrainingSession).filter(
        TrainingSession.club_id == cid,
        func.date(TrainingSession.starts_at) >= start)
    total = base.count()
    rows = base.order_by(TrainingSession.starts_at).offset(offset).limit(limit).all()
    return {"items": [{"id": r.id, "title": r.title,
                       "starts_at": str(r.starts_at),
                       "ends_at": str(r.ends_at) if r.ends_at else None}
                      for r in rows],
            "total": total, "limit": limit, "offset": offset}

@router.get("/api/rankings")
def rankings(gender: str = "", country: str = "", weight_min: float = 0, weight_max: float = 999,
             pg: dict = Depends(page_args), db: Session = Depends(get_db)):
    q = db.query(Athlete).filter(Athlete.weight_kg >= weight_min, Athlete.weight_kg <= weight_max)
    if gender:
        q = q.filter(Athlete.gender == gender)
    if country:
        q = q.filter(Athlete.country == country)
    # B3: id ASC tie-break makes order (and positional rank) deterministic
    # for equal points. Response shape untouched.
    q = q.order_by(Athlete.points.desc(), Athlete.id.asc())
    rows, total = paginate(q, pg["limit"], pg["offset"])
    # B1: public rankings expose no exact weight (filters by weight still work).
    return envelope([{"rank": pg["offset"] + i + 1, "id": a.id, "name": a.full_name, "club_id": a.club_id,
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
def search(q: str, scope: str = "athletes,clubs,tournaments",
           limit: int = 5, offset: int = 0, db: Session = Depends(get_db)):
    """Wave A1: scoped global search (additive, backward compatible).

    - q: substring over athlete first/last name, club name, tournament name/city.
      Minimum 2 non-space chars; shorter queries return empty sections
      (avoids full-table scans from single-char input).
    - scope: comma list subset of {athletes,clubs,tournaments}.
      Unknown tokens are ignored; empty result keeps old shape.
    - limit: per-section cap 1..50 (default 5 = old behavior).
    - offset: per-section offset.
    Shape keeps {athletes, clubs} and ADDS {tournaments}; old consumers
    (CommandMenu) ignore the extra key.
    """
    scopes = {s.strip().lower() for s in (scope or "").split(",") if s.strip()}
    if not scopes:
        scopes = {"athletes", "clubs", "tournaments"}
    limit = max(1, min(int(limit or 5), 50))
    offset = max(0, int(offset or 0))
    out: dict = {"athletes": [], "clubs": [], "tournaments": []}
    if len((q or "").strip()) < 2:
        return out
    like = f"%{escape_like(q.strip())}%"
    if "athletes" in scopes:
        athletes = db.query(Athlete).filter(
            (Athlete.first_name.ilike(like, escape="\\")) | (Athlete.last_name.ilike(like, escape="\\"))
        ).order_by(Athlete.points.desc()).offset(offset).limit(limit).all()
        out["athletes"] = [{"id": a.id, "name": a.full_name} for a in athletes]
    if "clubs" in scopes:
        clubs = db.query(Club).filter(Club.name.ilike(like, escape="\\")).order_by(
            Club.id.desc()).offset(offset).limit(limit).all()
        out["clubs"] = [{"id": c.id, "name": c.name} for c in clubs]
    if "tournaments" in scopes:
        rows = db.query(Tournament).filter(
            (Tournament.name.ilike(like, escape="\\")) | (Tournament.city.ilike(like, escape="\\"))
        ).order_by(Tournament.start_date).offset(offset).limit(limit).all()
        out["tournaments"] = [{"id": t.id, "name": t.name, "city": t.city,
                               "start_date": str(t.start_date), "status": t.status} for t in rows]
    return out


@router.get("/api/public/cities")
def public_cities(limit: int = 50, db: Session = Depends(get_db)):
    """Wave A1: distinct tournament cities for discovery selects (read-only).

    Union of tournament + club cities with usage counts, top-N first.
    No PII: city names only.
    """
    from sqlalchemy import func
    limit = max(1, min(int(limit or 50), 100))
    counts: dict[str, int] = {}
    for city, n in db.query(Tournament.city, func.count(Tournament.id)).filter(
            Tournament.city.isnot(None), Tournament.city != "").group_by(Tournament.city).all():
        counts[city] = counts.get(city, 0) + int(n)
    for city, n in db.query(Club.city, func.count(Club.id)).filter(
            Club.city.isnot(None), Club.city != "").group_by(Club.city).all():
        counts[city] = counts.get(city, 0) + int(n)
    ranked = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))[:limit]
    return {"items": [{"city": c, "count": n} for c, n in ranked]}


@router.get("/api/public/organizers")
def public_organizers(limit: int = 50, db: Session = Depends(get_db)):
    """Wave A1: distinct organizer public names for discovery selects.

    Derived from tournaments.created_by -> users.full_name. No emails/PII.
    """
    from sqlalchemy import func
    limit = max(1, min(int(limit or 50), 100))
    rows = db.query(User.full_name, func.count(Tournament.id)).join(
        Tournament, Tournament.created_by == User.id).filter(
        User.full_name.isnot(None), User.full_name != "").group_by(
        User.full_name).order_by(func.count(Tournament.id).desc()).limit(limit).all()
    return {"items": [{"name": name, "tournaments": int(n)} for name, n in rows]}

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

    B5: ownership/scope gate (mirrors `_spravki_scope`). Document codes are
    bearer secrets for the public verify/PDF flow, so foreign athletes'
    metadata is never enumerated: athletes.manage -> require_athlete_scope,
    else linked athlete self, else 404 (no oracle, same as spravki PDF).
    """
    from app.core.permissions import has_perm, has_role
    a = db.get(Athlete, aid)
    if not a:
        raise HTTPException(404, "Not found")
    try:
        if has_perm(db, user, "athletes.manage"):
            require_athlete_scope(aid, db, user)
        elif not (has_role(db, user, "athlete") and a.user_id == user.id):
            raise HTTPException(403, "Foreign athlete")
    except HTTPException as e:
        if e.status_code == 403:
            raise HTTPException(404, "Not found")
        raise
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

