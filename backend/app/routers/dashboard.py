from datetime import datetime, date
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select, func

from ..db import get_db
from ..deps import get_current_user
from ..models import Booking, Customer, Resource
from ..schemas import DashboardStats, BookingRichOut
from ..enums import BookingStatus, PaymentStatus

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/stats", response_model=DashboardStats)
def stats(user=Depends(get_current_user), db: Session = Depends(get_db)):
    today = date.today()
    day_start = datetime.combine(today, datetime.min.time())
    day_end = datetime.combine(today, datetime.max.time())

    bookings_today = db.scalar(
        select(func.count(Booking.id)).where(
            Booking.starts_at >= day_start, Booking.starts_at <= day_end
        )
    ) or 0

    # Revenue is recognised after «Завершить» AND attributed to the session day
    # (starts_at), не к моменту нажатия.
    revenue_today = db.scalar(
        select(func.coalesce(func.sum(Booking.total_kopecks), 0)).where(
            Booking.starts_at >= day_start,
            Booking.starts_at <= day_end,
            Booking.status == BookingStatus.COMPLETED.value,
        )
    ) or 0

    customers_total = db.scalar(select(func.count(Customer.id))) or 0
    resources_active = db.scalar(
        select(func.count(Resource.id)).where(Resource.active == True)  # noqa: E712
    ) or 0

    now = datetime.now()
    upcoming_stmt = select(Booking).where(
        Booking.starts_at >= now,
        Booking.status.in_([BookingStatus.CONFIRMED.value, BookingStatus.CHECKED_IN.value, BookingStatus.HELD.value]),
    ).order_by(Booking.starts_at).limit(10)
    upcoming = []
    for b in db.execute(upcoming_stmt).scalars():
        upcoming.append(BookingRichOut(
            id=b.id, resource_id=b.resource_id, service_id=b.service_id,
            customer_id=b.customer_id, instructor_id=b.instructor_id,
            starts_at=b.starts_at, ends_at=b.ends_at,
            guests=b.guests, status=b.status, payment_status=b.payment_status,
            price_kopecks=b.price_kopecks, discount_kopecks=b.discount_kopecks,
            total_kopecks=b.total_kopecks, comment=b.comment,
            customer_name=b.customer.name if b.customer else None,
            service_name=b.service.name if b.service else None,
            resource_name=b.resource.name if b.resource else None,
            instructor_name=b.instructor.name if b.instructor else None,
        ))

    return DashboardStats(
        bookings_today=bookings_today,
        revenue_today_kopecks=revenue_today,
        customers_total=customers_total,
        resources_active=resources_active,
        upcoming=upcoming,
    )
