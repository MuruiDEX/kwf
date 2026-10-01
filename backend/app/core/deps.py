from fastapi import Depends, HTTPException, Request, status
from jwt.exceptions import InvalidTokenError
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import decode_token
from app.models.user import User

def _token_from(request: Request) -> str | None:
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.cookies.get("kwf_token")


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    # Explicit Authorization header wins over cookie (API clients vs browser sessions).
    token = _token_from(request)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(token)
        user = db.get(User, int(payload["sub"]))
    except (InvalidTokenError, KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")
    return user


def get_optional_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    """Best-effort auth for public endpoints that redact PII for anonymous readers."""
    token = _token_from(request)
    if not token:
        return None
    try:
        payload = decode_token(token)
        user = db.get(User, int(payload["sub"]))
    except (InvalidTokenError, KeyError, ValueError):
        return None
    if not user or not user.is_active:
        return None
    return user


def require_roles(*roles: str):
    def guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles and user.role != "admin":
            raise HTTPException(status_code=403, detail="Forbidden for role " + user.role)
        return user
    return guard


def require_perm(*perms: str):
    """Permission gate (any-of): role defaults + direct admin grants.

    Ownership is NOT checked here — resource endpoints must additionally
    call require_tournament_owner / athlete-scope helpers below.
    """
    from app.core.permissions import has_perm

    def guard(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        if any(has_perm(db, user, p) for p in perms):
            return user
        raise HTTPException(status_code=403, detail="Missing permission: " + "/".join(perms))
    return guard


# ---------- tournament ownership scope (P0 + granular permissions) ----------
#
# Authorization matrix (permission AND ownership):
#   tournaments.create   organizer / admin (+ grantable, e.g. coach)
#   tournaments.manage   mutate OWN tournament (created_by == me)
#   tournaments.manage_all  any tournament (admin, non-grantable)
#   categories           read: public            mutate: owner (tournaments.manage)
#   registrations        read: public (PII redacted for anonymous)
#                        create: owner / coach (open registration) / admin
#   import               owner (tournaments.manage)
#   weigh-in/check-in    owner (tournaments.manage) / referee (official)
#   status/brackets/schedule/autofix  owner (tournaments.manage)
#   finish/timer         owner (matches.manage on own) / referee (official)
#   exports/protocol     owner (tournaments.manage)
#   documents issue      owner (documents.manage) (+ athlete registered in tid)
#   athletes             read: public   create/update: athletes.manage (coach: own only)
#   clubs                read: public   create: clubs.manage
#   news                 read: public   mutate: news.manage (global by design)
#   audit                read: audit.view
#   admin/*              roles.manage (grants/roles/decisions), users.view (read-only directory)
#
# Owners are whoever created the tournament (created_by), regardless of role:
# a coach granted tournaments.create+tournaments.manage manages only their own.
# Referees keep global rights only where they act as officials.
# Admin bypasses every check.

def require_staff():
    """Tournament staff gate: admin, referee (official), or anyone holding
    tournaments.manage. Ownership is still enforced per-resource by
    require_tournament_owner / require_match_access."""
    from app.core.permissions import has_perm

    def guard(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
        if user.role == "admin" or user.role == "referee":
            return user
        if has_perm(db, user, "tournaments.manage"):
            return user
        raise HTTPException(status_code=403, detail="Missing permission: tournaments.manage")
    return guard

def require_tournament_owner(
    tid: int,
    db: Session,
    user: User,
    *,
    allow_referee: bool = False,
    allow_coach: bool = False,
):
    """Return the tournament if `user` may mutate it, else 404/403.

    404 for missing tournament (no existence oracle for strangers), 403 for
    cross-tournament access.
    """
    from app.core.permissions import has_perm
    from app.models.tournament import Tournament

    t = db.get(Tournament, tid)
    if not t:
        raise HTTPException(status_code=404, detail="Not found")
    if user.role == "admin" or has_perm(db, user, "tournaments.manage_all"):
        return t
    if allow_referee and user.role == "referee":
        return t
    if allow_coach and user.role == "coach":
        return t
    if t.created_by == user.id and has_perm(db, user, "tournaments.manage"):
        return t
    raise HTTPException(status_code=403, detail="Foreign tournament")


def require_athlete_scope(aid: int, db: Session, user: User):
    """Resolve an athlete the caller may manage, else 404/403.

    Organizer/admin: any athlete. Coach: only own athletes
    (created_by == me, or member of a club I own). Other roles: denied.
    """
    from app.core.permissions import has_perm
    from app.models.club_athlete import Athlete, Club

    a = db.get(Athlete, aid)
    if not a:
        raise HTTPException(status_code=404, detail="Not found")
    if not has_perm(db, user, "athletes.manage"):
        raise HTTPException(status_code=403, detail="Missing permission: athletes.manage")
    if user.role in ("organizer", "admin"):
        return a
    if user.role == "coach":
        if a.created_by == user.id:
            return a
        if a.club_id:
            club = db.get(Club, a.club_id)
            if club and club.owner_id == user.id:
                return a
        raise HTTPException(status_code=403, detail="Foreign athlete")
    raise HTTPException(status_code=403, detail="Forbidden for role " + user.role)


def require_match_access(mid: int, db: Session, user: User):
    """Resolve a match's tournament and enforce finish/timer scope."""
    from app.models.competition import Bracket, BracketMatch

    m = db.get(BracketMatch, mid)
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    b = db.get(Bracket, m.bracket_id)
    if not b:
        raise HTTPException(status_code=404, detail="Match not found")
    t = require_tournament_owner(b.tournament_id, db, user, allow_referee=True)
    return m, b, t
