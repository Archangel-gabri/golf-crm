"""Coupons / promo codes CRUD."""
from datetime import date
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import get_current_user, require_manager
from ..models import Coupon, User
from ..enums import AuditAction
from .. import audit, pricing

router = APIRouter(prefix="/coupons", tags=["coupons"])


class CouponIn(BaseModel):
    code: str
    kind: str = "percent"   # "percent" | "fixed"
    value: int              # % if percent, ₽ if fixed
    valid_from: Optional[date] = None
    valid_to: Optional[date] = None
    max_uses: int = 0
    max_uses_per_user: int = 0
    stackable: bool = False
    conditions: dict = {}
    active: bool = True


class CouponOut(CouponIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    used_count: int


@router.get("", response_model=List[CouponOut])
def list_coupons(user=Depends(get_current_user), db: Session = Depends(get_db)):
    return list(db.execute(select(Coupon).order_by(Coupon.active.desc(), Coupon.code)).scalars())


@router.post("", response_model=CouponOut, status_code=201)
def create_coupon(
    payload: CouponIn,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    if payload.kind not in {"percent", "fixed"}:
        raise HTTPException(400, "kind must be percent|fixed")
    if payload.kind == "percent" and not (0 < payload.value <= 100):
        raise HTTPException(400, "percent must be 1..100")
    if db.execute(select(Coupon).where(Coupon.code == payload.code)).scalar_one_or_none():
        raise HTTPException(409, "Код уже существует")

    c = Coupon(**payload.model_dump(), used_count=0)
    db.add(c)
    db.flush()
    audit.log(db, user, AuditAction.CREATE.value, "coupon", c.id,
              summary=f"Создан промокод: {c.code}")
    db.commit()
    db.refresh(c)
    return c


@router.put("/{cid}", response_model=CouponOut)
def update_coupon(
    cid: int,
    payload: CouponIn,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    c = db.get(Coupon, cid)
    if not c:
        raise HTTPException(404, "Not found")
    for k, v in payload.model_dump().items():
        setattr(c, k, v)
    audit.log(db, user, AuditAction.UPDATE.value, "coupon", cid,
              summary=f"Обновлён {c.code}")
    db.commit()
    db.refresh(c)
    return c


@router.delete("/{cid}", status_code=204)
def delete_coupon(
    cid: int,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    c = db.get(Coupon, cid)
    if not c:
        raise HTTPException(404, "Not found")
    db.delete(c)
    audit.log(db, user, AuditAction.DELETE.value, "coupon", cid,
              summary=f"Удалён промокод {c.code}")
    db.commit()


class QuoteIn(BaseModel):
    service_id: Optional[int] = None
    instructor_id: Optional[int] = None
    guests: int = 1
    duration_min: Optional[int] = None
    coupon_code: str = ""


@router.post("/quote")
def quote(
    payload: QuoteIn,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Preview price — используется в форме брони для live расчёта."""
    pb = pricing.calculate_price(
        db,
        service_id=payload.service_id,
        instructor_id=payload.instructor_id,
        guests=payload.guests,
        duration_min=payload.duration_min,
        coupon_code=payload.coupon_code,
    )
    return pb.to_dict()
