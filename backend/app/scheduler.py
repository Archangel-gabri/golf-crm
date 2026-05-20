"""Resource scheduler — slot generation, conflict detection, visibility by season."""
from __future__ import annotations
from datetime import datetime, date, time, timedelta
from typing import List, Optional, Tuple
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .models import (
    Resource, AvailabilityRule, Blackout, Booking,
)
from .enums import BookingStatus, Season


def current_season(at: Optional[date] = None) -> str:
    at = at or date.today()
    return Season.SUMMER.value if 5 <= at.month <= 9 else Season.WINTER.value


def resource_hours(resource: Resource, on: date) -> Tuple[time, time]:
    season = current_season(on)
    weekday = on.weekday()
    for rule in resource.availability_rules:
        if rule.valid_from and on < rule.valid_from:
            continue
        if rule.valid_to and on > rule.valid_to:
            continue
        if rule.season not in (Season.ALL_YEAR.value, season):
            continue
        if rule.weekday is not None and rule.weekday != weekday:
            continue
        return (time.fromisoformat(rule.open_time), time.fromisoformat(rule.close_time))
    return (time(8, 0), time(22, 0))


def find_conflicts(
    db: Session,
    resource_id: int,
    starts_at: datetime,
    ends_at: datetime,
    exclude_booking_id: Optional[int] = None,
) -> List[Booking]:
    active = (
        BookingStatus.HELD.value,
        BookingStatus.CONFIRMED.value,
        BookingStatus.CHECKED_IN.value,
    )
    q = select(Booking).where(
        Booking.resource_id == resource_id,
        Booking.status.in_(active),
        Booking.starts_at < ends_at,
        Booking.ends_at > starts_at,
    )
    if exclude_booking_id:
        q = q.where(Booking.id != exclude_booking_id)
    return list(db.execute(q).scalars())


def slots_for_day(db: Session, resource: Resource, on: date, step_minutes: int = 30) -> List[dict]:
    open_t, close_t = resource_hours(resource, on)
    day_start = datetime.combine(on, open_t)
    day_end = datetime.combine(on, close_t)

    existing = list(db.execute(
        select(Booking).where(
            Booking.resource_id == resource.id,
            Booking.status.in_([
                BookingStatus.HELD.value,
                BookingStatus.CONFIRMED.value,
                BookingStatus.CHECKED_IN.value,
            ]),
            Booking.starts_at < day_end,
            Booking.ends_at > day_start,
        )
    ).scalars())
    blackouts = list(db.execute(
        select(Blackout).where(
            or_(Blackout.resource_id == resource.id, Blackout.resource_id.is_(None)),
            Blackout.starts_at < day_end,
            Blackout.ends_at > day_start,
        )
    ).scalars())

    slots = []
    cursor = day_start
    while cursor < day_end:
        slot_end = cursor + timedelta(minutes=step_minutes)
        in_blackout = any(b.starts_at < slot_end and b.ends_at > cursor for b in blackouts)
        booking = next((b for b in existing if b.starts_at < slot_end and b.ends_at > cursor), None)
        slots.append({
            "resource_id": resource.id,
            "starts_at": cursor,
            "ends_at": slot_end,
            "state": "blackout" if in_blackout else "booked" if booking else "free",
            "booking_id": booking.id if booking else None,
        })
        cursor = slot_end
    return slots


def visible_resources(db: Session) -> List[Resource]:
    season = current_season()
    # Group by zone, then by type, then by sort_order inside — e.g. all SkyTrak
    # together, then all Trainer slots, then all Столы.
    q = select(Resource).where(
        Resource.active == True,  # noqa: E712
        Resource.season.in_([Season.ALL_YEAR.value, season]),
    ).order_by(Resource.zone_id, Resource.resource_type_id, Resource.sort_order, Resource.name)
    return list(db.execute(q).scalars())
