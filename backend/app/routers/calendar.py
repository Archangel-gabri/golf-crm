"""Calendar endpoints: event feed for timeline view and drag/drop reschedule."""
from datetime import datetime, timedelta, date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import get_current_user
from ..models import Booking, User
from ..enums import BookingStatus, AuditAction
from ..scheduler import find_conflicts
from .. import audit

router = APIRouter(prefix="/calendar", tags=["calendar"])

STATUS_COLORS = {
    BookingStatus.DRAFT.value:      "#9DADA3",
    BookingStatus.HELD.value:       "#C9A961",
    BookingStatus.CONFIRMED.value:  "#155E3F",
    BookingStatus.CHECKED_IN.value: "#2E9A6A",
    BookingStatus.COMPLETED.value:  "#5D6F64",
    BookingStatus.NO_SHOW.value:    "#C13B3B",
}


class CalendarEvent(BaseModel):
    id: int
    resource_id: Optional[int]
    start: datetime
    end: datetime
    title: str
    color: str
    status: str
    payment_status: str
    total_kopecks: int
    customer_name: Optional[str]
    service_name: Optional[str]
    instructor_name: Optional[str]
    guests: int


class MoveIn(BaseModel):
    starts_at: datetime
    ends_at: datetime
    resource_id: Optional[int] = None


@router.get("/events", response_model=List[CalendarEvent])
def events(
    start: datetime = Query(...),
    end: datetime = Query(...),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        select(Booking).where(
            Booking.starts_at < end,
            Booking.ends_at > start,
            Booking.status != BookingStatus.CANCELLED.value,
        ).order_by(Booking.starts_at)
    ).scalars()
    out = []
    for b in rows:
        title = (b.customer.name if b.customer else "Без клиента")
        if b.service:
            title += f" · {b.service.name}"
        color = STATUS_COLORS.get(b.status, "#155E3F")
        out.append(CalendarEvent(
            id=b.id, resource_id=b.resource_id,
            start=b.starts_at, end=b.ends_at, title=title, color=color,
            status=b.status, payment_status=b.payment_status,
            total_kopecks=b.total_kopecks,
            customer_name=b.customer.name if b.customer else None,
            service_name=b.service.name if b.service else None,
            instructor_name=b.instructor.name if b.instructor else None,
            guests=b.guests,
        ))
    return out


@router.post("/bookings/{bid}/move")
def move_booking(
    bid: int,
    payload: MoveIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    b = db.get(Booking, bid)
    if not b:
        raise HTTPException(404, "Not found")
    new_res = payload.resource_id or b.resource_id
    if new_res is None:
        raise HTTPException(400, "resource_id required")
    conflicts = find_conflicts(db, new_res, payload.starts_at, payload.ends_at, exclude_booking_id=b.id)
    if conflicts:
        raise HTTPException(409, {"message": "Конфликт", "conflicts": [c.id for c in conflicts]})

    before = {
        "resource_id": b.resource_id,
        "starts_at": b.starts_at.isoformat(),
        "ends_at": b.ends_at.isoformat(),
    }
    b.resource_id = new_res
    b.starts_at = payload.starts_at
    b.ends_at = payload.ends_at
    audit.log(db, user, AuditAction.UPDATE.value, "booking", b.id,
              summary="Перенос через календарь", before=before,
              after={
                  "resource_id": b.resource_id,
                  "starts_at": b.starts_at.isoformat(),
                  "ends_at": b.ends_at.isoformat(),
              })
    db.commit()
    return {"ok": True}
