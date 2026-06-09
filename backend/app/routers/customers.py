from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select, or_, func

from ..db import get_db
from ..deps import get_current_user, require_manager
from datetime import date
from ..models import Customer, User, Booking, Membership, MembershipPlan, Service, Instructor, Resource
from ..schemas import CustomerIn, CustomerOut, CustomerWithStatsOut, CustomerVisitOut
from ..enums import AuditAction, BookingStatus, UserRole
from ..realtime import broadcast
from .. import audit


# Все «рабочие» роли могут заводить/править/удалять клиентов.
# Касса — read-only (как и раньше), гостя у нас нет.
_EDIT_ROLES = {
    UserRole.ADMIN.value,
    UserRole.MANAGER.value,
    UserRole.STAFF.value,
    UserRole.INSTRUCTOR.value,
}


def _require_edit(user: User) -> None:
    if user.role not in _EDIT_ROLES:
        raise HTTPException(403, "Forbidden")


def _trainer_visible_customer_ids(db: Session, user: User) -> set[int]:
    """Customer ids visible to a trainer: те, кто записывался к ним, + те, кого они сами завели."""
    inst_id = user.instructor_id or 0
    rows_booked = db.execute(
        select(Booking.customer_id).where(
            Booking.instructor_id == inst_id,
            Booking.customer_id.is_not(None),
        ).distinct()
    ).all()
    rows_created = db.execute(
        select(Customer.id).where(Customer.created_by_id == user.id)
    ).all()
    out: set[int] = {int(r[0]) for r in rows_booked if r[0] is not None}
    out.update(int(r[0]) for r in rows_created if r[0] is not None)
    return out


def _ensure_trainer_can_see(db: Session, user: User, customer_id: int) -> None:
    """403, если тренер пытается работать с чужим клиентом."""
    if user.role != UserRole.INSTRUCTOR.value:
        return
    visible = _trainer_visible_customer_ids(db, user)
    if customer_id not in visible:
        raise HTTPException(403, "Этот клиент не записан к вам и не заведён вами.")


router = APIRouter(prefix="/customers", tags=["customers"])


# Money / visits are recognised only after the admin pressed «Завершить».
# Confirmed or checked-in bookings don't yet count towards "Потратил".
_VISITED = (BookingStatus.COMPLETED.value,)


@router.get("", response_model=List[CustomerWithStatsOut])
def list_customers(
    q: Optional[str] = Query(None, description="Search by name/phone/email"),
    created_from: Optional[date] = Query(None, description="Filter by creation date (inclusive)"),
    created_to: Optional[date] = Query(None, description="Filter by creation date (inclusive)"),
    limit: int = 500,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(Customer)
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Customer.name.like(like), Customer.phone.like(like), Customer.email.like(like)))
    if created_from:
        stmt = stmt.where(func.date(Customer.created_at) >= created_from)
    if created_to:
        stmt = stmt.where(func.date(Customer.created_at) <= created_to)

    # Тренер видит только своих клиентов: тех, кто к нему записался, + кого сам завёл.
    if user.role == UserRole.INSTRUCTOR.value:
        visible = _trainer_visible_customer_ids(db, user)
        if not visible:
            return []
        stmt = stmt.where(Customer.id.in_(visible))

    stmt = stmt.order_by(Customer.name).limit(limit)
    customers = list(db.execute(stmt).scalars())
    if not customers:
        return []

    # One aggregated query for all customers in the page.
    ids = [c.id for c in customers]
    stats_rows = db.execute(
        select(
            Booking.customer_id.label("cid"),
            func.count().label("visits"),
            func.coalesce(func.sum(Booking.total_kopecks), 0).label("spent"),
        )
        .where(
            Booking.customer_id.in_(ids),
            Booking.status.in_(_VISITED),
        )
        .group_by(Booking.customer_id)
    ).all()
    stats = {r.cid: (int(r.visits), int(r.spent)) for r in stats_rows}

    # Active abonements per customer — one grouped query.
    today = date.today()
    subs_rows = db.execute(
        select(Membership, MembershipPlan)
        .join(MembershipPlan, MembershipPlan.id == Membership.plan_id)
        .where(
            Membership.customer_id.in_(ids),
            Membership.active == True,  # noqa: E712
            Membership.ends_on >= today,
        )
        .order_by(Membership.ends_on.desc())
    ).all()
    subs_by_customer: dict[int, list[str]] = {}
    for m, p in subs_rows:
        label = p.name
        if p.covers_all_services:
            label = f"{p.name} · все услуги"
        elif p.covers_training:
            if p.max_trainings > 0:
                left = max(0, p.max_trainings - int(m.trainings_used or 0))
                label = f"{p.name} · {left}/{p.max_trainings} тр."
            else:
                label = f"{p.name} · ∞ тр."
        days_left = (m.ends_on - today).days
        label = f"{label} · ещё {days_left} дн."
        subs_by_customer.setdefault(m.customer_id, []).append(label)

    creator_ids = {c.created_by_id for c in customers if c.created_by_id}
    creator_names: dict[int, str] = {}
    if creator_ids and user.role in (UserRole.ADMIN.value, UserRole.MANAGER.value, UserRole.STAFF.value):
        for u in db.execute(select(User).where(User.id.in_(creator_ids))).scalars():
            creator_names[u.id] = u.name

    out: list[CustomerWithStatsOut] = []
    for c in customers:
        visits, spent = stats.get(c.id, (0, 0))
        out.append(CustomerWithStatsOut(
            id=c.id, name=c.name, phone=c.phone, email=c.email,
            car_brand=c.car_brand, car_number=c.car_number,
            birthdate=c.birthdate, notes=c.notes,
            consent_marketing=c.consent_marketing,
            created_at=c.created_at,
            visits=visits,
            total_spent_kopecks=spent,
            active_memberships=subs_by_customer.get(c.id, []),
            created_by_name=creator_names.get(c.created_by_id) if c.created_by_id else None,
        ))
    return out


@router.post("", response_model=CustomerOut, status_code=201)
def create_customer(
    payload: CustomerIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_edit(user)
    c = Customer(**payload.model_dump())
    c.created_by_id = user.id
    db.add(c)
    db.flush()
    audit.log(db, user, AuditAction.CREATE.value, "customer", c.id,
              summary=f"Создан клиент {c.name}")
    db.commit()
    broadcast({"type": "customers"})
    db.refresh(c)
    return c


@router.get("/{customer_id}", response_model=CustomerOut)
def get_customer(customer_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Not found")
    _ensure_trainer_can_see(db, user, customer_id)
    return c


@router.get("/{customer_id}/visits", response_model=List[CustomerVisitOut])
def customer_visits(
    customer_id: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Not found")
    _ensure_trainer_can_see(db, user, customer_id)
    rows = db.execute(
        select(Booking, Service, Instructor, Resource)
        .outerjoin(Service, Service.id == Booking.service_id)
        .outerjoin(Instructor, Instructor.id == Booking.instructor_id)
        .outerjoin(Resource, Resource.id == Booking.resource_id)
        .where(Booking.customer_id == customer_id)
        .order_by(Booking.starts_at.desc())
    ).all()
    return [
        CustomerVisitOut(
            booking_id=b.id,
            date=b.starts_at,
            service_name=svc.name if svc else None,
            instructor_name=inst.name if inst else None,
            resource_name=res.name if res else None,
            guests=b.guests,
            total_kopecks=b.total_kopecks,
            status=b.status,
        )
        for b, svc, inst, res in rows
    ]


@router.put("/{customer_id}", response_model=CustomerOut)
def update_customer(
    customer_id: int,
    payload: CustomerIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_edit(user)
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Not found")
    _ensure_trainer_can_see(db, user, customer_id)
    before = {k: getattr(c, k) for k in payload.model_dump()}
    for k, v in payload.model_dump().items():
        setattr(c, k, v)
    audit.log(db, user, AuditAction.UPDATE.value, "customer", c.id,
              summary=f"Изменён {c.name}", before=before, after=payload.model_dump(mode="json"))
    db.commit()
    broadcast({"type": "customers"})
    db.refresh(c)
    return c


@router.delete("/{customer_id}", status_code=204)
def delete_customer(
    customer_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_edit(user)
    # Тренеры удалять клиентов не могут — только ресепшен/менеджер/админ.
    if user.role == UserRole.INSTRUCTOR.value:
        raise HTTPException(403, "Тренеры не могут удалять клиентов. Попроси ресепшен.")
    c = db.get(Customer, customer_id)
    if not c:
        raise HTTPException(404, "Not found")
    db.delete(c)
    audit.log(db, user, AuditAction.DELETE.value, "customer", customer_id,
              summary=f"Удалён клиент {c.name}")
    db.commit()
    broadcast({"type": "customers"})
