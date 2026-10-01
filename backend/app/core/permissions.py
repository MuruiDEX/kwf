"""Granular permissions on top of roles (additive, never replacing RBAC).

Model:  ACCESS = has_perm(user, perm) AND ownership_check(resource, user)

- Roles keep their default permission sets (ROLE_DEFAULTS).
- Admin additionally holds every permission (`manage_all` semantics included).
- Extra permissions are stored per-user (UserPermission) and granted only by
  admin via the admin API. Non-grantable permissions (roles.manage,
  tournaments.manage_all, organizer_requests.manage) can never be granted —
  requesting them is a 400, so admin cannot accidentally hand out a
  security/ownership bypass.

Every permission below maps to real endpoint checks (see deps.require_perm).
No permission exists without an enforced action.
"""
from __future__ import annotations
from sqlalchemy.orm import Session

# key -> meta. `roles` = default holders. `grantable` = admin may grant it.
PERMISSIONS: dict[str, dict] = {
    "tournaments.create": {"group": "tournaments", "roles": ["organizer", "admin"], "grantable": True},
    "tournaments.manage": {"group": "tournaments", "roles": ["organizer", "admin"], "grantable": True},
    "tournaments.manage_all": {"group": "tournaments", "roles": ["admin"], "grantable": False},
    "athletes.manage": {"group": "athletes", "roles": ["organizer", "coach", "admin"], "grantable": True},
    "clubs.manage": {"group": "clubs", "roles": ["organizer", "admin"], "grantable": True},
    "news.manage": {"group": "content", "roles": ["organizer", "admin"], "grantable": True},
    "documents.manage": {"group": "documents", "roles": ["organizer", "admin"], "grantable": True},
    "matches.manage": {"group": "matches", "roles": ["referee", "organizer", "admin"], "grantable": True},
    "users.view": {"group": "users", "roles": ["admin"], "grantable": True},
    "audit.view": {"group": "audit", "roles": ["organizer", "admin"], "grantable": True},
    "roles.manage": {"group": "users", "roles": ["admin"], "grantable": False},
    "organizer_requests.manage": {"group": "users", "roles": ["admin"], "grantable": False},
}

GRANTABLE: frozenset[str] = frozenset(k for k, v in PERMISSIONS.items() if v["grantable"])

ROLES: tuple[str, ...] = ("public", "athlete", "coach", "referee", "organizer", "admin")


def role_defaults(role: str) -> set[str]:
    return {k for k, v in PERMISSIONS.items() if role in v["roles"]}


def direct_grants(db: Session, user_id: int) -> set[str]:
    from app.models.user import UserPermission
    return {r.permission for r in db.query(UserPermission).filter_by(user_id=user_id).all()}


def effective_permissions(db: Session, user) -> set[str]:
    """Union of role defaults + direct grants. Admin holds everything."""
    if user.role == "admin":
        return set(PERMISSIONS)
    return role_defaults(user.role) | direct_grants(db, user.id)


def has_perm(db: Session, user, perm: str) -> bool:
    if perm not in PERMISSIONS:
        return False
    if user.role == "admin":
        return True
    if perm in role_defaults(user.role):
        return True
    from app.models.user import UserPermission
    return db.query(UserPermission).filter_by(user_id=user.id, permission=perm).first() is not None
