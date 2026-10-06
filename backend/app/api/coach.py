"""Coach 2.0 media + public directory (avatar serving here since P1).

Avatars: local disk under backend/media/avatars/, random hex filenames,
magic-byte MIME validation, 2 MB cap. Served through a canonical endpoint
that only resolves inside the media root — never a raw static mount.
"""
from __future__ import annotations
import re
import secrets
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.deps import get_current_user
from app.models.user import User
from app.models.misc import AuditLog
from app.models.coach_profile import CoachProfile
from app.models.club_athlete import Club, Athlete
from app.models.training_group import TrainingGroup, TrainingGroupMember
from app.models.competition import Registration, BracketMatch
from app.core.paging import page_args, paginate, envelope

router = APIRouter(tags=["coach-media"])

MEDIA_ROOT = Path(__file__).resolve().parent.parent.parent / "media"
AVATAR_DIR = MEDIA_ROOT / "avatars"
LOGO_DIR = MEDIA_ROOT / "club_logos"

MAX_AVATAR_BYTES = 2 * 1024 * 1024
TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}\.(jpg|jpeg|png|webp)$")
MIME_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
               "png": "image/png", "webp": "image/webp"}


def _sniff_mime(head: bytes) -> str | None:
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    return None


def save_upload(data: bytes, subdir: str) -> str:
    """Validate + store an image, return its random filename.

    MIME comes from magic bytes (never the client filename/extension);
    the stored name is crypto-random so no traversal is expressible.
    """
    if len(data) > MAX_AVATAR_BYTES:
        raise HTTPException(413, "File too large (max 2 MB)")
    if not data:
        raise HTTPException(400, "Empty file")
    mime = _sniff_mime(data[:16])
    if mime is None:
        raise HTTPException(400, "Only JPEG, PNG or WebP images are allowed")
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[mime]
    target_dir = MEDIA_ROOT / subdir
    target_dir.mkdir(parents=True, exist_ok=True)
    name = f"{secrets.token_hex(16)}.{ext}"
    (target_dir / name).write_bytes(data)
    return name


def delete_upload(subdir: str, name: str | None) -> None:
    """Remove a previously stored file. Safe by construction: only exact
    hex-pattern names inside the known subdirectory are ever deleted."""
    if not name or not TOKEN_RE.fullmatch(name):
        return
    try:
        (MEDIA_ROOT / subdir / name).unlink(missing_ok=True)
    except OSError:
        pass


def _serve(subdir: str, token: str):
    if not TOKEN_RE.fullmatch(token):
        raise HTTPException(404, "Not found")
    path = (MEDIA_ROOT / subdir / token).resolve()
    try:
        path.relative_to(MEDIA_ROOT.resolve())
    except ValueError:
        raise HTTPException(404, "Not found")
    if not path.is_file():
        raise HTTPException(404, "Not found")
    ext = token.rsplit(".", 1)[1].lower()
    return FileResponse(
        path, media_type=MIME_BY_EXT.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/api/media/avatar/{token}")
def serve_avatar(token: str):
    """Public avatar bytes (only reachable via stored random tokens)."""
    return _serve("avatars", token)


@router.get("/api/media/club-logo/{token}")
def serve_club_logo(token: str):
    """Public club logo bytes (same guarantees as avatars)."""
    return _serve("club_logos", token)


@router.post("/api/auth/avatar")
async def upload_avatar(file: UploadFile = File(...),
                        db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    """Replace my avatar (owner-only; admins use the same self path).
    Rate-limited like document endpoints; audited."""
    from app.api.auth import _self_profile
    data = await file.read(MAX_AVATAR_BYTES + 1)
    name = save_upload(data, "avatars")
    p = _self_profile(db, user)
    delete_upload("avatars", p.avatar_path)
    p.avatar_path = name
    db.add(AuditLog(actor_id=user.id, action="updated avatar", entity="user", entity_id=user.id))
    db.commit()
    return {"ok": True, "avatar": f"/api/media/avatar/{name}"}


def _avatar_url(p) -> str | None:
    return f"/api/media/avatar/{p.avatar_path}" if p and p.avatar_path else None


def _public_item(user: User, p, club, athletes_count: int) -> dict:
    """Strict allowlist for directory cards — no email, ids beyond the URL
    key, or any private data."""
    return {"user_id": user.id, "name": user.full_name,
            "city": p.city, "country": p.country,
            "specialization": p.specialization,
            "avatar": _avatar_url(p),
            "club": {"id": club.id, "name": club.name} if club else None,
            "athletes_count": athletes_count}


@router.get("/api/coaches")
def list_coaches(q: str = "", city: str = "", country: str = "",
                 pg: dict = Depends(page_args),
                 db: Session = Depends(get_db)):
    """Public coach directory (public profiles only, paginated).

    Batched: one page of profiles + their users/clubs + athlete counts
    grouped per club (no N+1).
    """
    from sqlalchemy import func as _func
    query = db.query(CoachProfile).filter_by(is_public=True).order_by(CoachProfile.id.desc())
    if city:
        query = query.filter(CoachProfile.city.ilike(f"%{city}%"))
    if country:
        query = query.filter(CoachProfile.country.ilike(f"%{country}%"))
    rows, total = paginate(query, pg["limit"], pg["offset"])
    users = {u.id: u for u in db.query(User).filter(
        User.id.in_([p.user_id for p in rows])).all()} if rows else {}
    if q:
        like = q.strip().lower()
        rows = [p for p in rows
                if like in ((users.get(p.user_id).full_name if users.get(p.user_id) else "") or "").lower()
                or like in (p.specialization or "").lower()]
        total = len(rows)
    clubs = db.query(Club).filter(Club.owner_id.in_(list(users))).order_by(Club.id).all() \
        if users else []
    first_club: dict[int, Club] = {}
    for c in clubs:
        first_club.setdefault(c.owner_id, c)
    counts: dict[int, int] = {}
    if clubs:
        for cid, n in db.query(Athlete.club_id, _func.count(Athlete.id)).filter(
                Athlete.club_id.in_([c.id for c in clubs])).group_by(Athlete.club_id).all():
            club = next(c for c in clubs if c.id == cid)
            counts[club.owner_id] = counts.get(club.owner_id, 0) + n
    items = []
    for p in rows:
        u = users.get(p.user_id)
        if not u or not u.is_active:
            continue
        items.append(_public_item(u, p, first_club.get(p.user_id),
                                 counts.get(p.user_id, 0)))
    return envelope(items, total, pg["limit"], pg["offset"])


@router.get("/api/coaches/{uid}")
def public_coach_profile(uid: int, db: Session = Depends(get_db)):
    """Public coach profile. Private or missing profiles are 404 (no oracle).
    All statistics are derived from real data via existing loaders."""
    from sqlalchemy import func as _func
    u = db.get(User, uid)
    p = db.query(CoachProfile).filter_by(user_id=uid).first() if u else None
    if not u or not u.is_active or not p or not p.is_public:
        raise HTTPException(404, "Not found")
    clubs = db.query(Club).filter_by(owner_id=u.id).order_by(Club.id).all()
    cids = [c.id for c in clubs]
    athletes = db.query(Athlete).filter(Athlete.club_id.in_(cids)).all() if cids else []
    aids = [a.id for a in athletes]
    groups = db.query(TrainingGroup).filter(
        TrainingGroup.club_id.in_(cids), TrainingGroup.is_active == True).all() if cids else []  # noqa: E712
    member_counts: dict[int, int] = {}
    if groups:
        for gid, n in db.query(TrainingGroupMember.group_id,
                               _func.count(TrainingGroupMember.id)).filter(
                TrainingGroupMember.group_id.in_([g.id for g in groups])).group_by(
                TrainingGroupMember.group_id).all():
            member_counts[gid] = n
    tour_ids: set[int] = set()
    if aids:
        tour_ids = {r[0] for r in db.query(Registration.tournament_id).filter(
            Registration.athlete_id.in_(aids)).distinct().all()}
    return {
        "user_id": u.id, "name": u.full_name, "city": p.city, "country": p.country,
        "specialization": p.specialization, "bio": p.bio,
        "experience_years": p.experience_years, "avatar": _avatar_url(p),
        "clubs": [{"id": c.id, "name": c.name, "city": c.city,
                   "logo": f"/api/media/club-logo/{c.logo_path}" if c.logo_path else None}
                  for c in clubs],
        "groups": [{"id": g.id, "club_id": g.club_id, "name": g.name,
                    "member_count": member_counts.get(g.id, 0)} for g in groups],
        "stats": {"athletes": len(athletes), "groups": len(groups),
                  "tournaments": len(tour_ids),
                  "titles": db.query(BracketMatch).filter(
                      BracketMatch.winner_id.in_(aids),
                      BracketMatch.status == "finished",
                      BracketMatch.next_match_id.is_(None)).count() if aids else 0,
                  "wins": sum(a.wins or 0 for a in athletes)},
    }
