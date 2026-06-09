"""Catalog editing: services, resources, instructors (constructor with many-to-many)."""
from typing import List, Literal, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session
from sqlalchemy import select, delete

from ..db import get_db
from ..deps import get_current_user, require_manager, require_admin
from ..models import (
    Service, Instructor, Resource, Zone, InstructorSpecialization,
    InstructorServicePrice, InstructorResource, ResourceService, Specialization, User,
    Booking, Customer, InstructorCustomer,
)
from ..catalog_sync import ensure_official_price_catalog
from ..official_price import OFFICIAL_SERVICE_SPECS
from ..enums import BookingStatus, AuditAction, ServiceCategory
from .. import audit


router = APIRouter(prefix="/catalog-admin", tags=["catalog-admin"])


# ── Services ─────────────────────────────────────────────────────────
class ServiceIn(BaseModel):
    category: str
    name: str
    sku: str
    duration_min: int = 60
    base_price_kopecks: int
    group_size: Optional[int] = None
    season: str = "all_year"
    is_trial: bool = False
    is_kids: bool = False
    requires_instructor: bool = False
    description: str = ""
    active: bool = True


class ServicePricePreview(BaseModel):
    current_price_kopecks: int
    new_price_kopecks: int
    future_bookings_count: int
    total_impact_kopecks: int


@router.post("/services", response_model=dict, status_code=201)
def create_service(
    payload: ServiceIn,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    if payload.category not in {c.value for c in ServiceCategory}:
        raise HTTPException(400, "Invalid category")
    if db.execute(select(Service).where(Service.sku == payload.sku)).scalar_one_or_none():
        raise HTTPException(409, "SKU already exists")
    svc = Service(**payload.model_dump())
    db.add(svc)
    db.flush()
    audit.log(db, user, AuditAction.CREATE.value, "service", svc.id,
              summary=f"Создана услуга: {svc.name}")
    db.commit()
    return {"id": svc.id}


@router.put("/services/{sid}")
def update_service(
    sid: int,
    payload: ServiceIn,
    apply_to_bookings: bool = False,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    svc = db.get(Service, sid)
    if not svc:
        raise HTTPException(404, "Not found")
    old_price = svc.base_price_kopecks
    for k, v in payload.model_dump().items():
        setattr(svc, k, v)
    audit.log(db, user, AuditAction.UPDATE.value, "service", sid,
              summary=f"Изменена услуга {svc.name}")

    # Cascade: apply new price to future unpaid bookings
    if apply_to_bookings and payload.base_price_kopecks != old_price:
        future = db.execute(
            select(Booking).where(
                Booking.service_id == sid,
                Booking.status.in_([BookingStatus.CONFIRMED.value, BookingStatus.HELD.value]),
                Booking.payment_status != "paid",
            )
        ).scalars().all()
        for b in future:
            b.price_kopecks = payload.base_price_kopecks * max(1, b.guests)
            b.total_kopecks = max(0, b.price_kopecks - b.discount_kopecks)
        if future:
            audit.log(db, user, AuditAction.UPDATE.value, "service", sid,
                      summary=f"Каскад цены на {len(future)} броней")

    db.commit()
    return {"ok": True}


@router.post("/services/{sid}/toggle")
def toggle_service(
    sid: int,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    svc = db.get(Service, sid)
    if not svc:
        raise HTTPException(404, "Not found")
    svc.active = not svc.active
    audit.log(db, user, AuditAction.UPDATE.value, "service", sid,
              summary=f'{"Активирована" if svc.active else "Выключена"} услуга: {svc.name}')
    db.commit()
    return {"active": svc.active}


@router.get("/services/{sid}/cascade-preview", response_model=ServicePricePreview)
def cascade_preview(
    sid: int,
    new_price_kopecks: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    svc = db.get(Service, sid)
    if not svc:
        raise HTTPException(404, "Not found")
    future = db.execute(
        select(Booking).where(
            Booking.service_id == sid,
            Booking.status.in_([BookingStatus.CONFIRMED.value, BookingStatus.HELD.value]),
            Booking.payment_status != "paid",
        )
    ).scalars().all()
    delta_total = sum(
        (new_price_kopecks - svc.base_price_kopecks) * max(1, b.guests)
        for b in future
    )
    return ServicePricePreview(
        current_price_kopecks=svc.base_price_kopecks,
        new_price_kopecks=new_price_kopecks,
        future_bookings_count=len(future),
        total_impact_kopecks=delta_total,
    )


# ── Instructor constructor ───────────────────────────────────────────
class InstructorIn(BaseModel):
    name: str
    trainer_type: Literal["club", "external"] = "club"
    phone: str = ""
    email: str = ""
    bio: str = ""
    color: str = "#C9A961"
    specialization: str = ""
    working_hours: dict = Field(default_factory=dict)
    active: bool = True


class InstructorFull(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    trainer_type: str = "club"
    phone: str
    email: str
    bio: str
    color: str
    specialization: str
    working_hours: dict
    active: bool
    specialization_ids: List[int] = []
    resource_ids: List[int] = []
    service_prices: dict[int, int] = Field(default_factory=dict)


@router.get("/instructors/{iid}", response_model=InstructorFull)
def get_instructor(iid: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    i = db.get(Instructor, iid)
    if not i:
        raise HTTPException(404, "Not found")
    spec_ids = [sp.id for sp in i.specializations]
    resource_ids = [r.resource_id for r in db.execute(
        select(InstructorResource).where(InstructorResource.instructor_id == iid)
    ).scalars()]
    price_rows = db.execute(
        select(InstructorServicePrice).where(InstructorServicePrice.instructor_id == iid)
    ).scalars()
    prices = {p.service_id: p.price_kopecks for p in price_rows}
    return InstructorFull(
        id=i.id, name=i.name, trainer_type=i.trainer_type, phone=i.phone, email=i.email, bio=i.bio,
        color=i.color, specialization=i.specialization,
        working_hours=i.working_hours or {}, active=i.active,
        specialization_ids=spec_ids, resource_ids=resource_ids,
        service_prices=prices,
    )


@router.post("/instructors", response_model=dict, status_code=201)
def create_instructor(
    payload: InstructorIn,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    i = Instructor(**payload.model_dump())
    db.add(i)
    db.flush()
    audit.log(db, user, AuditAction.CREATE.value, "instructor", i.id,
              summary=f"Добавлен тренер: {i.name}")
    db.commit()
    return {"id": i.id}


class InstructorAssignments(BaseModel):
    specialization_ids: List[int] = []
    resource_ids: List[int] = []


@router.put("/instructors/{iid}")
def update_instructor(
    iid: int,
    payload: InstructorIn,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    i = db.get(Instructor, iid)
    if not i:
        raise HTTPException(404, "Not found")
    for k, v in payload.model_dump().items():
        setattr(i, k, v)
    audit.log(db, user, AuditAction.UPDATE.value, "instructor", iid,
              summary=f"Обновлён тренер: {i.name}")
    db.commit()
    return {"ok": True}


@router.delete("/instructors/{iid}", status_code=204)
def delete_instructor(
    iid: int,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    i = db.get(Instructor, iid)
    if not i:
        raise HTTPException(404, "Not found")
    name = i.name
    # Detach the trainer from any historic bookings so FK doesn't block the delete.
    db.execute(
        Booking.__table__.update()
        .where(Booking.instructor_id == iid)
        .values(instructor_id=None)
    )
    # Clear all link tables explicitly (cascade already covers these but be explicit).
    db.execute(delete(InstructorSpecialization).where(InstructorSpecialization.instructor_id == iid))
    db.execute(delete(InstructorResource).where(InstructorResource.instructor_id == iid))
    db.execute(delete(InstructorServicePrice).where(InstructorServicePrice.instructor_id == iid))
    db.delete(i)
    audit.log(db, user, AuditAction.DELETE.value, "instructor", iid,
              summary=f"Удалён тренер: {name}")
    db.commit()


class InstructorPricePatch(BaseModel):
    service_id: int
    price_kopecks: int  # 0 = remove override


@router.post("/instructors/{iid}/service-price")
def set_instructor_price(
    iid: int,
    payload: InstructorPricePatch,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    if not db.get(Instructor, iid):
        raise HTTPException(404, "Instructor not found")
    existing = db.execute(
        select(InstructorServicePrice).where(
            InstructorServicePrice.instructor_id == iid,
            InstructorServicePrice.service_id == payload.service_id,
        )
    ).scalar_one_or_none()
    if payload.price_kopecks == 0:
        if existing:
            db.delete(existing)
    else:
        if existing:
            existing.price_kopecks = payload.price_kopecks
        else:
            db.add(InstructorServicePrice(
                instructor_id=iid,
                service_id=payload.service_id,
                price_kopecks=payload.price_kopecks,
            ))
    db.commit()
    return {"ok": True}


# ── Resource editor ──────────────────────────────────────────────────
class ResourceIn(BaseModel):
    name: str
    code: str
    capacity: int = 1
    season: str = "all_year"
    color: str = ""
    active: bool = True
    service_ids: List[int] = []


@router.put("/resources/{rid}")
def update_resource(
    rid: int,
    payload: ResourceIn,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    r = db.get(Resource, rid)
    if not r:
        raise HTTPException(404, "Not found")
    r.name = payload.name
    r.code = payload.code
    r.capacity = payload.capacity
    r.season = payload.season
    r.color = payload.color
    r.active = payload.active

    db.execute(delete(ResourceService).where(ResourceService.resource_id == rid))
    for sid in payload.service_ids:
        db.add(ResourceService(resource_id=rid, service_id=sid))

    audit.log(db, user, AuditAction.UPDATE.value, "resource", rid,
              summary=f"Обновлён ресурс: {r.name}")
    db.commit()
    return {"ok": True}


class ResourceFull(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    zone_id: int
    name: str
    code: str
    capacity: int
    season: str
    color: str
    active: bool
    service_ids: List[int] = []


@router.get("/resources/{rid}", response_model=ResourceFull)
def get_resource(rid: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    r = db.get(Resource, rid)
    if not r:
        raise HTTPException(404, "Not found")
    service_ids = [row.service_id for row in db.execute(
        select(ResourceService).where(ResourceService.resource_id == rid)
    ).scalars()]
    return ResourceFull(
        id=r.id, zone_id=r.zone_id, name=r.name, code=r.code, capacity=r.capacity,
        season=r.season, color=r.color, active=r.active, service_ids=service_ids,
    )


@router.post("/reset-services-from-price")
def reset_services_from_price(
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Synchronize services/plans from the official golfmsk.com price list."""
    stats = ensure_official_price_catalog(
        db,
        force=True,
        archive_non_official=False,
    )

    audit.log(db, user, AuditAction.UPDATE.value, "services", None,
              summary=(
                  "Синхронизация каталога по golfmsk.com/price: "
                  f"создано {stats['created']}, обновлено {stats['updated']}, "
                  f"архивировано {stats['archived']}"
              ))
    db.commit()
    return {
        "total": len(OFFICIAL_SERVICE_SPECS),
        "created": stats["created"],
        "updated": stats["updated"],
        "archived": stats["archived"],
    }


# ── Instructor ↔ Customer M2M ─────────────────────────────────────────────────

class CustomerBrief(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    phone: str = ""
    email: str = ""
    notes: str = ""


@router.get("/instructors/{iid}/customers", response_model=List[CustomerBrief])
def list_instructor_customers(
    iid: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Trainers can only view their own client list; managers/admins see any."""
    from ..enums import UserRole
    if user.role == UserRole.INSTRUCTOR.value:
        if user.instructor_id != iid:
            raise HTTPException(403, "Доступ запрещён")
    rows = db.execute(
        select(Customer)
        .join(InstructorCustomer, InstructorCustomer.customer_id == Customer.id)
        .where(InstructorCustomer.instructor_id == iid)
        .order_by(Customer.name)
    ).scalars().all()
    return [CustomerBrief.model_validate(c) for c in rows]


@router.post("/instructors/{iid}/customers/{customer_id}", response_model=dict)
def link_instructor_customer(
    iid: int,
    customer_id: int,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    if not db.get(Instructor, iid):
        raise HTTPException(404, "Тренер не найден")
    if not db.get(Customer, customer_id):
        raise HTTPException(404, "Клиент не найден")
    existing = db.execute(
        select(InstructorCustomer).where(
            InstructorCustomer.instructor_id == iid,
            InstructorCustomer.customer_id == customer_id,
        )
    ).scalar_one_or_none()
    if not existing:
        db.add(InstructorCustomer(instructor_id=iid, customer_id=customer_id))
        db.commit()
    return {"ok": True}


@router.delete("/instructors/{iid}/customers/{customer_id}", response_model=dict)
def unlink_instructor_customer(
    iid: int,
    customer_id: int,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    db.execute(
        delete(InstructorCustomer).where(
            InstructorCustomer.instructor_id == iid,
            InstructorCustomer.customer_id == customer_id,
        )
    )
    db.commit()
    return {"ok": True}
