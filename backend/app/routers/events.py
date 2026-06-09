from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..db import get_db
from ..deps import require_admin
from ..enums import AuditAction
from ..models import ClubEvent, User
from ..realtime import broadcast


router = APIRouter(prefix="/events", tags=["events"])

EVENT_CATEGORIES = {
    "tournament",
    "corporate",
    "kids",
    "club",
    "maintenance",
    "holiday",
    "other",
}


class EventIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=160)
    category: str = "other"
    starts_at: datetime
    ends_at: datetime
    all_day: bool = False
    location: str = Field(default="", max_length=160)
    description: str = ""
    capacity: Optional[int] = Field(default=None, ge=0)
    color: str = Field(default="#155E3F", max_length=16)
    active: bool = True

    @field_validator("title", "location", "category", "color", mode="before")
    @classmethod
    def strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value


class EventOut(EventIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    updated_at: datetime
    created_by_id: Optional[int] = None


def _validate_payload(payload: EventIn) -> None:
    if payload.category not in EVENT_CATEGORIES:
        raise HTTPException(400, "Неизвестная категория мероприятия")
    if payload.ends_at <= payload.starts_at:
        raise HTTPException(400, "Окончание мероприятия должно быть позже начала")
    if not payload.color.startswith("#") or len(payload.color) not in (4, 7):
        raise HTTPException(400, "Цвет должен быть HEX-значением")


@router.get("", response_model=List[EventOut])
def list_events(
    from_: Optional[datetime] = Query(None, alias="from"),
    to: Optional[datetime] = None,
    include_inactive: bool = False,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Admin-only events calendar feed."""
    now = datetime.utcnow()
    start = from_ or (now - timedelta(days=30))
    end = to or (now + timedelta(days=365))
    q = (
        select(ClubEvent)
        .where(ClubEvent.ends_at >= start, ClubEvent.starts_at <= end)
        .order_by(ClubEvent.starts_at, ClubEvent.title)
    )
    if not include_inactive:
        q = q.where(ClubEvent.active == True)  # noqa: E712
    return list(db.execute(q).scalars())


@router.post("", response_model=EventOut, status_code=201)
def create_event(
    payload: EventIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _validate_payload(payload)
    event = ClubEvent(**payload.model_dump(), created_by_id=user.id)
    db.add(event)
    db.flush()
    audit.log(
        db, user, AuditAction.CREATE.value, "event", event.id,
        summary=f"Создано мероприятие: {event.title}",
        after=payload.model_dump(mode="json"),
    )
    db.commit()
    broadcast({"type": "events"})
    db.refresh(event)
    return event


@router.put("/{event_id}", response_model=EventOut)
def update_event(
    event_id: int,
    payload: EventIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    _validate_payload(payload)
    event = db.get(ClubEvent, event_id)
    if not event:
        raise HTTPException(404, "Not found")
    before = {
        "title": event.title,
        "category": event.category,
        "starts_at": event.starts_at.isoformat(),
        "ends_at": event.ends_at.isoformat(),
        "active": event.active,
    }
    for key, value in payload.model_dump().items():
        setattr(event, key, value)
    audit.log(
        db, user, AuditAction.UPDATE.value, "event", event.id,
        summary=f"Изменено мероприятие: {event.title}",
        before=before,
        after=payload.model_dump(mode="json"),
    )
    db.commit()
    broadcast({"type": "events"})
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(
    event_id: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    event = db.get(ClubEvent, event_id)
    if not event:
        raise HTTPException(404, "Not found")
    audit.log(
        db, user, AuditAction.DELETE.value, "event", event.id,
        summary=f"Удалено мероприятие: {event.title}",
        before={
            "title": event.title,
            "category": event.category,
            "starts_at": event.starts_at.isoformat(),
            "ends_at": event.ends_at.isoformat(),
        },
    )
    db.delete(event)
    db.commit()
    broadcast({"type": "events"})
