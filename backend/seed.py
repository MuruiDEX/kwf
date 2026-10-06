"""Idempotent demo seed: organizer + club + athletes + tournament. Run: python3 seed.py"""
import os
from datetime import date
from app.core.db import Base, engine, SessionLocal
import app.models.user, app.models.club_athlete, app.models.tournament, app.models.competition, app.models.misc  # noqa
from app.models.user import User
from app.models.user import User, UserRole
from app.models.club_athlete import Club, Athlete
from app.models.tournament import Tournament, TournamentCategory
from app.models.competition import Registration
from app.models.misc import News, OrganizerRequest
from app.core.security import hash_password

# Admin bootstrap credentials: ADMIN_EMAIL/ADMIN_PASSWORD win, SEED_* kept for
# backward compatibility. Production rules (ENV=prod): no credentials ->
# no admin is created (never a default password); weak password -> abort.
# Local dev keeps the documented test defaults. Never hardcode real passwords
# here and never log plaintext passwords — only bcrypt hashes hit the DB.
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", os.getenv("SEED_ADMIN_EMAIL", "admin@kwf.org"))
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", os.getenv("SEED_ADMIN_PASSWORD", "admin123"))
SEED_ADMIN_EMAIL = ADMIN_EMAIL
SEED_ADMIN_PASSWORD = ADMIN_PASSWORD
_BOOTSTRAP_IS_PROD_DEFAULTS = (
    os.getenv("ADMIN_EMAIL", os.getenv("SEED_ADMIN_EMAIL")) is None
    and os.getenv("ADMIN_PASSWORD", os.getenv("SEED_ADMIN_PASSWORD")) is None
)

_ENV = os.getenv("ENV", os.getenv("APP_ENV", "dev")).lower()
MIN_BOOTSTRAP_PASSWORD_LEN = 12


def _bootstrap_credentials_or_abort(db) -> tuple[str, str] | None:
    """Return (email, password) to bootstrap, None to skip, or abort."""
    if db.query(User).filter_by(role="admin").first():
        return None  # admin already exists: idempotent, never duplicate
    is_prod = _ENV in ("prod", "production", "staging")
    if is_prod and _BOOTSTRAP_IS_PROD_DEFAULTS:
        print("Seed: ENV=prod and no admin credentials provided — refusing to create a default admin")
        return None
    email, password = ADMIN_EMAIL, ADMIN_PASSWORD
    # Strength gate applies in prod only: dev keeps documented test defaults
    # (E2E and local setup depend on them); prod never gets a weak admin.
    if is_prod and ("@" not in email or len(password.encode()) < MIN_BOOTSTRAP_PASSWORD_LEN):
        raise SystemExit("Seed: refusing weak admin credentials in prod (valid email + password >= 12 chars required)")
    return email, password

def _ensure_role_row(db, user, role, by=None):
    if not db.query(UserRole).filter_by(user_id=user.id, role=role).first():
        db.add(UserRole(user_id=user.id, role=role, granted_by=by))
        db.commit()


from app.main import run_db_migrations
run_db_migrations()
db = SessionLocal()

org = db.query(User).filter_by(email="organizer@kwf.org").first()
if not org:
    org = User(email="organizer@kwf.org", password_hash=hash_password("organizer123"),
               full_name="Demo Organizer", role="organizer")
    db.add(org)
    db.commit()
_ensure_role_row(db, org, "organizer")

# Dev/test-only organizer fixture for manual organizer-workflow testing.
# Never created in prod (unlike the legacy demo accounts above, this one is
# explicitly a local testing convenience, not seeded content).
if _ENV not in ("prod", "production", "staging"):
    test_org = db.query(User).filter_by(email="organizer@test.local").first()
    if not test_org:
        test_org = User(email="organizer@test.local", password_hash=hash_password("organizer123"),
                        full_name="Test Organizer", role="organizer")
        db.add(test_org)
        db.commit()
    _ensure_role_row(db, test_org, "organizer")

admin = db.query(User).filter_by(email=SEED_ADMIN_EMAIL).first()
if not admin:
    from app.models.misc import AuditLog
    creds = _bootstrap_credentials_or_abort(db)
    if creds is None:
        print("Seed: skipped admin bootstrap")
    else:
        email, password = creds
        admin = User(email=email, password_hash=hash_password(password),
                     full_name="Admin", role="admin")
        db.add(admin)
        db.flush()
        # Audit the bootstrap itself (actor None = system); never the password.
        db.add(AuditLog(actor_id=None, action="bootstrap admin created",
                        entity="user", entity_id=admin.id))
        db.commit()
if admin:
    _ensure_role_row(db, admin, "admin")

# Regular user for guest/athlete cabinet checks (test credentials only).
athlete_user = db.query(User).filter_by(email="athlete@kwf.org").first()
if not athlete_user:
    athlete_user = User(email="athlete@kwf.org", password_hash=hash_password("athlete123"),
                        full_name="Demo Athlete", role="athlete")
    db.add(athlete_user)
    db.commit()
_ensure_role_row(db, athlete_user, "athlete")

club = db.query(Club).filter_by(name="Kyokushin Almaty").first()
if not club:
    club = Club(name="Kyokushin Almaty", country="KZ", city="Almaty", coach_name="Sensei Demo")
    db.add(club)
    db.commit()

names = [("Ayan", "Serik"), ("Ivan", "Ivanov"), ("Dias", "Nurlan"), ("Timur", "Bek"),
         ("Arman", "Kairat"), ("Sasha", "Petrov"), ("Miras", "Erlan"), ("Daniyar", "Omar")]
for i, (fn, ln) in enumerate(names):
    if not db.query(Athlete).filter_by(first_name=fn, last_name=ln).first():
        db.add(Athlete(first_name=fn, last_name=ln, gender="male", birth_year=2002,
                       weight_kg=68 + (i % 3), level="advanced", country="KZ",
                       club_id=club.id, points=20 - i * 2))
db.commit()

t = db.query(Tournament).filter_by(name="KWF Championship 2026").first()
if not t:
    t = Tournament(name="KWF Championship 2026", city="Almaty", country="KZ",
                   organization="KWF", start_date=date(2026, 11, 15), status="registration", tatami_count=2,
                   created_by=org.id)
    db.add(t)
    db.commit()
    db.add(TournamentCategory(tournament_id=t.id, name="Men -70kg", gender="male",
                              age_min=18, age_max=35, weight_min=60, weight_max=70))
    db.add(TournamentCategory(tournament_id=t.id, name="Men -80kg", gender="male",
                              age_min=18, age_max=35, weight_min=70, weight_max=80))
    db.commit()

cat = db.query(TournamentCategory).filter_by(tournament_id=t.id).first()
for a in db.query(Athlete).limit(8).all():
    if not db.query(Registration).filter_by(tournament_id=t.id, athlete_id=a.id, category_id=cat.id).first():
        db.add(Registration(tournament_id=t.id, athlete_id=a.id, category_id=cat.id, seed=a.points))
db.commit()

# One demo news so /news and empty-states can be checked both ways.
# author_id stays NULL when admin bootstrap was skipped (prod without creds).
if not db.query(News).filter_by(slug="kwf-2026-announce").first():
    db.add(News(title="KWF Championship 2026: анонс", slug="kwf-2026-announce",
                excerpt="Главный турнир сезона пройдёт в Алматы.",
                body="KWF Championship 2026 пройдёт в Алматы. Регистрация открыта.",
                category="announcements", author_id=admin.id if admin else None))
    db.commit()

# One pending organizer request so the admin panel has something to review.
# Idempotent: only created if this user has no pending request.
if athlete_user and not db.query(OrganizerRequest).filter_by(user_id=athlete_user.id, status="pending").first():
    if athlete_user.role != "organizer":
        db.add(OrganizerRequest(user_id=athlete_user.id, org_name="Demo Club Almaty",
                                message="Тестовая заявка для проверки админ-панели", status="pending"))
        db.commit()

print(f"Seed OK: tournament={t.id} org=organizer@kwf.org/organizer123 admin={SEED_ADMIN_EMAIL if admin else '(skipped — no admin bootstrapped)'}")
db.close()
