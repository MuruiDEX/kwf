"""Coach training schedule (club lessons). Minimal CRUD for the trainer cabinet.

Scope (no new permissions): the caller's CLUBS (club.owner_id == me), admin
bypass. A coach+organizer keeps this regardless of primary role; an
organizer-only user has no clubs and sees nothing here. Deletion is a hard
delete of the organizer's own planning rows (no audit requirement).
"""
from __future__ import annotations
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.deps import get_current_user, require_roles
from app.core.paging import page_args, paginate, envelope
from app.models.user import User
from app.models.club_athlete import Club, TrainingSession

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class SessionIn(BaseModel):
    club_id: int = Field(gt=0)
    group_id: int | None = Field(default=None, gt=0)
    title: str = Field(default="", max_length=255)
    starts_at: datetime
    ends_at: datetime | None = None
    note: str = Field(default="", max_length=512)


def _resolve_group(db: Session, club_id: int, group_id: int | None):
    """Validate an optional session->group link (D2 P3).

    NULL stays valid (club-wide session). Otherwise the group must exist,
    belong to the SAME club, and be active. Uniform 404/409, no oracle.
    """
    from app.models.training_group import TrainingGroup
    if group_id is None:
        return None
    g = db.get(TrainingGroup, group_id)
    if not g or g.club_id != club_id:
        raise HTTPException(404, "Not found")
    if not g.is_active:
        raise HTTPException(409, "Group is archived")
    return g


def _serialize(r, club_name: str, group_name: str | None) -> dict:
    return {"id": r.id, "club_id": r.club_id, "group_id": r.group_id,
            "club": club_name, "group": group_name,
            "title": r.title, "starts_at": str(r.starts_at),
            "ends_at": str(r.ends_at) if r.ends_at else None,
            "note": r.note}


def _scope(db: Session, user: User) -> list[int]:
    """Club ids the caller may plan for: owned clubs (admin: all)."""
    from app.core.permissions import user_roles
    if "admin" in user_roles(db, user):
        return [c.id for c in db.query(Club.id).all()]
    return [c.id for c in db.query(Club.id).filter_by(owner_id=user.id).all()]


def _coach_gate(user: User = Depends(require_roles("coach", "admin"))):
    return user


@router.get("")
def list_sessions(club_id: int | None = None, mine: bool = False,
                  group_id: int | None = None, pg: dict = Depends(page_args),
                  db: Session = Depends(get_db),
                  user: User = Depends(_coach_gate)):
    from app.models.training_group import TrainingGroup
    allowed = _scope(db, user)
    q = db.query(TrainingSession).order_by(TrainingSession.starts_at.desc())
    if club_id is not None:
        if club_id not in allowed:
            raise HTTPException(403, "Foreign club")
        q = q.filter_by(club_id=club_id)
    elif mine:
        q = q.filter(TrainingSession.club_id.in_(allowed)) if allowed else q.filter(False)
    else:
        q = q.filter(TrainingSession.club_id.in_(allowed)) if allowed else q.filter(False)
    if group_id is not None:
        g = db.get(TrainingGroup, group_id)
        if not g or g.club_id not in allowed:
            raise HTTPException(404, "Not found")
        q = q.filter_by(group_id=group_id)
    rows, total = paginate(q, pg["limit"], pg["offset"])
    cmap = {c.id: c for c in db.query(Club).filter(
        Club.id.in_([r.club_id for r in rows])).all()} if rows else {}
    gmap = {g.id: g for g in db.query(TrainingGroup).filter(
        TrainingGroup.id.in_([r.group_id for r in rows if r.group_id])).all()} if rows else {}
    return envelope([_serialize(r, cmap[r.club_id].name if r.club_id in cmap else "?",
                                gmap[r.group_id].name if r.group_id in gmap else None)
                     for r in rows], total, pg["limit"], pg["offset"])


@router.post("")
def create_session(data: SessionIn, db: Session = Depends(get_db),
                   user: User = Depends(_coach_gate)):
    if data.club_id not in _scope(db, user):
        raise HTTPException(403, "Foreign club")
    _resolve_group(db, data.club_id, data.group_id)
    if data.ends_at is not None and data.ends_at <= data.starts_at:
        raise HTTPException(400, "ends_at must be after starts_at")
    r = TrainingSession(club_id=data.club_id, group_id=data.group_id, coach_id=user.id, title=data.title,
                        starts_at=data.starts_at, ends_at=data.ends_at, note=data.note)
    db.add(r)
    db.commit()
    db.refresh(r)
    return {"id": r.id}


@router.put("/{sid}")
def update_session(sid: int, data: SessionIn, db: Session = Depends(get_db),
                   user: User = Depends(_coach_gate)):
    r = db.get(TrainingSession, sid)
    if not r:
        raise HTTPException(404, "Not found")
    if r.club_id not in _scope(db, user):
        raise HTTPException(403, "Foreign club")
    # D2 P3 security fix: the destination club was never checked — a coach
    # could move their own session into a foreign club. Both ends enforced now.
    if data.club_id not in _scope(db, user):
        raise HTTPException(403, "Foreign club")
    _resolve_group(db, data.club_id, data.group_id)
    if data.ends_at is not None and data.ends_at <= data.starts_at:
        raise HTTPException(400, "ends_at must be after starts_at")
    r.club_id, r.group_id, r.title = data.club_id, data.group_id, data.title
    r.starts_at, r.ends_at, r.note = data.starts_at, data.ends_at, data.note
    db.commit()
    return {"ok": True, "id": r.id}


@router.delete("/{sid}")
def delete_session(sid: int, db: Session = Depends(get_db),
                   user: User = Depends(_coach_gate)):
    r = db.get(TrainingSession, sid)
    if not r:
        raise HTTPException(404, "Not found")
    if r.club_id not in _scope(db, user):
        raise HTTPException(403, "Foreign club")
    db.delete(r)
    db.commit()
    return {"ok": True}
