import threading
from datetime import datetime, date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import get_current_user, require_manager
from ..models import Booking, BookingItem, Service, User, Coupon, Instructor
from ..schemas import (
    BookingIn, BookingOut, BookingRichOut, BookingPatch,
    ScenarioIn, ScenarioCatalog,
)
from ..enums import BookingStatus, PaymentStatus, AuditAction, UserRole
from ..scheduler import find_conflicts
from ..realtime import broadcast
from .. import audit, pricing

# Club is 24/7 — no opening-hours window. We still keep a single-day check below
# so analytics / reporting stay clean (each booking belongs to exactly one date).
_booking_write_lock = threading.Lock()


def _check_opening_hours(starts_at: datetime, ends_at: datetime) -> Optional[str]:
    """Bookings must sit within one calendar day. The club is open 24/7,
    so no time-of-day restriction applies."""
    if starts_at.date() != ends_at.date():
        return "Бронь должна быть в пределах одного дня."
    return None


_WEEKDAY_RU = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"]


def _default_working_hours() -> dict:
    return {
        str(d): (
            {"enabled": True, "start": "10:00", "end": "20:00"}
            if d < 5
            else {"enabled": False, "start": "10:00", "end": "18:00"}
        )
        for d in range(7)
    }


def _normalize_working_hours(raw: dict) -> dict:
    if not raw:
        return _default_working_hours()
    out: dict = {}
    for d in range(7):
        key = str(d)
        src = raw.get(key) or raw.get(d) or {}
        out[key] = src if isinstance(src, dict) and src else {"enabled": False, "start": "10:00", "end": "18:00"}
    return out


def _effective_working_hours(inst: Instructor, on: date) -> dict:
    """Возвращает график, актуальный на дату `on`.
    Если есть отложенный (pending) график и его effective_from <= on —
    возвращаем pending. Иначе — текущий working_hours.
    """
    pending = getattr(inst, "pending_working_hours", None)
    eff_from = getattr(inst, "pending_effective_from", None)
    if pending and eff_from and on >= eff_from:
        return _normalize_working_hours(pending or {})
    return _normalize_working_hours(inst.working_hours or {})


def _check_trainer_schedule(db: Session, instructor_id: Optional[int],
                            starts_at: datetime, ends_at: datetime) -> Optional[str]:
    """Return error message if booking is outside the trainer's declared working hours.
    Если график не задан (пустой dict), используем дефолт: Пн-Пт 10:00-20:00,
    Сб-Вс выключены — так же, как это показывается в UI графика тренера.
    """
    if not instructor_id:
        return None
    inst = db.get(Instructor, instructor_id)
    if not inst:
        return None
    wh = _effective_working_hours(inst, starts_at.date())
    if not wh:
        return None  # график не настроен — не блокируем
    weekday = starts_at.weekday()  # 0=пн .. 6=вс
    day = wh.get(str(weekday)) or {}
    # Если день отсутствует в графике (старые записи с неполным набором) —
    # тоже считаем доступным, чтобы случайные дыры не блокировали работу.
    if not day:
        return None
    if not day.get("enabled", False):
        return f"Тренер {inst.name} не работает в {_WEEKDAY_RU[weekday]} — отметил день как выходной."
    try:
        sh, sm = map(int, str(day.get("start", "")).split(":"))
        eh, em = map(int, str(day.get("end", "")).split(":"))
    except Exception:
        return None  # битые данные — не блокируем
    work_start = sh * 60 + sm
    work_end = eh * 60 + em
    b_start = starts_at.hour * 60 + starts_at.minute
    b_end = ends_at.hour * 60 + ends_at.minute
    if b_start < work_start or b_end > work_end:
        return (
            f"Тренер {inst.name} в {_WEEKDAY_RU[weekday]} доступен только "
            f"{day.get('start')}–{day.get('end')}."
        )
    return None
from ..booking_scenario import (
    ScenarioInput, resolve_scenario,
    categories_public, training_options_public,
)

router = APIRouter(prefix="/bookings", tags=["bookings"])


def _rich(b: Booking) -> BookingRichOut:
    return BookingRichOut(
        id=b.id,
        resource_id=b.resource_id,
        service_id=b.service_id,
        customer_id=b.customer_id,
        instructor_id=b.instructor_id,
        starts_at=b.starts_at,
        ends_at=b.ends_at,
        guests=b.guests,
        status=b.status,
        payment_status=b.payment_status,
        price_kopecks=b.price_kopecks,
        discount_kopecks=b.discount_kopecks,
        total_kopecks=b.total_kopecks,
        comment=b.comment,
        customer_name=b.customer.name if b.customer else None,
        service_name=b.service.name if b.service else None,
        resource_name=b.resource.name if b.resource else None,
        instructor_name=b.instructor.name if b.instructor else None,
    )


@router.get("", response_model=List[BookingRichOut])
def list_bookings(
    from_: Optional[datetime] = Query(None, alias="from"),
    to: Optional[datetime] = None,
    on: Optional[date] = None,
    resource_id: Optional[int] = None,
    customer_id: Optional[int] = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Booking)
    if on:
        day_start = datetime.combine(on, datetime.min.time())
        day_end = datetime.combine(on, datetime.max.time())
        q = q.where(Booking.starts_at >= day_start, Booking.starts_at <= day_end)
    if from_:
        q = q.where(Booking.ends_at > from_)
    if to:
        q = q.where(Booking.starts_at < to)
    if resource_id:
        q = q.where(Booking.resource_id == resource_id)
    if customer_id:
        q = q.where(Booking.customer_id == customer_id)
    # Instructors only see their own bookings on the timeline.
    if user.role == UserRole.INSTRUCTOR.value:
        if not user.instructor_id:
            return []
        q = q.where(Booking.instructor_id == user.instructor_id)
    q = q.order_by(Booking.starts_at)
    return [_rich(b) for b in db.execute(q).scalars()]


@router.post("", response_model=BookingRichOut, status_code=201)
def create_booking(
    payload: BookingIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(400, "ends_at must be after starts_at")
    oh = _check_opening_hours(payload.starts_at, payload.ends_at)
    if oh:
        raise HTTPException(400, oh)

    # Тренер может ставить брони только на себя — принудительно проставляем его instructor_id.
    instructor_id = payload.instructor_id
    if user.role == UserRole.INSTRUCTOR.value:
        if not user.instructor_id:
            raise HTTPException(403, "У аккаунта тренера нет привязки к карточке тренера")
        instructor_id = user.instructor_id

    duration_min = int((payload.ends_at - payload.starts_at).total_seconds() // 60)

    coupon_code = getattr(payload, "coupon_code", "") or ""
    pb = pricing.calculate_price(
        db,
        service_id=payload.service_id,
        instructor_id=instructor_id,
        guests=payload.guests,
        duration_min=duration_min,
        coupon_code=coupon_code,
    )

    # Caller can override (e.g. manual price) via explicit price_kopecks
    base_price = payload.price_kopecks or pb.base_kopecks
    discount = payload.discount_kopecks or pb.discount_kopecks
    total = max(0, base_price - discount)

    # Race-safe section: re-check conflicts under the write lock so two concurrent
    # requests can't both pass find_conflicts() and create overlapping bookings.
    with _booking_write_lock:
        if payload.resource_id:
            conflicts = find_conflicts(db, payload.resource_id, payload.starts_at, payload.ends_at)
            if conflicts:
                raise HTTPException(409, {
                    "message": "Конфликт с существующими бронями",
                    "conflicts": [c.id for c in conflicts],
                })

        trainer_err = _check_trainer_schedule(db, instructor_id, payload.starts_at, payload.ends_at)
        if trainer_err:
            raise HTTPException(409, trainer_err)

        b = Booking(
            resource_id=payload.resource_id,
            service_id=payload.service_id,
            customer_id=payload.customer_id,
            instructor_id=instructor_id,
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
            guests=payload.guests,
            with_guest=payload.with_guest,
            status=BookingStatus.CONFIRMED.value,
            payment_status=PaymentStatus.PENDING.value,
            price_kopecks=base_price,
            discount_kopecks=discount,
            total_kopecks=total,
            comment=payload.comment,
            coupon_code=coupon_code if pb.coupon_valid else "",
            created_by_id=user.id,
        )
        db.add(b)
        db.flush()

        if payload.service_id:
            svc = db.get(Service, payload.service_id)
            if svc:
                db.add(BookingItem(
                    booking_id=b.id, kind="service", service_id=svc.id, name=svc.name,
                    quantity=max(1, payload.guests),
                    unit_price_kopecks=svc.base_price_kopecks,
                    total_kopecks=base_price,
                ))

        if pb.coupon_valid:
            pricing.consume_coupon(db, coupon_code)

        audit.log(db, user, AuditAction.CREATE.value, "booking", b.id,
                  summary=f"Создана бронь #{b.id} на {total // 100} ₽")
        db.commit()
        broadcast({"type": "bookings"})
        db.refresh(b)
    return _rich(b)


@router.get("/{booking_id}", response_model=BookingRichOut)
def get_booking(booking_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(404, "Not found")
    return _rich(b)


_TRANSITIONS = {
    # The HELD status is kept in the enum for backward compatibility with rows that
    # may exist in older deployments, but it is no longer reachable: drafts go
    # straight to confirmed/cancelled, and there is no way back into held.
    BookingStatus.DRAFT.value: {BookingStatus.CONFIRMED.value, BookingStatus.CANCELLED.value},
    BookingStatus.CONFIRMED.value: {BookingStatus.CHECKED_IN.value, BookingStatus.CANCELLED.value, BookingStatus.NO_SHOW.value, BookingStatus.COMPLETED.value},
    BookingStatus.CHECKED_IN.value: {BookingStatus.COMPLETED.value, BookingStatus.CANCELLED.value, BookingStatus.NO_SHOW.value},
    BookingStatus.COMPLETED.value: set(),
    BookingStatus.CANCELLED.value: set(),
    # «не пришёл» можно откатить, если ошиблись или гость пришёл с опозданием.
    BookingStatus.NO_SHOW.value: {
        BookingStatus.COMPLETED.value,
        BookingStatus.CHECKED_IN.value,
        BookingStatus.CONFIRMED.value,
    },
}


@router.post("/{booking_id}/transition", response_model=BookingRichOut)
def transition(
    booking_id: int,
    to: str = Query(..., description="Target status"),
    reason: str = "",
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(404, "Not found")
    if to not in _TRANSITIONS.get(b.status, set()):
        raise HTTPException(400, f"Переход {b.status} → {to} запрещён")

    # Тренер может работать только со своими бронями и только кнопкой «Пришёл».
    if user.role == UserRole.INSTRUCTOR.value:
        if b.instructor_id != user.instructor_id:
            raise HTTPException(403, "Можно менять только свои брони")
        if to != BookingStatus.CHECKED_IN.value:
            raise HTTPException(403, "Тренер может отметить только «Пришёл»")

    before = {"status": b.status}
    was_no_show = b.status == BookingStatus.NO_SHOW.value
    b.status = to
    now = datetime.utcnow()
    if to == BookingStatus.CHECKED_IN.value:
        b.checked_in_at = now
        # Если откатываем «не пришёл» обратно в check-in — чистим отметку no_show_at.
        if was_no_show:
            b.no_show_at = None
    elif to == BookingStatus.COMPLETED.value:
        b.completed_at = now
    elif to == BookingStatus.CANCELLED.value:
        b.cancelled_at = now
        b.cancel_reason = reason
    elif to == BookingStatus.NO_SHOW.value:
        b.no_show_at = now
    elif to == BookingStatus.CONFIRMED.value and was_no_show:
        # Возврат из no_show в подтверждённую — снимаем no_show_at.
        b.no_show_at = None

    action_map = {
        BookingStatus.CHECKED_IN.value: AuditAction.CHECK_IN.value,
        BookingStatus.COMPLETED.value: AuditAction.COMPLETE.value,
        BookingStatus.CANCELLED.value: AuditAction.CANCEL.value,
        BookingStatus.NO_SHOW.value: AuditAction.NO_SHOW.value,
    }
    audit.log(db, user, action_map.get(to, AuditAction.STATUS_CHANGE.value),
              "booking", b.id,
              summary=f"{before['status']} → {to}" + (f" ({reason})" if reason else ""),
              before=before, after={"status": b.status})
    db.commit()
    broadcast({"type": "bookings"})
    db.refresh(b)
    return _rich(b)


_PAYMENT_TARGETS = {
    PaymentStatus.PAID.value,
    PaymentStatus.PENDING.value,
    PaymentStatus.REFUNDED.value,
}


@router.post("/{booking_id}/payment", response_model=BookingRichOut)
def set_payment(
    booking_id: int,
    to: str = Query(..., description="paid | pending | refunded"),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark a booking as paid / pending / refunded.

    Restricted to admin, manager and accounting — staff/instructors don't touch
    money. Audit-logged.
    """
    if user.role not in (UserRole.ADMIN.value, UserRole.MANAGER.value, UserRole.ACCOUNTING.value):
        raise HTTPException(403, "Только администратор, менеджер или бухгалтер может менять статус оплаты")
    if to not in _PAYMENT_TARGETS:
        raise HTTPException(400, f"Недопустимый статус оплаты: {to}")
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(404, "Not found")
    before = {"payment_status": b.payment_status}
    b.payment_status = to
    audit.log(db, user, AuditAction.STATUS_CHANGE.value, "booking", b.id,
              summary=f"Оплата: {before['payment_status']} → {to}",
              before=before, after={"payment_status": to})
    db.commit()
    broadcast({"type": "bookings"})
    db.refresh(b)
    return _rich(b)


@router.patch("/{booking_id}", response_model=BookingRichOut)
def patch_booking(
    booking_id: int,
    payload: BookingPatch,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(404, "Not found")
    if user.role == UserRole.INSTRUCTOR.value:
        if not user.instructor_id or b.instructor_id != user.instructor_id:
            raise HTTPException(403, "Можно менять только свои брони")

    new_resource = payload.resource_id if payload.resource_id is not None else b.resource_id
    new_start = payload.starts_at or b.starts_at
    new_end = payload.ends_at or b.ends_at

    if payload.starts_at or payload.ends_at or payload.resource_id is not None:
        if new_end <= new_start:
            raise HTTPException(400, "ends_at must be after starts_at")
        oh = _check_opening_hours(new_start, new_end)
        if oh:
            raise HTTPException(400, oh)
        if new_resource:
            conflicts = find_conflicts(db, new_resource, new_start, new_end, exclude_booking_id=b.id)
            if conflicts:
                raise HTTPException(409, {"message": "Конфликт", "conflicts": [c.id for c in conflicts]})
        trainer_err = _check_trainer_schedule(db, b.instructor_id, new_start, new_end)
        if trainer_err:
            raise HTTPException(409, trainer_err)

    before = {
        "resource_id": b.resource_id,
        "starts_at": b.starts_at.isoformat(),
        "ends_at": b.ends_at.isoformat(),
    }
    b.resource_id = new_resource
    b.starts_at = new_start
    b.ends_at = new_end
    if payload.comment is not None:
        b.comment = payload.comment

    audit.log(db, user, AuditAction.UPDATE.value, "booking", b.id,
              summary="Перенос/правка", before=before,
              after={
                  "resource_id": b.resource_id,
                  "starts_at": b.starts_at.isoformat(),
                  "ends_at": b.ends_at.isoformat(),
              })
    db.commit()
    broadcast({"type": "bookings"})
    db.refresh(b)
    return _rich(b)


# ── Full edit: service/instructor/customer/guests/coupon → recalc price ──
from pydantic import BaseModel, Field


class BookingEditIn(BaseModel):
    service_id: Optional[int] = None
    instructor_id: Optional[int] = None
    customer_id: Optional[int] = None
    resource_id: Optional[int] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    guests: Optional[int] = None
    comment: Optional[str] = None
    coupon_code: Optional[str] = None
    manual_price_kopecks: Optional[int] = None  # override (если задан — берём, иначе recalc)


class BookingExtendIn(BaseModel):
    minutes: int = Field(..., gt=0, le=240, description="На сколько минут продлить (1..240)")


@router.post("/{booking_id}/extend", response_model=BookingRichOut)
def extend_booking(
    booking_id: int,
    payload: BookingExtendIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Быстрое продление брони на N минут. Пересчитывает цену по новой длительности."""
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(404, "Not found")
    if b.status in (BookingStatus.CANCELLED.value, BookingStatus.COMPLETED.value):
        raise HTTPException(400, "Завершённую/отменённую бронь нельзя продлить")

    # Права: тренер — только свои; касса запрещена; остальные — ок.
    if user.role == UserRole.INSTRUCTOR.value:
        if not user.instructor_id or b.instructor_id != user.instructor_id:
            raise HTTPException(403, "Можно продлевать только свои брони")
    elif user.role not in (UserRole.ADMIN.value, UserRole.MANAGER.value, UserRole.STAFF.value):
        raise HTTPException(403, "Forbidden")

    from datetime import timedelta
    new_end = b.ends_at + timedelta(minutes=payload.minutes)

    oh = _check_opening_hours(b.starts_at, new_end)
    if oh:
        raise HTTPException(400, oh)

    if b.resource_id:
        conflicts = find_conflicts(db, b.resource_id, b.starts_at, new_end, exclude_booking_id=b.id)
        if conflicts:
            raise HTTPException(409, {
                "message": "Продление пересекается с другой бронью (ресурс занят)",
                "conflicts": [c.id for c in conflicts],
            })

    # Тренер тоже не должен быть занят в продлённое окно.
    if b.instructor_id:
        active_statuses = (
            BookingStatus.CONFIRMED.value,
            BookingStatus.CHECKED_IN.value,
        )
        trainer_conflicts = list(db.execute(
            select(Booking).where(
                Booking.instructor_id == b.instructor_id,
                Booking.id != b.id,
                Booking.status.in_(active_statuses),
                Booking.starts_at < new_end,
                Booking.ends_at > b.starts_at,
            )
        ).scalars())
        if trainer_conflicts:
            raise HTTPException(409, {
                "message": "Продление пересекается с другой бронью (тренер занят)",
                "conflicts": [c.id for c in trainer_conflicts],
            })

    trainer_err = _check_trainer_schedule(db, b.instructor_id, b.starts_at, new_end)
    if trainer_err:
        raise HTTPException(409, trainer_err)

    before = {
        "ends_at": b.ends_at.isoformat(),
        "total_kopecks": b.total_kopecks,
    }
    b.ends_at = new_end

    # Пересчёт цены по новой длительности — только если не задана ручная цена.
    duration_min = int((b.ends_at - b.starts_at).total_seconds() // 60)
    pb = pricing.calculate_price(
        db,
        service_id=b.service_id, instructor_id=b.instructor_id,
        guests=b.guests, duration_min=duration_min, coupon_code=b.coupon_code or "",
    )
    b.price_kopecks = pb.base_kopecks
    b.discount_kopecks = pb.discount_kopecks
    b.total_kopecks = max(0, b.price_kopecks - b.discount_kopecks)

    audit.log(db, user, AuditAction.UPDATE.value, "booking", b.id,
              summary=f"Продление брони #{b.id} на +{payload.minutes} мин",
              before=before,
              after={"ends_at": b.ends_at.isoformat(), "total_kopecks": b.total_kopecks})
    db.commit()
    broadcast({"type": "bookings"})
    db.refresh(b)
    return _rich(b)


@router.put("/{booking_id}", response_model=BookingRichOut)
def full_edit_booking(
    booking_id: int,
    payload: BookingEditIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(404, "Not found")
    # Тренер может править только свои брони и не может передать её другому тренеру.
    if user.role == UserRole.INSTRUCTOR.value:
        if not user.instructor_id or b.instructor_id != user.instructor_id:
            raise HTTPException(403, "Можно править только свои брони")
        if payload.instructor_id is not None and payload.instructor_id != user.instructor_id:
            raise HTTPException(403, "Тренер не может переназначить бронь другому тренеру")
    elif user.role not in (UserRole.ADMIN.value, UserRole.MANAGER.value, UserRole.STAFF.value):
        raise HTTPException(403, "Forbidden")
    if b.status in (BookingStatus.CANCELLED.value, BookingStatus.COMPLETED.value):
        raise HTTPException(400, "Завершённую/отменённую бронь править нельзя")

    before = {
        "service_id": b.service_id, "instructor_id": b.instructor_id,
        "customer_id": b.customer_id, "starts_at": b.starts_at.isoformat(),
        "ends_at": b.ends_at.isoformat(), "guests": b.guests,
        "total_kopecks": b.total_kopecks,
    }

    # Apply fields
    for field in ("service_id", "instructor_id", "customer_id", "resource_id", "guests", "comment"):
        val = getattr(payload, field)
        if val is not None:
            setattr(b, field, val)
    if payload.starts_at: b.starts_at = payload.starts_at
    if payload.ends_at: b.ends_at = payload.ends_at

    if b.ends_at <= b.starts_at:
        raise HTTPException(400, "ends_at must be after starts_at")
    oh = _check_opening_hours(b.starts_at, b.ends_at)
    if oh:
        raise HTTPException(400, oh)

    # Conflict check on new slot
    if b.resource_id:
        conflicts = find_conflicts(db, b.resource_id, b.starts_at, b.ends_at, exclude_booking_id=b.id)
        if conflicts:
            raise HTTPException(409, {"message": "Конфликт", "conflicts": [c.id for c in conflicts]})
    trainer_err = _check_trainer_schedule(db, b.instructor_id, b.starts_at, b.ends_at)
    if trainer_err:
        raise HTTPException(409, trainer_err)

    # Recalculate price
    duration_min = int((b.ends_at - b.starts_at).total_seconds() // 60)
    new_coupon = payload.coupon_code if payload.coupon_code is not None else b.coupon_code
    pb = pricing.calculate_price(
        db,
        service_id=b.service_id, instructor_id=b.instructor_id,
        guests=b.guests, duration_min=duration_min, coupon_code=new_coupon or "",
    )
    if payload.manual_price_kopecks is not None:
        b.price_kopecks = payload.manual_price_kopecks
        b.discount_kopecks = pb.discount_kopecks if pb.coupon_valid else 0
    else:
        b.price_kopecks = pb.base_kopecks
        b.discount_kopecks = pb.discount_kopecks
    b.total_kopecks = max(0, b.price_kopecks - b.discount_kopecks)
    b.coupon_code = new_coupon or "" if pb.coupon_valid or not new_coupon else b.coupon_code

    audit.log(db, user, AuditAction.UPDATE.value, "booking", b.id,
              summary=f"Полное редактирование брони #{b.id}",
              before=before,
              after={
                  "service_id": b.service_id, "instructor_id": b.instructor_id,
                  "customer_id": b.customer_id, "starts_at": b.starts_at.isoformat(),
                  "ends_at": b.ends_at.isoformat(), "guests": b.guests,
                  "total_kopecks": b.total_kopecks,
              })
    db.commit()
    broadcast({"type": "bookings"})
    db.refresh(b)
    return _rich(b)


@router.delete("/{booking_id}", status_code=204)
def delete_booking(
    booking_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    b = db.get(Booking, booking_id)
    if not b:
        raise HTTPException(404, "Not found")
    # Тренеры не могут удалять брони — пусть обращаются к ресепшену.
    if user.role == UserRole.INSTRUCTOR.value:
        raise HTTPException(
            403,
            "Тренеры не могут удалять брони. Попроси ресепшен или руководителя.",
        )

    # Если бронь использовала тренировку из абонемента — возвращаем счётчик,
    # чтобы гость не потерял тренировку при случайном удалении.
    if b.instructor_id and b.customer_id:
        from ..models import Membership, MembershipPlan
        row = db.execute(
            select(Membership, MembershipPlan)
            .join(MembershipPlan, MembershipPlan.id == Membership.plan_id)
            .where(
                Membership.customer_id == b.customer_id,
                MembershipPlan.covers_training == True,  # noqa: E712
                Membership.starts_on <= b.starts_at.date(),
                Membership.ends_on >= b.starts_at.date(),
            )
        ).first()
        if row and (row[0].trainings_used or 0) > 0:
            row[0].trainings_used = int(row[0].trainings_used) - 1

    db.delete(b)
    audit.log(db, user, AuditAction.DELETE.value, "booking", booking_id,
              summary=f"Удалена бронь #{booking_id} (статус {b.status})")
    db.commit()
    broadcast({"type": "bookings"})


# ─────────────────── Scenario-driven booking flow ─────────────────────


@router.get("/scenario/catalog", response_model=ScenarioCatalog)
def scenario_catalog(user: User = Depends(get_current_user)):
    """Return category tiles + training price matrix for the wizard UI."""
    return {
        "categories": categories_public(),
        "trainings": training_options_public(),
    }


@router.post("/scenario/quote")
def scenario_quote(
    payload: ScenarioIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Live quote — never touches DB. Returns price breakdown + conflict state."""
    quote = resolve_scenario(db, ScenarioInput(
        category=payload.category,
        guests=payload.guests,
        has_training=payload.has_training,
        training_type=payload.training_type,
        trainer_id=payload.trainer_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        customer_id=payload.customer_id,
        comment=payload.comment,
        exclude_booking_id=payload.exclude_booking_id,
        baskets=payload.baskets,
        addon_clubs=payload.addon_clubs,
        addon_ball_baskets=payload.addon_ball_baskets,
        addon_trolleys=payload.addon_trolleys,
        addon_bags=payload.addon_bags,
        addon_golf_carts=payload.addon_golf_carts,
        coupon_code=payload.coupon_code,
        membership_id=payload.membership_id,
        membership_purchase_id=payload.membership_purchase_id,
    ))
    return quote.to_dict()


@router.post("/scenario", response_model=BookingRichOut, status_code=201)
def create_scenario_booking(
    payload: ScenarioIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create a booking from admin scenario input. Server is the source of truth:
    price is taken from the tariff matrix, conflicts are re-validated here.
    """
    quote = resolve_scenario(db, ScenarioInput(
        category=payload.category,
        guests=payload.guests,
        has_training=payload.has_training,
        training_type=payload.training_type,
        trainer_id=payload.trainer_id,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        customer_id=payload.customer_id,
        comment=payload.comment,
        exclude_booking_id=None,
        baskets=payload.baskets,
        addon_clubs=payload.addon_clubs,
        addon_ball_baskets=payload.addon_ball_baskets,
        addon_trolleys=payload.addon_trolleys,
        addon_bags=payload.addon_bags,
        addon_golf_carts=payload.addon_golf_carts,
        coupon_code=payload.coupon_code,
        membership_id=payload.membership_id,
        membership_purchase_id=payload.membership_purchase_id,
    ))
    if not quote.ok:
        raise HTTPException(400, {"message": "Нельзя создать бронь", "errors": quote.errors})

    if payload.has_training and payload.trainer_id:
        trainer_err = _check_trainer_schedule(db, payload.trainer_id, payload.starts_at, payload.ends_at)
        if trainer_err:
            raise HTTPException(409, trainer_err)

    b = Booking(
        resource_id=quote.resource_id,
        service_id=quote.base_service_id,
        customer_id=payload.customer_id,
        instructor_id=payload.trainer_id if payload.has_training else None,
        starts_at=payload.starts_at,
        ends_at=payload.ends_at,
        guests=payload.guests,
        status=BookingStatus.CONFIRMED.value,
        payment_status=PaymentStatus.PENDING.value,
        price_kopecks=quote.subtotal_kopecks,
        discount_kopecks=quote.discount_kopecks,
        total_kopecks=quote.total_kopecks,
        comment=payload.comment,
        coupon_code=quote.coupon_code,
        created_by_id=user.id,
    )
    db.add(b)
    db.flush()

    # Store two line-items so analytics can split revenue by category vs. training
    if quote.base_service_id and quote.base_price_kopecks > 0:
        base_svc = db.get(Service, quote.base_service_id)
        if base_svc:
            qty = quote.baskets if quote.basket_unit else 1
            unit_price = quote.basket_unit_price_kopecks if quote.basket_unit else quote.base_price_kopecks
            db.add(BookingItem(
                booking_id=b.id, kind="service",
                service_id=base_svc.id, name=quote.category_title or base_svc.name,
                quantity=qty,
                unit_price_kopecks=unit_price,
                total_kopecks=quote.base_price_kopecks,
            ))
    for line in quote.equipment_items:
        line_svc = db.execute(
            select(Service).where(Service.sku == line.get("sku"))
        ).scalar_one_or_none()
        db.add(BookingItem(
            booking_id=b.id,
            kind="service" if line_svc else "addon",
            service_id=line_svc.id if line_svc else None,
            name=str(line.get("name") or "Доп. услуга"),
            quantity=int(line.get("quantity") or 1),
            unit_price_kopecks=int(line.get("unit_price_kopecks") or 0),
            total_kopecks=int(line.get("total_kopecks") or 0),
        ))
    if quote.membership_purchase_price_kopecks > 0:
        db.add(BookingItem(
            booking_id=b.id,
            kind="membership",
            service_id=None,
            name=f"Абонемент: {quote.membership_purchase_label or 'абонемент'}",
            quantity=1,
            unit_price_kopecks=quote.membership_purchase_price_kopecks,
            total_kopecks=quote.membership_purchase_price_kopecks,
        ))
    if quote.training_service_id and quote.training_price_kopecks > 0:
        t_svc = db.get(Service, quote.training_service_id)
        if t_svc:
            db.add(BookingItem(
                booking_id=b.id, kind="service",
                service_id=t_svc.id, name=t_svc.name,
                quantity=1,
                unit_price_kopecks=quote.training_price_kopecks,
                total_kopecks=quote.training_price_kopecks,
            ))

    if quote.coupon_code:
        pricing.consume_coupon(db, quote.coupon_code)

    # Consume one абонемент training use if the membership covered the trainer part.
    effective_membership_id = payload.membership_id or payload.membership_purchase_id
    if effective_membership_id and payload.has_training and quote.membership_training_covered:
        from ..models import Membership as _Membership
        m = db.get(_Membership, effective_membership_id)
        if m:
            m.trainings_used = int(m.trainings_used or 0) + 1

    audit.log(db, user, AuditAction.CREATE.value, "booking", b.id,
              summary=f"Создана бронь #{b.id} · {quote.category_short} · {quote.total_kopecks // 100} ₽")
    db.commit()
    broadcast({"type": "bookings"})
    db.refresh(b)
    return _rich(b)
