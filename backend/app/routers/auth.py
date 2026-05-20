from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..models import User
from ..schemas import LoginIn, UserOut
from ..security import verify_password, create_access_token
from ..config import settings
from ..deps import get_current_user
from ..enums import AuditAction
from ..rate_limit import login_limiter
from .. import audit

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=UserOut)
def login(payload: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    # Rate-limit by client IP — prevents brute-force on login.
    ip = request.client.host if request.client else "unknown"
    if not login_limiter.check(ip):
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            "Слишком много попыток входа. Подождите минуту.",
        )

    user = db.execute(select(User).where(User.username == payload.username)).scalar_one_or_none()
    if not user or not user.active or not verify_password(user, payload.password, db):
        audit.log(db, None, AuditAction.LOGIN_FAILED.value, "user", None,
                  summary=f"Failed login: {payload.username}")
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")

    user.last_login_at = datetime.utcnow()
    audit.log(db, user, AuditAction.LOGIN.value, "user", user.id, summary=f"Login: {user.username}")
    db.commit()

    token = create_access_token(user.id, user.role)
    response.set_cookie(
        key=settings.COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        max_age=settings.JWT_EXPIRE_MINUTES * 60,
        path="/",
    )
    return user


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(settings.COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return user
