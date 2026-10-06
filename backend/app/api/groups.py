"""D2 P2: coach training squads (groups + M:N membership).

No new permission or role. Management = club ownership (owner_id == me)
or admin; reads are public roster-equivalent (names/points only, never
birth/weight/user ids). Coaches never hard-delete (archive via is_active).
"""
from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.deps import get_current_user, get_optional_user
from app.models.user import User
from app.models.club_athlete import Athlete, Club
from app.models.misc import AuditLog
from app.models.training_group import TrainingGroup, TrainingGroupMember

router = APIRouter(prefix="/api/groups", tags=["groups"])


class GroupIn(BaseModel):
    club_id: int = Field(gt=0)
    name: str = Field(default="", max_length=128)
    level: str = Field(default="", max_length=32)
    age_min: int | None = Field(default=None, ge=0, le=99)
    age_max: int | None = Field(default=None, ge=0, le=99)


class GroupPatch(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    level: str | None = Field(default=None, max_length=32)
    age_min: int | None = Field(default=None, ge=0, le=99)
    age_max: int | None = Field(default=None, ge=0, le=99)
    is_active: bool | None = None


class MemberIn(BaseModel):
    athlete_id: int = Field(gt=0)


def _manager_club(db: Session, user: User, club_id: int) -> Club:
    """Return the club if `user` may manage its groups, else 404 (no oracle).

    Owner or admin only — `athletes.manage` alone is not enough for club
    structure. Uniform 404 keeps club ownership unenumerable.
    """
    from app.core.permissions import has_perm, user_roles
    club = db.get(Club, club_id)
    if not club:
        raise HTTPException(404, "Not found")
    if "admin" in user_roles(db, user):
        return club
    if has_perm(db, user, "athletes.manage") and club.owner_id == user.id:
        return club
    raise HTTPException(404, "Not found")


def _out(g: TrainingGroup, count: int) -> dict:
    return {"id": g.id, "club_id": g.club_id, "name": g.name, "level": g.level,
            "age_min": g.age_min, "age_max": g.age_max, "is_active": g.is_active,
            "member_count": count}


def _counts(db: Session, gids: list[int]) -> dict[int, int]:
    from sqlalchemy import func as _func
    rows = db.query(TrainingGroupMember.group_id, _func.count(TrainingGroupMember.id)).filter(
        TrainingGroupMember.group_id.in_(gids)).group_by(TrainingGroupMember.group_id).all() if gids else []
    return {gid: n for gid, n in rows}


def _check_bounds(age_min: int | None, age_max: int | None) -> None:
    if age_min is not None and age_max is not None and age_min > age_max:
        raise HTTPException(422, "age_min must not exceed age_max")


@router.post("")
def create_group(data: GroupIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """Create a squad in an owned club. 404 for unknown/foreign club."""
    if not data.name.strip():
        raise HTTPException(422, "Group name is required")
    _check_bounds(data.age_min, data.age_max)
    club = _manager_club(db, user, data.club_id)
    g = TrainingGroup(club_id=club.id, name=data.name.strip(), level=data.level.strip(),
                      age_min=data.age_min, age_max=data.age_max,
                      is_active=True, created_by=user.id)
    db.add(g)
    db.flush()
    db.add(AuditLog(actor_id=user.id, action="created group",
                    entity="training_group", entity_id=g.id))
    db.commit()
    db.refresh(g)
    return _out(g, 0)


@router.get("")
def list_groups(club_id: int | None = None, athlete_id: int | None = None,
                include_inactive: bool = False,
                db: Session = Depends(get_db),
                user: User | None = Depends(get_optional_user)):
    """Public group directory (roster-equivalent visibility).

    Optional athlete_id filter lists only squads containing that athlete
    (athlete dashboard use-case; same public shape, single query).
    """
    q = db.query(TrainingGroup).order_by(TrainingGroup.id)
    if club_id is not None:
        if not db.get(Club, club_id):
            raise HTTPException(404, "Not found")
        q = q.filter_by(club_id=club_id)
    if athlete_id is not None:
        if not db.get(Athlete, athlete_id):
            raise HTTPException(404, "Not found")
        q = q.filter(TrainingGroup.id.in_(
            db.query(TrainingGroupMember.group_id).filter_by(athlete_id=athlete_id)))
    if not include_inactive:
        q = q.filter_by(is_active=True)
    rows = q.all()
    counts = _counts(db, [g.id for g in rows])
    return [_out(g, counts.get(g.id, 0)) for g in rows]


@router.get("/mine")
def my_groups(db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    """All active groups of clubs I own (single call for BulkReg filtering
    and dashboard composition — no per-club request fan-out).

    NOTE: defined BEFORE /{gid} so "mine" is never captured as an id.
    """
    from app.core.permissions import user_roles
    if "admin" in user_roles(db, user):
        club_ids = [c.id for c in db.query(Club.id).all()]
    else:
        club_ids = [c.id for c in db.query(Club.id).filter_by(owner_id=user.id).all()]
    if not club_ids:
        return []
    rows = db.query(TrainingGroup).filter(
        TrainingGroup.club_id.in_(club_ids),
        TrainingGroup.is_active == True).order_by(TrainingGroup.id).all()  # noqa: E712
    counts = _counts(db, [g.id for g in rows])
    return [{**_out(g, counts.get(g.id, 0))} for g in rows]


@router.get("/{gid}")
def get_group(gid: int, db: Session = Depends(get_db),
              user: User | None = Depends(get_optional_user)):
    """Public group detail; members in public roster shape (no PII)."""
    g = db.get(TrainingGroup, gid)
    if not g:
        raise HTTPException(404, "Not found")
    members = db.query(Athlete).filter(
        Athlete.id.in_(db.query(TrainingGroupMember.athlete_id).filter_by(group_id=gid))
    ).order_by(Athlete.id).all()
    return {**_out(g, len(members)),
            "members": [{"id": a.id, "name": a.full_name, "points": a.points,
                         "wins": a.wins, "losses": a.losses} for a in members]}


@router.put("/{gid}")
def update_group(gid: int, data: GroupPatch, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """Rename / relabel / archive. Owner or admin; 404 otherwise."""
    g = db.get(TrainingGroup, gid)
    if not g:
        raise HTTPException(404, "Not found")
    _manager_club(db, user, g.club_id)
    if data.name is not None:
        if not data.name.strip():
            raise HTTPException(422, "Group name is required")
        g.name = data.name.strip()
    if data.level is not None:
        g.level = data.level.strip()
    age_min = data.age_min if data.age_min is not None else g.age_min
    age_max = data.age_max if data.age_max is not None else g.age_max
    _check_bounds(age_min, age_max)
    g.age_min, g.age_max = age_min, age_max
    if data.is_active is not None:
        g.is_active = data.is_active
    db.add(AuditLog(actor_id=user.id, action="updated group",
                    entity="training_group", entity_id=g.id))
    db.commit()
    db.refresh(g)
    counts = _counts(db, [g.id])
    return _out(g, counts.get(g.id, 0))


@router.post("/{gid}/members")
def add_member(gid: int, data: MemberIn, db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    """Add an athlete of the group's own club. 404 foreign/unknown;
    409 duplicate or archived group."""
    g = db.get(TrainingGroup, gid)
    if not g:
        raise HTTPException(404, "Not found")
    _manager_club(db, user, g.club_id)
    if not g.is_active:
        raise HTTPException(409, "Group is archived")
    a = db.get(Athlete, data.athlete_id)
    if not a or a.club_id != g.club_id:
        # Unknown athlete, unattached athlete, or other club's athlete:
        # uniform 404, nothing learnable.
        raise HTTPException(404, "Not found")
    m = TrainingGroupMember(group_id=g.id, athlete_id=a.id, added_by=user.id)
    db.add(m)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Athlete is already in this group")
    db.add(AuditLog(actor_id=user.id, action="added group member",
                    entity="training_group", entity_id=g.id))
    db.commit()
    counts = _counts(db, [g.id])
    return {**_out(g, counts.get(g.id, 0)), "added": a.id}


@router.delete("/{gid}/members/{aid}")
def remove_member(gid: int, aid: int, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    """Remove a member. Idempotent 200 (missing -> 200, no oracle)."""
    g = db.get(TrainingGroup, gid)
    if not g:
        raise HTTPException(404, "Not found")
    _manager_club(db, user, g.club_id)
    m = db.query(TrainingGroupMember).filter_by(group_id=g.id, athlete_id=aid).first()
    if m:
        db.delete(m)
        db.add(AuditLog(actor_id=user.id, action="removed group member",
                        entity="training_group", entity_id=g.id))
        db.commit()
    counts = _counts(db, [g.id])
    return {**_out(g, counts.get(g.id, 0)), "removed": aid}
