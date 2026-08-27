"""Price calculator: base price + instructor override + coupon discount."""
from __future__ import annotations
from datetime import datetime
from dataclasses import dataclass
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import select

from .models import Service, InstructorServicePrice, Coupon


@dataclass
class PriceBreakdown:
    base_kopecks: int            # service base * guests (or instructor override)
    discount_kopecks: int        # coupon applied
    total_kopecks: int           # max(0, base - discount)
    coupon_code: str = ""
    coupon_valid: bool = False
    coupon_error: str = ""
    instructor_override: bool = False
    notes: list[str] = None

    def to_dict(self):
        return {
            "base_kopecks": self.base_kopecks,
            "discount_kopecks": self.discount_kopecks,
            "total_kopecks": self.total_kopecks,
            "coupon_code": self.coupon_code,
            "coupon_valid": self.coupon_valid,
            "coupon_error": self.coupon_error,
            "instructor_override": self.instructor_override,
            "notes": self.notes or [],
        }


def calculate_price(
    db: Session,
    *,
    service_id: Optional[int],
    instructor_id: Optional[int] = None,
    guests: int = 1,
    duration_min: Optional[int] = None,
    coupon_code: str = "",
    at: Optional[datetime] = None,
) -> PriceBreakdown:
    notes: list[str] = []
    base = 0
    override = False

    if service_id:
        svc = db.get(Service, service_id)
        if not svc:
            return PriceBreakdown(0, 0, 0, coupon_error="Услуга не найдена")
        unit = svc.base_price_kopecks
        if instructor_id:
            row = db.execute(
                select(InstructorServicePrice).where(
                    InstructorServicePrice.instructor_id == instructor_id,
                    InstructorServicePrice.service_id == service_id,
                    InstructorServicePrice.active == True,  # noqa: E712
                )
            ).scalar_one_or_none()
            if row:
                unit = row.price_kopecks
                override = True
                notes.append(f"Применён прайс тренера: {unit // 100} ₽")
        base = unit * max(1, guests)
        # pro-rata duration (if booking ≠ svc.duration_min)
        if duration_min and duration_min != svc.duration_min and svc.duration_min:
            base = int(base * duration_min / svc.duration_min)
            notes.append(f"Пропорция {duration_min}/{svc.duration_min} мин")

    discount = 0
    coupon_valid = False
    coupon_err = ""
    code = (coupon_code or "").strip()
    if code:
        c = db.execute(select(Coupon).where(Coupon.code == code)).scalar_one_or_none()
        today = (at or datetime.utcnow()).date()
        if not c:
            coupon_err = "Промокод не найден"
        elif not c.active:
            coupon_err = "Промокод деактивирован"
        elif c.valid_from and today < c.valid_from:
            coupon_err = f"Активен с {c.valid_from}"
        elif c.valid_to and today > c.valid_to:
            coupon_err = f"Истёк {c.valid_to}"
        elif c.max_uses and c.used_count >= c.max_uses:
            coupon_err = "Исчерпан лимит использований"
        else:
            if c.kind == "percent":
                discount = int(base * c.value / 100)
            else:  # fixed (value in rubles converted to kopecks)
                discount = min(base, c.value * 100)
            coupon_valid = True
            notes.append(f"Промокод {c.code}: -{discount // 100} ₽")

    total = max(0, base - discount)
    return PriceBreakdown(
        base_kopecks=base,
        discount_kopecks=discount,
        total_kopecks=total,
        coupon_code=code,
        coupon_valid=coupon_valid,
        coupon_error=coupon_err,
        instructor_override=override,
        notes=notes,
    )


def consume_coupon(db: Session, code: str):
    if not code:
        return
    c = db.execute(select(Coupon).where(Coupon.code == code)).scalar_one_or_none()
    if c and c.active:
        c.used_count += 1
