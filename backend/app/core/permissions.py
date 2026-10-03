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


def user_roles(db: Session, user) -> set[str]:
    """Effective role SET: primary `user.role` plus granted secondary roles.

    `user.role` (primary) is always implied, so pre-multi-role users behave
    exactly as before. Unknown rows are ignored defensively (validated on write).
    """
    from app.models.user import UserRole
    rows = {r.role for r in db.query(UserRole).filter_by(user_id=user.id).all()}
    roles = rows & set(ROLES)
    if user.role:
        roles.add(user.role)
    return roles


def has_role(db: Session, user, *roles: str) -> bool:
    """Literal set membership (no implicit admin bypass — callers add it)."""
    rs = user_roles(db, user)
    return any(r in rs for r in roles)


def is_pure_athlete(db: Session, user) -> bool:
    """Holds the athlete role but no wider staff role.

    Multi-role rule: a coach+organizer keeps full coach/organizer width;
    only users whose ONLY working role is athlete are confined to their
    claimed (linked) profile. Referee presence is irrelevant here —
    referees hold no registration powers through any path.
    """
    rs = user_roles(db, user)
    return "athlete" in rs and not (rs & {"coach", "organizer", "admin"})


def direct_grants(db: Session, user_id: int) -> set[str]:
    from app.models.user import UserPermission
    return {r.permission for r in db.query(UserPermission).filter_by(user_id=user_id).all()}


def effective_permissions(db: Session, user) -> set[str]:
    """Union of role defaults (over the whole role SET) + direct grants."""
    perms: set[str] = set()
    for r in user_roles(db, user):
        if r == "admin":
            return set(PERMISSIONS)
        perms |= role_defaults(r)
    return perms | direct_grants(db, user.id)


def has_perm(db: Session, user, perm: str, roles: set[str] | None = None) -> bool:
    """`roles` reuses a precomputed user_roles() set to avoid a duplicate query
    on hot list paths; None (default) loads it."""
    if perm not in PERMISSIONS:
        return False
    rs = roles if roles is not None else user_roles(db, user)
    if "admin" in rs:
        return True
    if any(perm in role_defaults(r) for r in rs):
        return True
    return _has_direct_grant(db, user.id, perm)


def _has_direct_grant(db: Session, user_id: int, perm: str) -> bool:
    from app.models.user import UserPermission
    return db.query(UserPermission).filter_by(user_id=user_id, permission=perm).first() is not None
