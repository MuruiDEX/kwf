from fastapi import APIRouter, Depends, HTTPException, Response, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.db import get_db
from app.core.security import hash_password, verify_password, create_token
from app.core.deps import get_current_user, require_roles
from app.core.lang import pick
from app.models.user import User
from app.models.misc import OrganizerRequest, AuditLog
from app.core.config import settings
router = APIRouter(prefix="/api/auth", tags=["auth"])

SELF_ROLES = ("public", "athlete", "coach", "referee")

class Register(BaseModel):
    email: str = Field(min_length=3, max_length=320, pattern=r"^\S+@\S+\.\S+$")
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(default="", max_length=255)
    role: str = "public"

class Login(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=128)

class OrgRequestIn(BaseModel):
    org_name: str = Field(min_length=2, max_length=255)
    message: str = Field(default="", max_length=512)

@router.post("/register")
def register(data: Register, request: Request, response: Response, db: Session = Depends(get_db)):
    if db.query(User).filter_by(email=data.email).first():
        raise HTTPException(400, pick(request, "Email уже зарегистрирован", "Email тіркелген"))
    if data.role not in SELF_ROLES:
        raise HTTPException(400, pick(request,
            "Роль организатора выдаётся только через заявку и одобрение администратора",
            "Ұйымдастырушы рөлі тек өтінім мен әкімші мақұлдауы арқылы беріледі"))
    try:
        pw_hash = hash_password(data.password)
    except ValueError:
        raise HTTPException(400, pick(request, "Пароль слишком длинный (максимум 72 байта)",
                                      "Құпия сөз тым ұзын (максимум 72 байт)"))
    u = User(email=data.email, password_hash=pw_hash, full_name=data.full_name, role=data.role)
    db.add(u)
    try:
        db.commit()
    except IntegrityError:
        # P0: check-then-insert race — concurrent double register of the same
        # email must be a clean 400, not a 500.
        db.rollback()
        raise HTTPException(400, pick(request, "Email уже зарегистрирован", "Email тіркелген"))
    db.refresh(u)
    # Auto-login: same session as /login so the user lands in their account
    # without a second request. Keeps {"ok": True} for backward compatibility.
    token = create_token(str(u.id), u.role)
    response.set_cookie("kwf_token", token, httponly=True, samesite="lax", secure=settings.cookie_secure, max_age=60*60*12, path="/")
    return {"ok": True, "id": u.id, "email": u.email, "role": u.role, "full_name": u.full_name, "token": token}

@router.post("/login")
def login(data: Login, request: Request, response: Response, db: Session = Depends(get_db)):
    u = db.query(User).filter_by(email=data.email).first()
    if not u or not verify_password(data.password, u.password_hash):
        raise HTTPException(401, pick(request, "Неверный email или пароль", "Email немесе құпия сөз қате"))
    token = create_token(str(u.id), u.role)
    response.set_cookie("kwf_token", token, httponly=True, samesite="lax", secure=settings.cookie_secure, max_age=60*60*12, path="/")
    return {"role": u.role, "full_name": u.full_name, "token": token}

@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("kwf_token", path="/")
    return {"ok": True}

@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return {"id": user.id, "email": user.email, "role": user.role, "full_name": user.full_name}

@router.get("/permissions")
def my_permissions(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Effective permission set for the current user (role defaults + grants)."""
    from app.core.permissions import effective_permissions
    return {"role": user.role, "permissions": sorted(effective_permissions(db, user))}

@router.post("/request-organizer")
def request_organizer(data: OrgRequestIn, request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role == "organizer":
        raise HTTPException(400, pick(request, "У вас уже есть доступ организатора", "Сізде ұйымдастырушы рұқсаты бар"))
    pending = db.query(OrganizerRequest).filter_by(user_id=user.id, status="pending").first()
    if pending:
        raise HTTPException(400, pick(request, "Заявка уже на рассмотрении", "Өтінім қаралуда"))
    r = OrganizerRequest(user_id=user.id, org_name=data.org_name, message=data.message)
    db.add(r)
    db.add(AuditLog(actor_id=user.id, action="requested organizer access", entity="organizer_request", entity_id=None))
    db.commit()
    db.refresh(r)
    return {"ok": True, "id": r.id}
