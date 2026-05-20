"""Admin router: staff CRUD, audit log viewer, settings."""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import require_admin, get_current_user
from ..models import User, AuditLog, AppSetting, Instructor
from ..enums import UserRole, AuditAction
from ..security import hash_password
from .. import audit

router = APIRouter(prefix="/admin", tags=["admin"])


# ── Staff ────────────────────────────────────────────────────────────
class StaffIn(BaseModel):
    username: str
    name: str
    email: str = ""
    role: str = UserRole.STAFF.value
    instructor_id: Optional[int] = None
    password: str
    active: bool = True


class StaffPatch(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    instructor_id: Optional[int] = None
    password: Optional[str] = None
    active: Optional[bool] = None


class StaffOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    name: str
    email: str
    role: str
    instructor_id: Optional[int] = None
    active: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime


def _validate_instructor_link(db: Session, instructor_id: Optional[int]) -> int:
    if not instructor_id:
        raise HTTPException(400, "Для роли инструктора выберите карточку тренера")
    instructor = db.get(Instructor, instructor_id)
    if not instructor:
        raise HTTPException(400, "Карточка тренера не найдена")
    return instructor.id


@router.get("/staff", response_model=List[StaffOut])
def list_staff(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return list(db.execute(select(User).order_by(User.role, User.name)).scalars())


@router.post("/staff", response_model=StaffOut, status_code=201)
def create_staff(
    payload: StaffIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if db.execute(select(User).where(User.username == payload.username)).scalar_one_or_none():
        raise HTTPException(409, "Username already exists")
    if payload.role not in {r.value for r in UserRole}:
        raise HTTPException(400, "Invalid role")
    instructor_id = None
    if payload.role == UserRole.INSTRUCTOR.value:
        instructor_id = _validate_instructor_link(db, payload.instructor_id)
    u = User(
        username=payload.username,
        name=payload.name,
        email=payload.email,
        role=payload.role,
        instructor_id=instructor_id,
        active=payload.active,
        password_hash=hash_password(payload.password),
    )
    db.add(u)
    db.flush()
    audit.log(db, user, AuditAction.CREATE.value, "user", u.id,
              summary=f"Создан сотрудник: {u.username} ({u.role})")
    db.commit()
    db.refresh(u)
    return u


@router.patch("/staff/{uid}", response_model=StaffOut)
def update_staff(
    uid: int,
    payload: StaffPatch,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    before = {
        "name": u.name,
        "email": u.email,
        "role": u.role,
        "instructor_id": u.instructor_id,
        "active": u.active,
    }
    role_supplied = "role" in payload.model_fields_set
    instructor_supplied = "instructor_id" in payload.model_fields_set
    if payload.name is not None:
        u.name = payload.name
    if payload.email is not None:
        u.email = payload.email
    if payload.role is not None:
        if payload.role not in {r.value for r in UserRole}:
            raise HTTPException(400, "Invalid role")
        u.role = payload.role
    if role_supplied or instructor_supplied:
        if u.role == UserRole.INSTRUCTOR.value:
            target_id = payload.instructor_id if instructor_supplied else u.instructor_id
            u.instructor_id = _validate_instructor_link(db, target_id)
        else:
            u.instructor_id = None
    if payload.active is not None:
        u.active = payload.active
    if payload.password:
        u.password_hash = hash_password(payload.password)
    audit.log(db, user, AuditAction.UPDATE.value, "user", u.id,
              summary=f"Изменён сотрудник: {u.username}",
              before=before,
              after=payload.model_dump(exclude_none=True, exclude={"password"}))
    db.commit()
    db.refresh(u)
    return u


@router.delete("/staff/{uid}", status_code=204)
def delete_staff(
    uid: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    if uid == user.id:
        raise HTTPException(400, "Нельзя удалить самого себя")
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "Not found")
    db.delete(u)
    audit.log(db, user, AuditAction.DELETE.value, "user", uid,
              summary=f"Удалён сотрудник: {u.username}")
    db.commit()


# ── Audit log ────────────────────────────────────────────────────────
class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    at: datetime
    actor_username: str
    action: str
    entity: str
    entity_id: Optional[int]
    summary: str
    before: dict
    after: dict
    ip: str


@router.get("/audit", response_model=List[AuditOut])
def list_audit(
    entity: Optional[str] = None,
    action: Optional[str] = None,
    limit: int = Query(200, le=1000),
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    q = select(AuditLog).order_by(AuditLog.at.desc()).limit(limit)
    if entity:
        q = q.where(AuditLog.entity == entity)
    if action:
        q = q.where(AuditLog.action == action)
    return list(db.execute(q).scalars())


# ── Settings ─────────────────────────────────────────────────────────
class SettingIn(BaseModel):
    value: str


class SettingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    key: str
    value: str


@router.get("/settings", response_model=List[SettingOut])
def list_settings(user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return list(db.execute(select(AppSetting).order_by(AppSetting.key)).scalars())


@router.put("/settings/{key}", response_model=SettingOut)
def update_setting(
    key: str,
    payload: SettingIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    setting = db.get(AppSetting, key)
    if setting:
        before = {"value": setting.value}
        setting.value = payload.value
    else:
        setting = AppSetting(key=key, value=payload.value)
        db.add(setting)
        before = {}
    audit.log(db, user, AuditAction.UPDATE.value, "setting", None,
              summary=f"Настройка {key} = {payload.value}",
              before=before, after={"value": payload.value})
    db.commit()
    db.refresh(setting)
    return setting
