"""C1: guardian relationship core (request/approve/reject/revoke lifecycle).

No role, no permissions, no UI. Relationship-scoped only:
- Any authenticated user may REQUEST a link (pending).
- Approvers: linked athlete-self (athlete.user_id == me), a coach passing
  the existing require_athlete_scope, or admin. Foreign actors get 404
  (no existence oracle), never 403.
- Revoke (DELETE, idempotent, row preserved as `revoked`): the requesting
  guardian or admin. No extra revoke privileges.
- pending/rejected/revoked grant NOTHING; `approved` authorizes the C2
  read-only surface only (ward list/registrations + explicitly extended
  read gates). No read gate beyond those may call guardian_athlete_ids.
- C4: lifecycle transitions emit in-app notifications via the existing
  emit_event seam (type "guardian", post-commit like B6, self-suppressed).
"""
from __future__ import annotations
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.deps import get_current_user, require_athlete_scope
from app.models.user import User
from app.models.club_athlete import Athlete
from app.models.misc import AuditLog
from app.models.guardian import GuardianLink

router = APIRouter(prefix="/api/guardian", tags=["guardian"])


class LinkIn(BaseModel):
    athlete_id: int = Field(gt=0)


def guardian_athlete_ids(db: Session, user_id: int) -> set[int]:
    """Approved-only ward set for a guardian user (C2 read-scope seam).

    pending/rejected/revoked are NEVER included. No gate calls this in C1.
    """
    rows = db.query(GuardianLink.athlete_id).filter_by(
        guardian_user_id=user_id, status="approved").all()
    return {r[0] for r in rows}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _out(link: GuardianLink) -> dict:
    return {"id": link.id, "guardian_user_id": link.guardian_user_id,
            "athlete_id": link.athlete_id, "status": link.status}


def _audit(db: Session, user: User, action: str, link_id: int) -> None:
    db.add(AuditLog(actor_id=user.id, action=f"guardian link {action}",
                    entity="guardian_link", entity_id=link_id))


def _notify_request(db: Session, athlete: Athlete, actor_id: int) -> None:
    """C4: tell the approver side about a new pending request.

    Recipients mirror B6's athlete fan-out ({linked-self, coach_of_athlete}
    minus the actor): exactly the users who can approve. No recipient is
    invented when nobody qualifies.
    """
    from app.services.notifications import emit_event, coach_of_athlete
    to = {u for u in (athlete.user_id, coach_of_athlete(db, athlete.id))
          if u and u != actor_id}
    if to:
        emit_event(db, "guardian", sorted(to),
                   f"Запрос доступа опекуна: {athlete.full_name} (ожидает рассмотрения)",
                   link="/me")


def _notify_guardian(db: Session, link: GuardianLink, athlete_name: str,
                     actor_id: int, kind: str) -> None:
    """C4: tell the guardian about a decision on their link.

    Self-action is suppressed like B6 (revoking your own link notifies
    nobody); an admin/coach decision always reaches the guardian.
    """
    from app.services.notifications import emit_event
    if link.guardian_user_id == actor_id:
        return
    verb = {"approved": "одобрен", "rejected": "отклонён",
            "revoked": "отозван"}.get(kind, kind)
    emit_event(db, "guardian", [link.guardian_user_id],
               f"Доступ опекуна {verb}: {athlete_name}",
               link="/me")


def _can_approve(db: Session, user: User, athlete: Athlete) -> bool:
    """Whether `user` may approve/reject a link for `athlete`.

    Admin: any. Linked-self: athlete.user_id == me. Otherwise reuse the
    existing coach/organizer athlete scope (no new permission or role).
    """
    from app.core.permissions import user_roles
    if "admin" in user_roles(db, user):
        return True
    if athlete.user_id is not None and athlete.user_id == user.id:
        return True
    try:
        require_athlete_scope(athlete.id, db, user)
    except HTTPException:
        return False
    return True


@router.post("/links")
def request_link(data: LinkIn, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """Request a guardian relationship (any authenticated user).

    404 unknown athlete; 409 existing pending/approved pair (incl. the
    concurrent-insert race via the unique constraint); rejected/revoked
    pairs reopen IN PLACE (same id, decided_* cleared).
    """
    a = db.get(Athlete, data.athlete_id)
    if not a:
        raise HTTPException(404, "Not found")
    existing = db.query(GuardianLink).filter_by(
        guardian_user_id=user.id, athlete_id=a.id).first()
    if existing:
        if existing.status in ("pending", "approved"):
            raise HTTPException(409, "Guardian link already exists")
        existing.status = "pending"
        existing.decided_at = None
        existing.decided_by = None
        _audit(db, user, "requested", existing.id)
        db.commit()
        db.refresh(existing)
        # C4: reopened request is a new pending event (committed above —
        # notification failure must never roll it back, same as B6).
        _notify_request(db, a, user.id)
        return _out(existing)
    link = GuardianLink(guardian_user_id=user.id, athlete_id=a.id,
                        status="pending")
    db.add(link)
    try:
        db.flush()
        _audit(db, user, "requested", link.id)
        db.commit()
    except IntegrityError:
        db.rollback()
        # Lost a concurrent insert race, or the athlete vanished in between.
        race = db.query(GuardianLink).filter_by(
            guardian_user_id=user.id, athlete_id=a.id).first()
        if race:
            raise HTTPException(409, "Guardian link already exists")
        raise HTTPException(404, "Not found")
    db.refresh(link)
    # C4: new pending request (post-commit, B6 pattern).
    _notify_request(db, a, user.id)
    return _out(link)


@router.get("/links")
def list_links(db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    """Own outgoing links + actionable incoming links (no PII beyond ids).

    Incoming = pending links for athletes the caller may approve. Foreign
    links never appear in either list.
    """
    outgoing = db.query(GuardianLink).filter_by(
        guardian_user_id=user.id).order_by(GuardianLink.id).all()
    pending = db.query(GuardianLink).filter_by(
        status="pending").order_by(GuardianLink.id).all()
    incoming: list[GuardianLink] = []
    for link in pending:
        if link.guardian_user_id == user.id:
            continue
        a = db.get(Athlete, link.athlete_id)
        if not a:
            continue
        if _can_approve(db, user, a):
            incoming.append(link)
    return {"outgoing": [_out(x) for x in outgoing],
            "incoming": [_out(x) for x in incoming]}


def _resolve_for_decision(lid: int, db: Session, user: User) -> GuardianLink:
    """Fetch a link the caller may approve/reject, else 404 (no oracle)."""
    link = db.get(GuardianLink, lid)
    if not link:
        raise HTTPException(404, "Not found")
    a = db.get(Athlete, link.athlete_id)
    if not a or not _can_approve(db, user, a):
        raise HTTPException(404, "Not found")
    return link


@router.post("/links/{lid}/approve")
def approve_link(lid: int, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    """Approve a pending (or rejected, on reconsideration) link.

    Foreign/unauthorized -> 404, link untouched. Revoked links cannot be
    approved (409: the guardian must re-request first). Idempotent on
    already-approved (200, no duplicate audit).
    """
    link = _resolve_for_decision(lid, db, user)
    if link.status == "revoked":
        raise HTTPException(409, "Link revoked; re-request required")
    if link.status != "approved":
        link.status = "approved"
        link.decided_at = _now()
        link.decided_by = user.id
        _audit(db, user, "approved", link.id)
        db.commit()
        db.refresh(link)
        # C4: real transition only (idempotent repeats notify nobody).
        a = db.get(Athlete, link.athlete_id)
        _notify_guardian(db, link, a.full_name if a else "?", user.id, "approved")
    return _out(link)


@router.post("/links/{lid}/reject")
def reject_link(lid: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    """Reject a pending (or approved) link. Foreign -> 404. Revoked -> 409.
    Idempotent on already-rejected (200, no duplicate audit)."""
    link = _resolve_for_decision(lid, db, user)
    if link.status == "revoked":
        raise HTTPException(409, "Link revoked; re-request required")
    if link.status != "rejected":
        link.status = "rejected"
        link.decided_at = _now()
        link.decided_by = user.id
        _audit(db, user, "rejected", link.id)
        db.commit()
        db.refresh(link)
        # C4: real transition only.
        a = db.get(Athlete, link.athlete_id)
        _notify_guardian(db, link, a.full_name if a else "?", user.id, "rejected")
    return _out(link)


@router.delete("/links/{lid}")
def revoke_link(lid: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    """Revoke (NOT hard-delete): row preserved as `revoked`.

    Allowed: the requesting guardian or admin — nothing more (C1 contract).
    Foreign -> 404. Idempotent (200, single audit on transition only).
    """
    from app.core.permissions import user_roles
    link = db.get(GuardianLink, lid)
    if not link:
        raise HTTPException(404, "Not found")
    if link.guardian_user_id != user.id and "admin" not in user_roles(db, user):
        raise HTTPException(404, "Not found")
    if link.status != "revoked":
        link.status = "revoked"
        link.decided_at = _now()
        link.decided_by = user.id
        _audit(db, user, "revoked", link.id)
        db.commit()
        db.refresh(link)
        # C4: real transition only (self-revoke notifies nobody, B6 rule).
        a = db.get(Athlete, link.athlete_id)
        _notify_guardian(db, link, a.full_name if a else "?", user.id, "revoked")
    return _out(link)


# ---------- C2: approved-guardian read surface (read-only) ----------
#
# Every endpoint below authorizes via guardian_athlete_ids() computed live
# per request (approved only — revocation takes effect immediately).
# No mutate path is added or widened here.


@router.get("/athletes")
def guardian_athletes(db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    """C2: my approved wards (minimal PII for the future Cabinet switcher).

    List shape mirrors the PUBLIC athlete list (derived age/weight bands,
    never exact birth_year/weight_kg); exact fields stay one hop away behind
    GET /api/athletes/{aid}/scoped. No link internals, no ownership fields.
    """
    from app.models.club_athlete import Club
    aids = guardian_athlete_ids(db, user.id)
    if not aids:
        return []
    rows = db.query(Athlete).filter(Athlete.id.in_(aids)).order_by(
        Athlete.id).all()
    # B1: derived bands only (same helpers as the public list endpoint).
    from app.services.bands import bands_for_category, latest_public_categories_bulk
    cats = latest_public_categories_bulk(db, [a.id for a in rows])
    cmap = {c.id: c for c in db.query(Club).filter(
        Club.id.in_([a.club_id for a in rows if a.club_id])).all()} if rows else {}
    out = []
    for a in rows:
        ag, wc = bands_for_category(cats.get(a.id))
        club = cmap.get(a.club_id) if a.club_id else None
        out.append({"id": a.id, "name": a.full_name,
                    "gender": a.gender, "age_group": ag, "weight_class": wc,
                    "level": a.level, "country": a.country,
                    "club": club.name if club else "—", "club_id": a.club_id,
                    "points": a.points, "wins": a.wins, "losses": a.losses})
    return out


@router.get("/registrations")
def guardian_registrations(athlete_id: int | None = None,
                           db: Session = Depends(get_db),
                           user: User = Depends(get_current_user)):
    """C2: read-only registrations of my approved wards.

    A dedicated endpoint (NOT an overload of GET /api/me/registrations,
    whose semantics are "my claimed profile"): optional athlete_id selects
    one ward (404 unless approved for it), omitted returns all wards.
    Same item visibility as the ward's own view (status + review_note);
    weigh_in_kg stays staff-only in the tournament list endpoint.
    """
    from app.models.tournament import Tournament, TournamentCategory
    from app.models.competition import Registration
    aids = guardian_athlete_ids(db, user.id)
    if athlete_id is not None:
        if athlete_id not in aids:
            raise HTTPException(404, "Not found")
        aids = {athlete_id}
    if not aids:
        return []
    regs = db.query(Registration).filter(
        Registration.athlete_id.in_(aids)).order_by(
        Registration.id.desc()).all()
    if not regs:
        return []
    amap = {a.id: a for a in db.query(Athlete).filter(
        Athlete.id.in_([r.athlete_id for r in regs])).all()}
    tids = sorted({r.tournament_id for r in regs})
    tmap = {t.id: t for t in db.query(Tournament).filter(
        Tournament.id.in_(tids)).all()} if tids else {}
    cmap = {c.id: c for c in db.query(TournamentCategory).filter(
        TournamentCategory.id.in_([r.category_id for r in regs])).all()}
    out = []
    for r in regs:
        t = tmap.get(r.tournament_id)
        c = cmap.get(r.category_id)
        a = amap.get(r.athlete_id)
        out.append({"id": r.id, "athlete_id": r.athlete_id,
                    "athlete": a.full_name if a else "?",
                    "tournament_id": r.tournament_id,
                    "tournament": t.name if t else "?",
                    "date": str(t.start_date) if t else "",
                    "status": t.status if t else "",
                    "category_id": r.category_id, "category": c.name if c else "?",
                    "reg_status": r.status, "review_note": r.review_note,
                    "checked_in": r.checked_in,
                    "weigh_in_status": r.weigh_in_status})
    return out
