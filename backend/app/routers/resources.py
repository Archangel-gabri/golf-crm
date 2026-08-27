from datetime import date
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import get_current_user
from ..models import Resource, Zone, ResourceType, ResourceService
from ..schemas import ResourceOut, ZoneOut, ResourceTypeOut, SlotOut
from ..scheduler import slots_for_day, visible_resources

router = APIRouter(prefix="/resources", tags=["resources"])


@router.get("", response_model=List[ResourceOut])
def list_resources(
    active_only: bool = True,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Resource).order_by(Resource.zone_id, Resource.resource_type_id, Resource.sort_order, Resource.name)
    if active_only:
        q = q.where(Resource.active == True)  # noqa: E712
    return list(db.execute(q).scalars())


@router.get("/visible", response_model=List[ResourceOut])
def list_visible(user=Depends(get_current_user), db: Session = Depends(get_db)):
    return visible_resources(db)


@router.get("/services-map")
def services_map(user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Map resource_id -> list of allowed service_ids (empty list = any service)."""
    rows = db.execute(select(ResourceService.resource_id, ResourceService.service_id)).all()
    m: dict[int, list[int]] = {}
    for rid, sid in rows:
        m.setdefault(rid, []).append(sid)
    return m


@router.get("/zones", response_model=List[ZoneOut])
def list_zones(user=Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(Zone).where(Zone.active == True).order_by(Zone.sort_order, Zone.name)  # noqa: E712
    return list(db.execute(q).scalars())


@router.get("/types", response_model=List[ResourceTypeOut])
def list_types(user=Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.execute(select(ResourceType).order_by(ResourceType.name)).scalars())


@router.get("/{resource_id}/slots", response_model=List[SlotOut])
def get_slots(
    resource_id: int,
    on: date = Query(..., description="YYYY-MM-DD"),
    step_minutes: int = 30,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    r = db.get(Resource, resource_id)
    if not r:
        raise HTTPException(404, "Resource not found")
    return slots_for_day(db, r, on, step_minutes)
