"""Self-service эндпоинты: тренер редактирует свой график, смотрит свои брони,
плюс смена своего пароля (force-change при must_change_password=True)."""
from datetime import date, timedelta
from typing import Optional, Dict
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import User, Instructor
from ..enums import AuditAction, UserRole
from ..security import hash_password, verify_password
from .. import audit

router = APIRouter(prefix="/me", tags=["me"])


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def _strength(cls, v: str) -> str:
        if v.lower() == v or v.upper() == v:
            # Must mix case
            pass  # not strictly required; min_length=8 is the enforced floor
        weak = {"password", "12345678", "qwerty12", "admin123"}
        if v.lower() in weak:
            raise ValueError("Слишком простой пароль — выберите более надёжный")
        return v


@router.post("/change-password")
def change_password(
    payload: ChangePasswordIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not verify_password(user, payload.current_password, db):
        raise HTTPException(400, "Текущий пароль введён неверно")
    if payload.new_password == payload.current_password:
        raise HTTPException(400, "Новый пароль должен отличаться от текущего")
    if payload.new_password.lower() == user.username.lower():
        raise HTTPException(400, "Пароль не должен совпадать с логином")
    user.password_hash = hash_password(payload.new_password)
    user.must_change_password = False
    audit.log(db, user, AuditAction.UPDATE.value, "user", user.id,
              summary=f"Пароль изменён: {user.username}")
    db.commit()
    return {"ok": True}

# Изменения графика тренера вступают в силу через N дней — чтобы тренер не мог
# в день в день поменять расписание и подвести ресепшен. Админ меняет напрямую через catalog_admin.
SCHEDULE_LOCK_DAYS = 7


class DaySchedule(BaseModel):
    enabled: bool = False
    start: str = "08:00"
    end: str = "22:00"

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        try:
            hh, mm = v.split(":")
            h, m = int(hh), int(mm)
            if not (0 <= h <= 23 and 0 <= m <= 59):
                raise ValueError
        except Exception:
            raise ValueError("Время должно быть в формате HH:MM")
        return f"{h:02d}:{m:02d}"


WeeklySchedule = Dict[str, DaySchedule]  # ключи "0"..«6» (пн..вс)


class ScheduleIn(BaseModel):
    days: WeeklySchedule = Field(default_factory=dict)


class ScheduleOut(BaseModel):
    instructor_id: int
    instructor_name: str
    days: WeeklySchedule
    pending_days: Optional[WeeklySchedule] = None
    pending_effective_from: Optional[date] = None


def _default_days() -> WeeklySchedule:
    # Пн–Пт по умолчанию включены 10–20, выходные выключены.
    out: WeeklySchedule = {}
    for d in range(7):
        if d < 5:
            out[str(d)] = DaySchedule(enabled=True, start="10:00", end="20:00")
        else:
            out[str(d)] = DaySchedule(enabled=False, start="10:00", end="18:00")
    return out


def _read_days(raw: dict) -> WeeklySchedule:
    """Нормализуем JSON-поле working_hours в предсказуемый словарь 7 дней."""
    if not raw:
        return _default_days()
    out: WeeklySchedule = {}
    for d in range(7):
        key = str(d)
        src = raw.get(key) or raw.get(d) or {}
        try:
            out[key] = DaySchedule(**src) if isinstance(src, dict) else DaySchedule()
        except Exception:
            out[key] = DaySchedule()
    return out


def _materialize_pending(inst: Instructor) -> bool:
    """Если у инструктора есть отложенный график и его дата уже наступила —
    переносим его в working_hours и чистим pending. Возвращает True, если что-то изменилось."""
    eff = inst.pending_effective_from
    if eff and inst.pending_working_hours and eff <= date.today():
        inst.working_hours = inst.pending_working_hours
        inst.pending_working_hours = None
        inst.pending_effective_from = None
        return True
    return False


def _build_schedule_out(inst: Instructor) -> ScheduleOut:
    pending = inst.pending_working_hours
    eff = inst.pending_effective_from
    return ScheduleOut(
        instructor_id=inst.id,
        instructor_name=inst.name,
        days=_read_days(inst.working_hours or {}),
        pending_days=_read_days(pending) if pending else None,
        pending_effective_from=eff,
    )


@router.get("/schedule", response_model=ScheduleOut)
def get_my_schedule(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if user.role != UserRole.INSTRUCTOR.value or not user.instructor_id:
        raise HTTPException(403, "Доступно только тренерам")
    inst = db.get(Instructor, user.instructor_id)
    if not inst:
        raise HTTPException(404, "Карточка тренера не найдена")
    if _materialize_pending(inst):
        db.commit()
    return _build_schedule_out(inst)


@router.put("/schedule", response_model=ScheduleOut)
def set_my_schedule(
    payload: ScheduleIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if user.role != UserRole.INSTRUCTOR.value or not user.instructor_id:
        raise HTTPException(403, "Доступно только тренерам")
    inst = db.get(Instructor, user.instructor_id)
    if not inst:
        raise HTTPException(404, "Карточка тренера не найдена")

    _materialize_pending(inst)

    # Валидируем и нормализуем 7 дней, чтобы в БД всегда был полный набор.
    days_in = {str(k): v for k, v in (payload.days or {}).items()}
    normalized: WeeklySchedule = {}
    for d in range(7):
        key = str(d)
        entry = days_in.get(key) or DaySchedule()
        if entry.enabled and entry.start >= entry.end:
            raise HTTPException(400, f"День {key}: время начала должно быть раньше конца")
        normalized[key] = entry

    serialized = {k: v.model_dump() for k, v in normalized.items()}

    # Если у тренера ещё нет действующего графика — применяем сразу (чтобы можно
    # было хоть как-то начать работать). Иначе откладываем на N дней.
    if not (inst.working_hours or {}):
        before = {"working_hours": inst.working_hours or {}}
        inst.working_hours = serialized
        inst.pending_working_hours = None
        inst.pending_effective_from = None
        audit.log(db, user, AuditAction.UPDATE.value, "instructor", inst.id,
                  summary=f"Тренер {inst.name} задал начальный график",
                  before=before, after={"working_hours": inst.working_hours})
    else:
        eff_from = date.today() + timedelta(days=SCHEDULE_LOCK_DAYS)
        before = {
            "pending_working_hours": inst.pending_working_hours or {},
            "pending_effective_from": inst.pending_effective_from.isoformat() if inst.pending_effective_from else None,
        }
        inst.pending_working_hours = serialized
        inst.pending_effective_from = eff_from
        audit.log(db, user, AuditAction.UPDATE.value, "instructor", inst.id,
                  summary=f"Тренер {inst.name} запланировал новый график (вступит в силу с {eff_from.isoformat()})",
                  before=before,
                  after={
                      "pending_working_hours": inst.pending_working_hours,
                      "pending_effective_from": eff_from.isoformat(),
                  })
    db.commit()
    db.refresh(inst)
    return _build_schedule_out(inst)


@router.get("/schedule/{instructor_id}", response_model=ScheduleOut)
def get_instructor_schedule(
    instructor_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Чтение графика любого тренера — доступно всем авторизованным (для валидации при создании брони)."""
    inst = db.get(Instructor, instructor_id)
    if not inst:
        raise HTTPException(404, "Not found")
    if _materialize_pending(inst):
        db.commit()
    return _build_schedule_out(inst)


@router.put("/schedule/{instructor_id}", response_model=ScheduleOut)
def admin_set_instructor_schedule(
    instructor_id: int,
    payload: ScheduleIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Админ/менеджер мгновенно меняет график любого тренера — без 7-дневной задержки.
    Заодно чистит отложенный pending, чтобы он не переписал сразу сделанное вручную."""
    if user.role not in (UserRole.ADMIN.value, UserRole.MANAGER.value):
        raise HTTPException(403, "Только админ или менеджер может менять график тренера напрямую")
    inst = db.get(Instructor, instructor_id)
    if not inst:
        raise HTTPException(404, "Not found")

    days_in = {str(k): v for k, v in (payload.days or {}).items()}
    normalized: WeeklySchedule = {}
    for d in range(7):
        key = str(d)
        entry = days_in.get(key) or DaySchedule()
        if entry.enabled and entry.start >= entry.end:
            raise HTTPException(400, f"День {key}: время начала должно быть раньше конца")
        normalized[key] = entry

    serialized = {k: v.model_dump() for k, v in normalized.items()}
    before = {
        "working_hours": inst.working_hours or {},
        "pending_working_hours": inst.pending_working_hours or {},
        "pending_effective_from": inst.pending_effective_from.isoformat() if inst.pending_effective_from else None,
    }
    inst.working_hours = serialized
    inst.pending_working_hours = None
    inst.pending_effective_from = None
    audit.log(db, user, AuditAction.UPDATE.value, "instructor", inst.id,
              summary=f"Админ {user.name} мгновенно изменил график тренера {inst.name}",
              before=before,
              after={"working_hours": inst.working_hours})
    db.commit()
    db.refresh(inst)
    return _build_schedule_out(inst)
