from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.core.db import get_db, escape_like
from app.core.deps import require_perm
from app.core.paging import page_args, paginate, envelope
from app.core.permissions import PERMISSIONS, GRANTABLE, ROLES, effective_permissions, direct_grants
from app.models.user import User, UserPermission, UserRole
from app.models.misc import OrganizerRequest, AuditLog

router = APIRouter(prefix="/api/admin", tags=["admin"])

class UserUpdate(BaseModel):
    role: str | None = Field(default=None, pattern="^(public|athlete|coach|referee|organizer|admin)$")
    is_active: bool | None = None
    add_permissions: list[str] = Field(default_factory=list)
    remove_permissions: list[str] = Field(default_factory=list)
    add_roles: list[str] = Field(default_factory=list)
    remove_roles: list[str] = Field(default_factory=list)

@router.get("/organizer-requests")
def list_requests(pg: dict = Depends(page_args), db: Session = Depends(get_db), user: User = Depends(require_perm("roles.manage"))):
    rows, total = paginate(db.query(OrganizerRequest).filter_by(status="pending").order_by(OrganizerRequest.id),
                           pg["limit"], pg["offset"])
    umap = {u.id: u for u in db.query(User).filter(
        User.id.in_([r.user_id for r in rows])).all()} if rows else {}
    out = []
    for r in rows:
        u = umap.get(r.user_id)
        out.append({"id": r.id, "user": u.full_name if u else "?", "email": u.email if u else "?",
                    "org_name": r.org_name, "message": r.message, "at": str(r.created_at)})
    return envelope(out, total, pg["limit"], pg["offset"])

@router.post("/organizer-requests/{rid}/decision")
def decide_request(rid: int, approve: bool, db: Session = Depends(get_db), user: User = Depends(require_perm("roles.manage"))):
    r = db.get(OrganizerRequest, rid)
    if not r or r.status != "pending":
        raise HTTPException(404, "Not found")
    r.status = "approved" if approve else "rejected"
    u = db.get(User, r.user_id)
    if approve and u:
        # Wave 7: never demote an admin through request approval.
        # Multi-role: ADD organizer to the set, keep every existing role —
        # a coach stays a coach (club/athletes/schedule intact). A role-less
        # (public) user also gets organizer as primary (old contract).
        if u.role != "admin":
            from app.models.user import UserRole
            if not db.query(UserRole).filter_by(user_id=u.id, role="organizer").first():
                db.add(UserRole(user_id=u.id, role="organizer", granted_by=user.id))
                db.add(AuditLog(actor_id=user.id, action="granted role organizer",
                                entity="user", entity_id=u.id))
            if u.role == "public":
                u.role = "organizer"
    db.add(AuditLog(actor_id=user.id, action=f"organizer request {r.status}", entity="organizer_request", entity_id=r.id))
    db.commit()
    # Wave 1: tell the applicant about the decision (in-app; channels later).
    from app.services.notifications import emit_event
    emit_event(db, "organizer", [r.user_id],
               f"Заявка организатора: {r.status} ({r.org_name})", link="/me")
    return {"ok": True, "status": r.status}

@router.get("/users")
def list_users(q: str = "", role: str = "", pg: dict = Depends(page_args),
               db: Session = Depends(get_db), user: User = Depends(require_perm("users.view"))):
    """User directory. Read-only; no passwords or hashes exposed.
    users.view suffices for listing; mutations need roles.manage."""
    query = db.query(User).order_by(User.id.desc())
    if q:
        like = f"%{escape_like(q)}%"
        query = query.filter((User.email.ilike(like, escape="\\")) | (User.full_name.ilike(like, escape="\\")))
    if role:
        query = query.filter_by(role=role)
    rows, total = paginate(query, pg["limit"], pg["offset"])
    grants: dict[int, list[str]] = {}
    roles_map: dict[int, list[str]] = {}
    if rows:
        for uid, perm in db.query(UserPermission.user_id, UserPermission.permission).filter(
                UserPermission.user_id.in_([u.id for u in rows])).all():
            grants.setdefault(uid, []).append(perm)
        for uid, role in db.query(UserRole.user_id, UserRole.role).filter(
                UserRole.user_id.in_([u.id for u in rows])).all():
            if role not in roles_map.setdefault(uid, []):
                roles_map[uid].append(role)
    return envelope([{"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role,
             "roles": sorted(set([u.role] + roles_map.get(u.id, []))),
             "is_active": u.is_active, "created_at": str(u.created_at),
             "grants": sorted(grants.get(u.id, []))} for u in rows],
             total, pg["limit"], pg["offset"])

def _user_detail(db: Session, u: User) -> dict:
    from app.core.permissions import user_roles
    eff = sorted(effective_permissions(db, u))
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role,
            "roles": sorted(user_roles(db, u)),
            "is_active": u.is_active, "created_at": str(u.created_at),
            "grants": sorted(direct_grants(db, u.id)), "effective": eff}

@router.get("/users/{uid}")
def get_user(uid: int, db: Session = Depends(get_db), user: User = Depends(require_perm("users.view"))):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    return _user_detail(db, u)

@router.put("/users/{uid}")
def update_user(uid: int, data: UserUpdate, db: Session = Depends(get_db), user: User = Depends(require_perm("roles.manage"))):
    """Change role / active status / direct permission grants. Admin-only
    (roles.manage is non-grantable). Everything is audited; secrets never logged."""
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    if u.id == user.id and (data.role not in (None, u.role) or data.is_active is False):
        raise HTTPException(400, "Cannot change your own role or deactivate yourself")
    # Last-admin protection (multi-role: anyone holding admin in their set).
    # Demoting/deactivating the final active admin locks out admin functions.
    from app.core.permissions import user_roles
    removes_admin = ("admin" in user_roles(db, u) and u.is_active and (
        (data.role is not None and data.role != "admin") or data.is_active is False
        or (data.remove_roles and "admin" in data.remove_roles)))
    if removes_admin:
        # Count both representations defensively (rows are backfilled, but a
        # primary-only admin must also keep the set non-empty).
        row_holders = db.query(User).join(
            UserRole, UserRole.user_id == User.id,
        ).filter(
            UserRole.role == "admin",
            User.is_active == True,  # noqa: E712
            User.id != u.id,
        ).count()
        primary_holders = db.query(User).filter(
            User.role == "admin",
            User.is_active == True,  # noqa: E712
            User.id != u.id,
        ).count()
        if row_holders == 0 and primary_holders == 0:
            raise HTTPException(409, "Cannot remove the last active admin")
    for p in list(data.add_permissions) + list(data.remove_permissions):
        if p not in PERMISSIONS:
            raise HTTPException(400, f"Unknown permission: {p}")
        if p not in GRANTABLE:
            raise HTTPException(400, f"Permission is not grantable: {p}")
    for r in list(data.add_roles) + list(data.remove_roles):
        # Secondary roles exclude admin/public: admin is granted only via the
        # primary-role path above (last-admin guarded); public is not a role.
        if r not in ROLES or r in ("admin", "public"):
            raise HTTPException(400, f"Unknown or non-secondary role: {r}")
    if data.role is not None and data.role != u.role:
        if data.role not in ROLES:
            raise HTTPException(400, f"Unknown role: {data.role}")
        db.add(AuditLog(actor_id=user.id, action=f"role {u.role} -> {data.role}",
                        entity="user", entity_id=u.id))
        u.role = data.role
        if not db.query(UserRole).filter_by(user_id=u.id, role=data.role).first():
            db.add(UserRole(user_id=u.id, role=data.role, granted_by=user.id))
    if data.is_active is not None and data.is_active != u.is_active:
        db.add(AuditLog(actor_id=user.id, action=f"active -> {data.is_active}",
                        entity="user", entity_id=u.id))
        u.is_active = data.is_active
    for p in data.add_permissions:
        if not db.query(UserPermission).filter_by(user_id=u.id, permission=p).first():
            db.add(UserPermission(user_id=u.id, permission=p, granted_by=user.id))
            db.add(AuditLog(actor_id=user.id, action=f"granted {p}", entity="user", entity_id=u.id))
    for p in data.remove_permissions:
        row = db.query(UserPermission).filter_by(user_id=u.id, permission=p).first()
        if row:
            db.delete(row)
            db.add(AuditLog(actor_id=user.id, action=f"revoked {p}", entity="user", entity_id=u.id))
    for r in data.add_roles:
        if not db.query(UserRole).filter_by(user_id=u.id, role=r).first():
            db.add(UserRole(user_id=u.id, role=r, granted_by=user.id))
            db.add(AuditLog(actor_id=user.id, action=f"granted role {r}",
                            entity="user", entity_id=u.id))
    for r in data.remove_roles:
        # Primary role cannot be dropped this way (change primary instead);
        # keeps the {primary} ⊆ set invariant intact.
        if r == u.role:
            raise HTTPException(400, "Cannot remove the primary role (change it instead)")
        row = db.query(UserRole).filter_by(user_id=u.id, role=r).first()
        if row:
            db.delete(row)
            db.add(AuditLog(actor_id=user.id, action=f"revoked role {r}",
                            entity="user", entity_id=u.id))
    db.commit()
    db.refresh(u)
    return _user_detail(db, u)

@router.get("/permissions/catalog")
def permissions_catalog(db: Session = Depends(get_db), user: User = Depends(require_perm("roles.manage"))):
    """Full permission catalog for the admin UI (groups for checkbox layout)."""
    return [{"key": k, "group": v["group"], "roles": v["roles"], "grantable": v["grantable"]}
            for k, v in PERMISSIONS.items()]
