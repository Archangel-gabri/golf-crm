"""Demo data generator — fills DB with realistic bookings spread over 30 days
so analytics dashboards (pace, heatmap, top days, revenue-by-category, utilization)
become populated and visually meaningful. Admin-only, idempotent marker flag.
"""
from __future__ import annotations
from datetime import datetime, timedelta, date
import random
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import require_admin
from ..models import (
    User, Booking, BookingItem, Customer, Resource, Service,
    Instructor, AppSetting, MembershipPlan, Membership, ResourceService,
)
from ..enums import BookingStatus, PaymentStatus, AuditAction
from ..scheduler import find_conflicts
from .. import audit

router = APIRouter(prefix="/demo", tags=["demo"])

DEMO_MARKER_KEY = "demo_data_seeded_at"

SAMPLE_NAMES = [
    "Александр Смирнов", "Мария Иванова", "Дмитрий Кузнецов", "Елена Петрова",
    "Андрей Соколов", "Ольга Попова", "Максим Васильев", "Анастасия Морозова",
    "Сергей Новиков", "Татьяна Фёдорова", "Владимир Михайлов", "Ирина Николаева",
    "Алексей Волков", "Екатерина Лебедева", "Павел Козлов",
]

def random_phone() -> str:
    """Случайный номер для демо-клиента — реальных телефонов в сиде нет."""
    return (
        f"+7 (9{random.randint(10, 99)}) {random.randint(100, 999)}"
        f"-{random.randint(10, 99)}-{random.randint(10, 99)}"
    )


@router.post("/seed")
def seed_demo(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
    bookings_count: int = 80,
):
    """Populate 30 days of activity. Safe to call multiple times — only creates
    bookings on otherwise-empty slots. Marks `demo_data_seeded_at` setting."""

    customers = list(db.execute(select(Customer)).scalars())
    if len(customers) < 10:
        for n in SAMPLE_NAMES:
            if not db.execute(select(Customer).where(Customer.name == n)).scalar_one_or_none():
                c = Customer(name=n, phone=random_phone(), email=f"{n.split()[0].lower()}@demo.ru")
                db.add(c)
                customers.append(c)
        db.flush()

    # Attach random memberships to first 5 customers
    plans = list(db.execute(select(MembershipPlan)).scalars())
    today_ = date.today()
    for c in customers[:5]:
        if not db.execute(select(Membership).where(Membership.customer_id == c.id)).scalar_one_or_none():
            p = random.choice(plans)
            db.add(Membership(
                customer_id=c.id, plan_id=p.id,
                starts_on=today_ - timedelta(days=random.randint(0, 200)),
                ends_on=today_ + timedelta(days=p.duration_days),
                active=True,
            ))

    resources = list(db.execute(select(Resource).where(Resource.active == True)).scalars())  # noqa: E712
    services = list(db.execute(select(Service).where(Service.active == True)).scalars())  # noqa: E712
    instructors = list(db.execute(select(Instructor).where(Instructor.active == True)).scalars())  # noqa: E712

    if not resources or not services:
        raise HTTPException(400, "Нет ресурсов/услуг для сидера — сначала seed_if_empty")

    # Build service_id -> compatible resource list so demo bookings respect the
    # real catalog (no more "SkyTrak / Лунки 19, 20" mismatches).
    res_by_id = {r.id: r for r in resources}
    links = db.execute(select(ResourceService.service_id, ResourceService.resource_id)).all()
    svc_resources: dict[int, list[Resource]] = {}
    for sid, rid in links:
        r = res_by_id.get(rid)
        if r and r.active:
            svc_resources.setdefault(sid, []).append(r)
    # Only generate bookings for services that have at least one bound resource
    services = [s for s in services if svc_resources.get(s.id)]
    if not services:
        raise HTTPException(400, "Ни одна услуга не привязана к ресурсам")

    created = 0
    attempts = 0
    # Generate over last 30 days + next 7
    while created < bookings_count and attempts < bookings_count * 3:
        attempts += 1
        day_offset = random.randint(-28, 7)
        day_at = today_ + timedelta(days=day_offset)
        # Weighted hour distribution: peaks 10-12 and 17-20
        hour = random.choices(
            range(8, 22),
            weights=[1, 3, 5, 4, 3, 2, 2, 3, 4, 6, 7, 7, 5, 2],
        )[0]
        minute = random.choice([0, 15, 30, 45])
        starts = datetime.combine(day_at, datetime.min.time()).replace(hour=hour, minute=minute)
        svc = random.choice(services)
        ends = starts + timedelta(minutes=svc.duration_min)
        compat = [r for r in svc_resources[svc.id] if r.season in ("all_year", "summer")]
        if not compat:
            continue
        res = random.choice(compat)

        # Skip if conflict
        if find_conflicts(db, res.id, starts, ends):
            continue

        cust = random.choice(customers)
        instr = random.choice(instructors) if svc.requires_instructor else None
        guests = svc.group_size or 1

        # Status distribution: mostly completed (for the past), confirmed (future)
        if day_offset < 0:
            status = random.choices(
                [BookingStatus.COMPLETED.value, BookingStatus.NO_SHOW.value,
                 BookingStatus.CANCELLED.value, BookingStatus.CHECKED_IN.value],
                weights=[75, 5, 10, 10],
            )[0]
            pay_status = (
                PaymentStatus.PAID.value
                if status in (BookingStatus.COMPLETED.value, BookingStatus.CHECKED_IN.value)
                else PaymentStatus.PENDING.value
            )
        else:
            status = BookingStatus.CONFIRMED.value
            pay_status = random.choice([PaymentStatus.PENDING.value, PaymentStatus.PAID.value])

        price = svc.base_price_kopecks * guests
        b = Booking(
            resource_id=res.id, service_id=svc.id, customer_id=cust.id,
            instructor_id=instr.id if instr else None,
            starts_at=starts, ends_at=ends, guests=guests,
            status=status, payment_status=pay_status,
            price_kopecks=price, total_kopecks=price,
            comment="(demo)", created_by_id=user.id,
        )
        if status == BookingStatus.COMPLETED.value:
            b.completed_at = starts + timedelta(minutes=svc.duration_min)
        elif status == BookingStatus.CANCELLED.value:
            b.cancelled_at = starts - timedelta(days=1)
            b.cancel_reason = "demo cancel"
        db.add(b)
        db.flush()
        db.add(BookingItem(
            booking_id=b.id, kind="service", service_id=svc.id,
            name=svc.name, quantity=guests,
            unit_price_kopecks=svc.base_price_kopecks, total_kopecks=price,
        ))
        created += 1

    # Update marker
    marker = db.get(AppSetting, DEMO_MARKER_KEY)
    stamp = datetime.utcnow().isoformat(timespec="seconds")
    if marker:
        marker.value = stamp
    else:
        db.add(AppSetting(key=DEMO_MARKER_KEY, value=stamp))

    audit.log(db, user, AuditAction.CREATE.value, "demo_seed", None,
              summary=f"Сгенерировано демо-данных: {created} броней")
    db.commit()
    return {"created": created, "attempts": attempts, "customers": len(customers)}


@router.post("/wipe-demo")
def wipe_demo(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Remove everything created by /demo/seed (identified by comment='(demo)')."""
    rows = db.execute(select(Booking).where(Booking.comment == "(demo)")).scalars().all()
    n = 0
    for b in rows:
        db.delete(b)
        n += 1
    audit.log(db, user, AuditAction.DELETE.value, "demo_seed", None,
              summary=f"Удалено демо-броней: {n}")
    db.commit()
    return {"deleted": n}


@router.post("/reset")
def reset_all(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Nuke all bookings + all customers. Keeps users, services, resources and
    instructors — so admin can start testing on an empty DB."""
    bookings_deleted = 0
    for b in list(db.execute(select(Booking)).scalars()):
        db.delete(b)
        bookings_deleted += 1
    customers_deleted = 0
    for c in list(db.execute(select(Customer)).scalars()):
        db.delete(c)
        customers_deleted += 1
    audit.log(db, user, AuditAction.DELETE.value, "demo_reset", None,
              summary=f"Полный сброс: {bookings_deleted} броней, {customers_deleted} клиентов")
    db.commit()
    return {"bookings_deleted": bookings_deleted, "customers_deleted": customers_deleted}
