from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from app.core.db import get_db, escape_like
from app.core.deps import require_perm
from app.core.paging import page_args, paginate, envelope
from app.core.permissions import PERMISSIONS, GRANTABLE, ROLES, effective_permissions, direct_grants
from app.models.user import User, UserPermission
from app.models.misc import OrganizerRequest, AuditLog

router = APIRouter(prefix="/api/admin", tags=["admin"])

class UserUpdate(BaseModel):
    role: str | None = Field(default=None, pattern="^(public|athlete|coach|referee|organizer|admin)$")
    is_active: bool | None = None
    add_permissions: list[str] = Field(default_factory=list)
    remove_permissions: list[str] = Field(default_factory=list)

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
        u.role = "organizer"
    db.add(AuditLog(actor_id=user.id, action=f"organizer request {r.status}", entity="organizer_request", entity_id=r.id))
    db.commit()
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
    if rows:
        for uid, perm in db.query(UserPermission.user_id, UserPermission.permission).filter(
                UserPermission.user_id.in_([u.id for u in rows])).all():
            grants.setdefault(uid, []).append(perm)
    return envelope([{"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role,
             "is_active": u.is_active, "created_at": str(u.created_at),
             "grants": sorted(grants.get(u.id, []))} for u in rows],
             total, pg["limit"], pg["offset"])

def _user_detail(db: Session, u: User) -> dict:
    eff = sorted(effective_permissions(db, u))
    return {"id": u.id, "email": u.email, "full_name": u.full_name, "role": u.role,
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
    for p in list(data.add_permissions) + list(data.remove_permissions):
        if p not in PERMISSIONS:
            raise HTTPException(400, f"Unknown permission: {p}")
        if p not in GRANTABLE:
            raise HTTPException(400, f"Permission is not grantable: {p}")
    if data.role is not None and data.role != u.role:
        if data.role not in ROLES:
            raise HTTPException(400, f"Unknown role: {data.role}")
        db.add(AuditLog(actor_id=user.id, action=f"role {u.role} -> {data.role}",
                        entity="user", entity_id=u.id))
        u.role = data.role
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
    db.commit()
    db.refresh(u)
    return _user_detail(db, u)

@router.get("/permissions/catalog")
def permissions_catalog(db: Session = Depends(get_db), user: User = Depends(require_perm("roles.manage"))):
    """Full permission catalog for the admin UI (groups for checkbox layout)."""
    return [{"key": k, "group": v["group"], "roles": v["roles"], "grantable": v["grantable"]}
            for k, v in PERMISSIONS.items()]
