"""Membership plans CRUD + customer↔plan assignments."""
from datetime import date, datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import get_current_user, require_admin, require_roles
from ..models import MembershipPlan, Membership, User, Customer
from ..enums import AuditAction, UserRole
from ..realtime import broadcast
from .. import audit

router = APIRouter(prefix="/memberships", tags=["memberships"])
require_membership_assigner = require_roles(
    UserRole.ADMIN.value,
    UserRole.MANAGER.value,
    UserRole.STAFF.value,
)


class PlanIn(BaseModel):
    name: str
    tier: int = 1
    price_kopecks: int = 0
    duration_days: int = 90
    discount_percent: int = 0
    priority_booking_days: int = 0
    description: str = ""
    covers_training: bool = False
    max_trainings: int = 0
    covers_all_services: bool = False
    active: bool = True


class PlanOut(PlanIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=List[PlanOut])
def list_plans(user=Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.execute(select(MembershipPlan).order_by(MembershipPlan.tier)).scalars())


class ActiveMembershipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    customer_id: int
    customer_name: str
    customer_phone: Optional[str] = None
    plan_id: int
    plan_name: str
    purchased_at: datetime
    starts_on: date
    ends_on: date
    active: bool
    trainings_used: int = 0
    plan_covers_training: bool = False
    plan_max_trainings: int = 0
    plan_discount_percent: int = 0
    plan_covers_all_services: bool = False


@router.get("/active", response_model=List[ActiveMembershipOut])
def list_active_memberships(
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ..models import Customer as CustomerModel
    today = date.today()
    rows = list(db.execute(
        select(Membership, CustomerModel, MembershipPlan)
        .join(CustomerModel, CustomerModel.id == Membership.customer_id)
        .join(MembershipPlan, MembershipPlan.id == Membership.plan_id)
        .where(Membership.active == True, Membership.ends_on >= today)  # noqa: E712
        .order_by(Membership.ends_on.asc())
    ).all())
    return [
        ActiveMembershipOut(
            id=m.id, customer_id=m.customer_id,
            customer_name=c.name, customer_phone=c.phone,
            plan_id=m.plan_id, plan_name=p.name,
            purchased_at=m.purchased_at,
            starts_on=m.starts_on, ends_on=m.ends_on,
            active=m.active,
            trainings_used=int(m.trainings_used or 0),
            plan_covers_training=bool(p.covers_training),
            plan_max_trainings=int(p.max_trainings or 0),
            plan_discount_percent=int(p.discount_percent or 0),
            plan_covers_all_services=bool(p.covers_all_services),
        )
        for m, c, p in rows
    ]


@router.post("", response_model=PlanOut, status_code=201)
def create_plan(
    payload: PlanIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    p = MembershipPlan(**payload.model_dump())
    db.add(p)
    db.flush()
    audit.log(db, user, AuditAction.CREATE.value, "membership_plan", p.id,
              summary=f"Создан абонемент: {p.name}")
    db.commit()
    broadcast({"type": "memberships"})
    db.refresh(p)
    return p


@router.put("/{pid}", response_model=PlanOut)
def update_plan(
    pid: int,
    payload: PlanIn,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    p = db.get(MembershipPlan, pid)
    if not p:
        raise HTTPException(404, "Not found")
    before = {k: getattr(p, k) for k in payload.model_dump()}
    for k, v in payload.model_dump().items():
        setattr(p, k, v)
    audit.log(db, user, AuditAction.UPDATE.value, "membership_plan", pid,
              summary=f"Обновлён абонемент: {p.name}", before=before,
              after=payload.model_dump())
    db.commit()
    broadcast({"type": "memberships"})
    db.refresh(p)
    return p


@router.delete("/{pid}", status_code=204)
def delete_plan(
    pid: int,
    user: User = Depends(require_admin),
    db: Session = Depends(get_db),
):
    p = db.get(MembershipPlan, pid)
    if not p:
        raise HTTPException(404, "Not found")
    # Any active customer membership referencing this plan blocks hard-delete;
    # instead we soft-deactivate so history stays intact.
    has_refs = db.scalar(
        select(Membership.id).where(Membership.plan_id == pid).limit(1)
    )
    if has_refs:
        p.active = False
        audit.log(db, user, AuditAction.UPDATE.value, "membership_plan", pid,
                  summary=f"Архивирован абонемент {p.name} (есть привязки)")
        db.commit()
        broadcast({"type": "memberships"})
        return
    db.delete(p)
    audit.log(db, user, AuditAction.DELETE.value, "membership_plan", pid,
              summary=f"Удалён абонемент {p.name}")
    db.commit()
    broadcast({"type": "memberships"})


# ── All membership sales (purchase history) ──────────────────────────
class MembershipSaleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    customer_id: int
    customer_name: str
    customer_phone: Optional[str] = None
    plan_id: int
    plan_name: str
    plan_price_kopecks: int = 0
    plan_covers_training: bool = False
    plan_covers_all_services: bool = False
    plan_max_trainings: int = 0
    purchased_at: datetime
    starts_on: date
    ends_on: date
    active: bool
    trainings_used: int = 0


@router.get("/sales", response_model=list[MembershipSaleOut])
def list_membership_sales(
    from_: Optional[date] = None,
    to_: Optional[date] = None,
    customer_id: Optional[int] = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from ..models import Customer as CustomerModel
    q = (
        select(Membership, CustomerModel, MembershipPlan)
        .join(CustomerModel, CustomerModel.id == Membership.customer_id)
        .join(MembershipPlan, MembershipPlan.id == Membership.plan_id)
    )
    if from_:
        q = q.where(Membership.purchased_at >= datetime.combine(from_, datetime.min.time()))
    if to_:
        q = q.where(Membership.purchased_at <= datetime.combine(to_, datetime.max.time()))
    if customer_id:
        q = q.where(Membership.customer_id == customer_id)
    q = q.order_by(Membership.purchased_at.desc())
    rows = list(db.execute(q).all())
    return [
        MembershipSaleOut(
            id=m.id, customer_id=m.customer_id,
            customer_name=c.name, customer_phone=c.phone,
            plan_id=m.plan_id, plan_name=p.name,
            plan_price_kopecks=int(p.price_kopecks or 0),
            plan_covers_training=bool(p.covers_training),
            plan_covers_all_services=bool(p.covers_all_services),
            plan_max_trainings=int(p.max_trainings or 0),
            purchased_at=m.purchased_at,
            starts_on=m.starts_on, ends_on=m.ends_on,
            active=m.active,
            trainings_used=int(m.trainings_used or 0),
        )
        for m, c, p in rows
    ]


# ── Customer ↔ membership assignment ────────────────────────────────
class CustomerMembershipOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    customer_id: int
    plan_id: int
    purchased_at: datetime
    starts_on: date
    ends_on: date
    active: bool
    trainings_used: int = 0
    plan_name: Optional[str] = None
    plan_tier: Optional[int] = None
    plan_discount_percent: Optional[int] = None
    plan_covers_training: Optional[bool] = None
    plan_max_trainings: Optional[int] = None
    plan_covers_all_services: Optional[bool] = None


class CustomerMembershipIn(BaseModel):
    plan_id: int
    starts_on: Optional[date] = None  # defaults to today
    # Admin may override the абонемент's default duration (e.g. "на 30 дней").
    # 0 or None = use plan.duration_days.
    duration_days_override: Optional[int] = None
    active: bool = True


@router.get("/customer/{cid}", response_model=List[CustomerMembershipOut])
def list_customer_memberships(
    cid: int,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = list(db.execute(
        select(Membership).where(Membership.customer_id == cid)
        .order_by(Membership.ends_on.desc())
    ).scalars())
    out = []
    for m in rows:
        out.append(CustomerMembershipOut(
            id=m.id, customer_id=m.customer_id, plan_id=m.plan_id,
            purchased_at=m.purchased_at,
            starts_on=m.starts_on, ends_on=m.ends_on, active=m.active,
            trainings_used=int(m.trainings_used or 0),
            plan_name=m.plan.name if m.plan else None,
            plan_tier=m.plan.tier if m.plan else None,
            plan_discount_percent=m.plan.discount_percent if m.plan else None,
            plan_covers_training=m.plan.covers_training if m.plan else None,
            plan_max_trainings=m.plan.max_trainings if m.plan else None,
            plan_covers_all_services=m.plan.covers_all_services if m.plan else None,
        ))
    return out


@router.post("/customer/{cid}", response_model=CustomerMembershipOut, status_code=201)
def assign_membership(
    cid: int,
    payload: CustomerMembershipIn,
    user: User = Depends(require_membership_assigner),
    db: Session = Depends(get_db),
):
    if not db.get(Customer, cid):
        raise HTTPException(404, "Customer not found")
    plan = db.get(MembershipPlan, payload.plan_id)
    if not plan:
        raise HTTPException(404, "Plan not found")
    start = payload.starts_on or date.today()
    purchased_at = datetime.combine(start, datetime.utcnow().time())
    days = payload.duration_days_override if payload.duration_days_override and payload.duration_days_override > 0 else plan.duration_days
    m = Membership(
        customer_id=cid,
        plan_id=plan.id,
        purchased_at=purchased_at,
        starts_on=start,
        ends_on=start + timedelta(days=days),
        active=payload.active,
    )
    db.add(m)
    db.flush()
    audit.log(db, user, AuditAction.CREATE.value, "membership", m.id,
              summary=f"Клиенту #{cid} выдан тариф {plan.name}")
    db.commit()
    broadcast({"type": "memberships"})
    db.refresh(m)
    return CustomerMembershipOut(
        id=m.id, customer_id=m.customer_id, plan_id=m.plan_id,
        purchased_at=m.purchased_at,
        starts_on=m.starts_on, ends_on=m.ends_on, active=m.active,
        trainings_used=int(m.trainings_used or 0),
        plan_name=plan.name, plan_tier=plan.tier,
        plan_discount_percent=plan.discount_percent,
        plan_covers_training=plan.covers_training,
        plan_max_trainings=plan.max_trainings,
        plan_covers_all_services=plan.covers_all_services,
    )


@router.delete("/customer-membership/{mid}", status_code=204)
def revoke_membership(
    mid: int,
    user: User = Depends(require_membership_assigner),
    db: Session = Depends(get_db),
):
    m = db.get(Membership, mid)
    if not m:
        raise HTTPException(404, "Not found")
    db.delete(m)
    audit.log(db, user, AuditAction.DELETE.value, "membership", mid,
              summary=f"Отозван тариф #{mid}")
    db.commit()
    broadcast({"type": "memberships"})
