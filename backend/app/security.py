"""JWT + password hashing (argon2, with legacy SHA-256 migration)."""
from __future__ import annotations
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHash
from jose import JWTError, jwt

from .config import settings
from .models import User
from sqlalchemy.orm import Session

_hasher = PasswordHasher()


def hash_password(raw: str) -> str:
    return _hasher.hash(raw)


def verify_password(user: User, raw: str, db: Session) -> bool:
    """Verify password. Handles legacy SHA-256 → argon2 migration transparently."""
    if not user or not user.password_hash:
        return False
    pw_hash = user.password_hash

    # Legacy SHA-256 (64 hex chars)
    if len(pw_hash) == 64 and all(c in "0123456789abcdef" for c in pw_hash):
        if hashlib.sha256(raw.encode()).hexdigest() == pw_hash:
            user.password_hash = _hasher.hash(raw)
            db.commit()
            return True
        return False

    # Argon2
    try:
        if _hasher.verify(pw_hash, raw):
            if _hasher.check_needs_rehash(pw_hash):
                user.password_hash = _hasher.hash(raw)
                db.commit()
            return True
    except (VerifyMismatchError, InvalidHash):
        return False
    return False


def create_access_token(user_id: int, role: str, expires_minutes: Optional[int] = None) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=expires_minutes or settings.JWT_EXPIRE_MINUTES
    )
    payload = {"sub": str(user_id), "role": role, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALG)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALG])
    except JWTError:
        return None
