"""Scenario-based booking resolver.

Translates admin-facing scenario input (category / guests / training type /
trainer / time) into internal service+resource+price payload and validates
capacity + trainer conflicts.

The price tables here are the SINGLE SOURCE OF TRUTH for scenario bookings.
Frontend only shows what this module computes.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .enums import BookingStatus
from .models import Booking, BookingItem, Resource, Service, Instructor, Coupon, Membership, MembershipPlan
from .official_price import (
    ACADEMIC_HOLE_CODES,
    COURSE_RESOURCE_CODES as OFFICIAL_COURSE_RESOURCE_CODES,
    RANGE_RESOURCE_CODES as OFFICIAL_RANGE_RESOURCE_CODES,
)


# ─────────────────────────── tariff tables ─────────────────────────────

BookingCategory = Literal[
    "range",
    "range_weekday_basket",
    "range_weekend_hour",
    "hole_19_20",
    "course_9",
    "course_9_weekday",
    "course_9_weekend",
    "course_9_mon_tue",
    "course_18",
    "course_18_weekday",
    "course_18_weekend",
    "course_18_mon_tue",
]

TrainingType = Literal["trial", "regular", "kids"]

CATEGORY_CATALOG: dict[str, dict] = {
    "range_weekday_basket": {
        "sku": "driving-basket-40-weekday",
        "title": "Драйвинг-рэндж · будни",
        "short": "Range (будни)",
        "detail": "Стоимость зависит от количества гостей; помосты нужны только для занятости",
        "base_price_kopecks": 150000,
        "duration_min": 60,
        "resource_pool": "range",
        "pool_capacity": 24,
        "basket_unit": True,
        "basket_unit_label": "помост",
        "per_guest": True,
    },
    "range_weekend_hour": {
        "sku": "driving-1h-weekend",
        "title": "Драйвинг-рэндж · выходные",
        "short": "Range (выходные)",
        "detail": "Стоимость зависит от количества гостей; помосты нужны только для занятости",
        "base_price_kopecks": 300000,
        "duration_min": 60,
        "resource_pool": "range",
        "pool_capacity": 24,
        "basket_unit": True,
        "basket_unit_label": "помост",
        "per_guest": True,
    },
    "hole_19_20": {
        "sku": "academic-holes-19-20",
        "title": "Лунка 19, 20",
        "short": "Лунка 19, 20",
        "detail": "Академические лунки",
        "base_price_kopecks": 200000,
        "duration_min": 60,
        "resource_pool": "hole_19_20",
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
    "course_9_weekday": {
        "sku": "course-9-weekday",
        "title": "Игра на 9 лунок · будни",
        "short": "9 лунок (будни)",
        "detail": "Основное поле",
        "base_price_kopecks": 500000,
        "duration_min": 180,
        "resource_pool": "course",
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
    "course_9_weekend": {
        "sku": "course-9-weekend",
        "title": "Игра на 9 лунок · выходные",
        "short": "9 лунок (выходные)",
        "detail": "Основное поле",
        "base_price_kopecks": 700000,
        "duration_min": 180,
        "resource_pool": "course",
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
    "course_9_mon_tue": {
        "sku": "course-9-mon-tue",
        "title": "Игра на 9 лунок · понедельник/вторник",
        "short": "9 лунок (Пн/Вт)",
        "detail": "Специальный тариф",
        "base_price_kopecks": 400000,
        "duration_min": 180,
        "resource_pool": "course",
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
    "course_18_weekday": {
        "sku": "course-18-weekday",
        "title": "Игра на 18 лунок · будни",
        "short": "18 лунок (будни)",
        "detail": "Основное поле",
        "base_price_kopecks": 700000,
        "duration_min": 300,
        "resource_pool": "course",
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
    "course_18_weekend": {
        "sku": "course-18-weekend",
        "title": "Игра на 18 лунок · выходные",
        "short": "18 лунок (выходные)",
        "detail": "Основное поле",
        "base_price_kopecks": 900000,
        "duration_min": 300,
        "resource_pool": "course",
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
    "course_18_mon_tue": {
        "sku": "course-18-mon-tue",
        "title": "Игра на 18 лунок · понедельник/вторник",
        "short": "18 лунок (Пн/Вт)",
        "detail": "Специальный тариф",
        "base_price_kopecks": 600000,
        "duration_min": 300,
        "resource_pool": "course",
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
}

PUBLIC_CATEGORY_CATALOG: dict[str, dict] = {
    "range": {
        "title": "Драйвинг-рэндж",
        "short": "Range",
        "detail": "Цена × гости, помосты только для занятости",
        "base_price_kopecks": 150000,
        "duration_min": 60,
        "pool_capacity": 24,
        "basket_unit": True,
        "basket_unit_label": "помост",
        "per_guest": True,
    },
    "hole_19_20": {
        "title": "Лунка 19, 20",
        "short": "Лунка 19, 20",
        "detail": "Академические лунки",
        "base_price_kopecks": 200000,
        "duration_min": 60,
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
    "course_9": {
        "title": "Игра на 9 лунок",
        "short": "9 лунок",
        "detail": "Цена × гости, тариф выбирается по дате",
        "base_price_kopecks": 400000,
        "duration_min": 180,
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
    "course_18": {
        "title": "Игра на 18 лунок",
        "short": "18 лунок",
        "detail": "Цена × гости, тариф выбирается по дате",
        "base_price_kopecks": 600000,
        "duration_min": 300,
        "pool_capacity": 1,
        "basket_unit": False,
        "basket_unit_label": "",
        "per_guest": True,
    },
}


# Training matrix: (type, guests) -> (sku, price_kopecks).
# Values are exact, NOT a unit × guests formula (per spec).
TRAINING_MATRIX: dict[tuple[str, int], tuple[str, int]] = {
    ("trial", 1): ("trial-lesson-1", 700000),
    ("trial", 2): ("trial-lesson-2", 1000000),
    ("trial", 3): ("trial-lesson-3", 1200000),
    ("trial", 4): ("trial-lesson-4", 1400000),
    ("regular", 1): ("lesson-1", 1000000),
    ("regular", 2): ("lesson-2", 1400000),
    ("regular", 3): ("lesson-3", 1800000),
    ("regular", 4): ("lesson-4", 2100000),
    ("kids", 1): ("kids-lesson-1", 700000),
    ("kids", 2): ("kids-lesson-2", 1000000),
    ("kids", 3): ("kids-lesson-3", 1200000),
    ("kids", 4): ("kids-lesson-4", 1400000),
}

TRAINING_TYPE_LABELS = {
    "trial": "Пробная тренировка",
    "regular": "Обычная тренировка",
    "kids": "Детская тренировка",
}

# SKU codes used as markers for resource pools in the Resource catalog.
RANGE_RESOURCE_CODES = set(OFFICIAL_RANGE_RESOURCE_CODES)
HOLE_19_20_CODES = set(ACADEMIC_HOLE_CODES)
COURSE_RESOURCE_CODES = set(OFFICIAL_COURSE_RESOURCE_CODES)
CLUB_RENTAL_KOPECKS = 50000
BALL_BASKET_KOPECKS = 150000

EQUIPMENT_SPECS = {
    "addon_clubs": ("rental-club", "Клюшка", CLUB_RENTAL_KOPECKS),
    "addon_ball_baskets": ("driving-basket-40-weekday", "Корзина мячей", BALL_BASKET_KOPECKS),
    "addon_trolleys": ("rental-trolley", "Тележка", 100000),
    "addon_bags": ("rental-bag", "Бэг", 250000),
    "addon_golf_carts": ("rental-golf-cart", "Гольф-кар", 1000000),
}


# ─────────────────────────── DTOs ─────────────────────────────


@dataclass
class ScenarioInput:
    category: str
    guests: int
    has_training: bool
    training_type: Optional[str]
    trainer_id: Optional[int]
    starts_at: datetime
    ends_at: datetime
    customer_id: Optional[int]
    comment: str
    exclude_booking_id: Optional[int] = None
    # For unit-billed categories. Range uses this as platform count (помосты).
    # Kept as `baskets` for backwards-compatible API payloads.
    baskets: int = 1
    addon_clubs: int = 0
    addon_ball_baskets: int = 0
    addon_trolleys: int = 0
    addon_bags: int = 0
    addon_golf_carts: int = 0
    # Optional promocode (Coupon.code). Applied after base+training sum.
    coupon_code: str = ""
    # Optional active membership id (Membership.id). Applies plan.discount_percent
    # to the booking subtotal before coupon (coupon stacks on top).
    membership_id: Optional[int] = None
    # If this membership was sold inside the booking wizard, include the plan
    # price in this booking's total as a separate line item.
    membership_purchase_id: Optional[int] = None


@dataclass
class Availability:
    ok: bool
    message: str


@dataclass
class ResolvedScenario:
    ok: bool
    errors: list[str]
    warnings: list[str]

    # price
    base_price_kopecks: int
    equipment_price_kopecks: int
    equipment_label: str
    training_price_kopecks: int
    total_kopecks: int

    # labels for UI
    category_title: str
    category_short: str
    category_detail: str
    training_label: str
    trainer_name: str

    # capacity/availability statuses
    resource_availability: Availability
    trainer_availability: Availability

    # resolved ids (null when validation failed at that step)
    base_service_id: Optional[int]
    training_service_id: Optional[int]
    resource_id: Optional[int]
    duration_min: int

    # unit-count support (`baskets` is kept for API compatibility)
    basket_unit: bool = False
    basket_unit_label: str = ""
    baskets: int = 1
    basket_unit_price_kopecks: int = 0
    per_guest: bool = False
    equipment_items: list[dict] = field(default_factory=list)

    # discount layer (promocode + membership)
    subtotal_kopecks: int = 0          # base + training, before any discount
    membership_discount_kopecks: int = 0
    membership_purchase_price_kopecks: int = 0
    membership_purchase_label: str = ""
    membership_training_covered: bool = False
    coupon_discount_kopecks: int = 0
    discount_kopecks: int = 0
    coupon_code: str = ""              # validated code (empty if invalid/missing)
    coupon_label: str = ""             # e.g. "SUMMER10 (−10%)"
    coupon_error: str = ""
    membership_label: str = ""         # e.g. "Gold (−15%)"

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "errors": list(self.errors),
            "warnings": list(self.warnings),
            "base_price_kopecks": self.base_price_kopecks,
            "equipment_price_kopecks": self.equipment_price_kopecks,
            "equipment_label": self.equipment_label,
            "equipment_items": list(self.equipment_items),
            "training_price_kopecks": self.training_price_kopecks,
            "total_kopecks": self.total_kopecks,
            "category_title": self.category_title,
            "category_short": self.category_short,
            "category_detail": self.category_detail,
            "training_label": self.training_label,
            "trainer_name": self.trainer_name,
            "resource_availability": {
                "ok": self.resource_availability.ok,
                "message": self.resource_availability.message,
            },
            "trainer_availability": {
                "ok": self.trainer_availability.ok,
                "message": self.trainer_availability.message,
            },
            "base_service_id": self.base_service_id,
            "training_service_id": self.training_service_id,
            "resource_id": self.resource_id,
            "duration_min": self.duration_min,
            "basket_unit": self.basket_unit,
            "basket_unit_label": self.basket_unit_label,
            "baskets": self.baskets,
            "basket_unit_price_kopecks": self.basket_unit_price_kopecks,
            "subtotal_kopecks": self.subtotal_kopecks,
            "membership_discount_kopecks": self.membership_discount_kopecks,
            "membership_purchase_price_kopecks": self.membership_purchase_price_kopecks,
            "membership_purchase_label": self.membership_purchase_label,
            "membership_training_covered": self.membership_training_covered,
            "coupon_discount_kopecks": self.coupon_discount_kopecks,
            "discount_kopecks": self.discount_kopecks,
            "coupon_code": self.coupon_code,
            "coupon_label": self.coupon_label,
            "coupon_error": self.coupon_error,
            "membership_label": self.membership_label,
            "per_guest": self.per_guest,
        }


# ─────────────────────────── core resolver ─────────────────────────────


_ACTIVE_STATUSES = (
    BookingStatus.CONFIRMED.value,
    BookingStatus.CHECKED_IN.value,
    BookingStatus.COMPLETED.value,
)


def _fetch_service_by_sku(db: Session, sku: str) -> Optional[Service]:
    return db.execute(select(Service).where(Service.sku == sku)).scalar_one_or_none()


_WEEKDAY_RU = ["понедельник", "вторник", "среду", "четверг", "пятницу", "субботу", "воскресенье"]


def _ru_platform_word(n: int) -> str:
    abs_n = abs(int(n)) % 100
    last = abs_n % 10
    if 10 < abs_n < 20:
        return "помостов"
    if last == 1:
        return "помост"
    if 2 <= last <= 4:
        return "помоста"
    return "помостов"


def _default_working_hours() -> dict:
    return {
        str(d): (
            {"enabled": True, "start": "10:00", "end": "20:00"}
            if d < 5
            else {"enabled": False, "start": "10:00", "end": "18:00"}
        )
        for d in range(7)
    }


def _normalize_working_hours(raw: dict) -> dict:
    if not raw:
        return _default_working_hours()
    out: dict = {}
    for d in range(7):
        key = str(d)
        src = raw.get(key) or raw.get(d) or {}
        out[key] = src if isinstance(src, dict) and src else {"enabled": False, "start": "10:00", "end": "18:00"}
    return out


def _effective_working_hours(inst: Instructor, on: date) -> dict:
    pending = getattr(inst, "pending_working_hours", None)
    eff_from = getattr(inst, "pending_effective_from", None)
    if pending and eff_from and on >= eff_from:
        return _normalize_working_hours(pending or {})
    return _normalize_working_hours(inst.working_hours or {})


def trainer_schedule_error(inst: Instructor, starts_at: datetime, ends_at: datetime) -> Optional[str]:
    """Return a human error if the booking is outside the trainer working hours."""
    wh = _effective_working_hours(inst, starts_at.date())
    if not wh:
        return None
    weekday = starts_at.weekday()
    day = wh.get(str(weekday)) or {}
    if not day:
        return None
    if not day.get("enabled", False):
        return f"Тренер {inst.name} не работает в {_WEEKDAY_RU[weekday]} — день отмечен как выходной."
    try:
        sh, sm = map(int, str(day.get("start", "")).split(":"))
        eh, em = map(int, str(day.get("end", "")).split(":"))
    except Exception:
        return None
    work_start = sh * 60 + sm
    work_end = eh * 60 + em
    b_start = starts_at.hour * 60 + starts_at.minute
    b_end = ends_at.hour * 60 + ends_at.minute
    if b_start < work_start or b_end > work_end:
        return (
            f"Тренер {inst.name} в {_WEEKDAY_RU[weekday]} доступен только "
            f"{day.get('start')}–{day.get('end')}."
        )
    return None


def _resolve_category_code(category: str, starts_at: datetime) -> str:
    """Map compact UI categories to the exact tariff SKU category by booking date."""
    weekday = starts_at.weekday()  # 0=Monday .. 6=Sunday
    is_weekend = weekday >= 5
    is_mon_tue = weekday in (0, 1)

    if category == "range":
        return "range_weekend_hour" if is_weekend else "range_weekday_basket"
    if category == "course_9":
        if is_mon_tue:
            return "course_9_mon_tue"
        return "course_9_weekend" if is_weekend else "course_9_weekday"
    if category == "course_18":
        if is_mon_tue:
            return "course_18_mon_tue"
        return "course_18_weekend" if is_weekend else "course_18_weekday"
    return category


def _overlapping_bookings_on_resources(
    db: Session, resource_ids: list[int], starts_at: datetime, ends_at: datetime,
    exclude_id: Optional[int] = None,
) -> list[Booking]:
    if not resource_ids:
        return []
    q = select(Booking).where(
        Booking.resource_id.in_(resource_ids),
        Booking.status.in_(_ACTIVE_STATUSES),
        Booking.starts_at < ends_at,
        Booking.ends_at > starts_at,
    )
    if exclude_id:
        q = q.where(Booking.id != exclude_id)
    return list(db.execute(q).scalars())


def _overlapping_bookings_for_trainer(
    db: Session, trainer_id: int, starts_at: datetime, ends_at: datetime,
    exclude_id: Optional[int] = None,
) -> list[Booking]:
    q = select(Booking).where(
        Booking.instructor_id == trainer_id,
        Booking.status.in_(_ACTIVE_STATUSES),
        Booking.starts_at < ends_at,
        Booking.ends_at > starts_at,
    )
    if exclude_id:
        q = q.where(Booking.id != exclude_id)
    return list(db.execute(q).scalars())


TRIAL_SERVICE_SKUS = {sku for (kind, _guests), (sku, _price) in TRAINING_MATRIX.items() if kind == "trial"}
RANGE_SERVICE_SKUS = {
    meta["sku"]
    for meta in CATEGORY_CATALOG.values()
    if meta.get("resource_pool") == "range"
}


def _customer_used_trial(db: Session, customer_id: Optional[int], exclude_id: Optional[int] = None) -> bool:
    """Whether this customer already has a non-cancelled trial lesson booking."""
    if not customer_id:
        return False
    item_q = (
        select(Booking.id)
        .join(BookingItem, BookingItem.booking_id == Booking.id)
        .join(Service, Service.id == BookingItem.service_id)
        .where(
            Booking.customer_id == customer_id,
            Booking.status.in_(_ACTIVE_STATUSES),
            Service.sku.in_(list(TRIAL_SERVICE_SKUS)),
        )
        .limit(1)
    )
    base_q = (
        select(Booking.id)
        .join(Service, Service.id == Booking.service_id)
        .where(
            Booking.customer_id == customer_id,
            Booking.status.in_(_ACTIVE_STATUSES),
            Service.sku.in_(list(TRIAL_SERVICE_SKUS)),
        )
        .limit(1)
    )
    if exclude_id:
        item_q = item_q.where(Booking.id != exclude_id)
        base_q = base_q.where(Booking.id != exclude_id)
    return db.execute(item_q).first() is not None or db.execute(base_q).first() is not None


def _range_units_by_booking(db: Session, booking_ids: list[int]) -> dict[int, int]:
    """Return occupied driving-range platforms per booking.

    New scenario bookings store the platform count as the base line-item quantity.
    Older/manual bookings may not have that line, so they conservatively consume
    one platform.
    """
    if not booking_ids:
        return {}
    rows = db.execute(
        select(BookingItem.booking_id, BookingItem.quantity)
        .join(Service, Service.id == BookingItem.service_id)
        .where(
            BookingItem.booking_id.in_(booking_ids),
            Service.sku.in_(list(RANGE_SERVICE_SKUS)),
        )
    ).all()
    out = {bid: 0 for bid in booking_ids}
    for bid, qty in rows:
        out[int(bid)] = out.get(int(bid), 0) + max(1, int(qty or 1))
    for bid in booking_ids:
        if out.get(bid, 0) <= 0:
            out[bid] = 1
    return out


def _pool_resource_ids(db: Session, pool_codes: set[str]) -> list[Resource]:
    rows = db.execute(
        select(Resource).where(Resource.code.in_(list(pool_codes)), Resource.active == True)  # noqa: E712
    ).scalars()
    return list(rows)


def resolve_scenario(db: Session, inp: ScenarioInput) -> ResolvedScenario:
    errors: list[str] = []
    warnings: list[str] = []

    resolved_category = _resolve_category_code(inp.category, inp.starts_at)
    cat_meta = CATEGORY_CATALOG.get(resolved_category)
    if not cat_meta:
        return ResolvedScenario(
            ok=False, errors=[f"Неизвестная категория: {inp.category}"], warnings=[],
            base_price_kopecks=0, equipment_price_kopecks=0, equipment_label="",
            training_price_kopecks=0, total_kopecks=0,
            category_title="", category_short="", category_detail="",
            training_label="", trainer_name="",
            resource_availability=Availability(False, ""),
            trainer_availability=Availability(True, ""),
            base_service_id=None, training_service_id=None,
            resource_id=None, duration_min=60,
        )

    # ── basic input validation
    if inp.guests < 1:
        errors.append("Количество гостей должно быть не меньше 1.")

    if inp.ends_at <= inp.starts_at:
        errors.append("Время окончания должно быть позже времени начала.")

    # Club is 24/7 — only constrain bookings to one calendar day so each entry
    # belongs to exactly one date for reporting/analytics.
    if inp.starts_at.date() != inp.ends_at.date():
        errors.append("Бронь должна быть в пределах одного дня.")

    if cat_meta["resource_pool"] in ("hole_19_20", "course") and inp.guests > 4:
        errors.append("Для этой категории максимум 4 гостя в одной брони.")

    requested_range_units = max(1, int(inp.baskets or 1))
    range_units_exceed_limit = (
        cat_meta["resource_pool"] == "range"
        and requested_range_units > cat_meta["pool_capacity"]
    )
    # Range capacity per-booking: limit to pool_capacity platforms, not guests.
    if range_units_exceed_limit:
        errors.append(
            f"Максимум {cat_meta['pool_capacity']} {_ru_platform_word(cat_meta['pool_capacity'])} в одной брони Range."
        )

    # Training block validation
    training_label = ""
    training_sku = None
    training_price_kopecks = 0
    training_service_id = None
    trainer_name = ""
    trainer_schedule_msg = ""

    if inp.has_training:
        if not inp.training_type:
            errors.append("Для тренировки выберите тип тренировки.")
        elif inp.training_type not in ("trial", "regular", "kids"):
            errors.append("Неизвестный тип тренировки.")
        else:
            key = (inp.training_type, inp.guests)
            if key not in TRAINING_MATRIX:
                errors.append(
                    f"Тренировочный тариф не задан для {inp.guests} "
                    f"{'ребёнка' if inp.training_type == 'kids' else 'гостей'}."
                    " Поддерживаются 1–4."
                )
            else:
                training_sku, training_price_kopecks = TRAINING_MATRIX[key]
                training_label = (
                    f"{TRAINING_TYPE_LABELS[inp.training_type]} "
                    f"({inp.guests} {'ребёнка' if inp.training_type == 'kids' else 'гостя'})"
                )
                if inp.training_type == "trial" and _customer_used_trial(
                    db, inp.customer_id, inp.exclude_booking_id
                ):
                    errors.append("Пробная тренировка уже использовалась этим клиентом.")

        if not inp.trainer_id:
            errors.append("Для тренировки обязательно выберите тренера.")
        else:
            trainer = db.get(Instructor, inp.trainer_id)
            if not trainer or not trainer.active:
                errors.append("Выбранный тренер недоступен.")
            else:
                trainer_name = trainer.name
                trainer_schedule_msg = trainer_schedule_error(trainer, inp.starts_at, inp.ends_at) or ""

    # ── resolve base service id (needed even on validation failure, for UI)
    base_service = _fetch_service_by_sku(db, cat_meta["sku"])
    base_service_id = base_service.id if base_service else None
    if base_service is None:
        errors.append(f"В каталоге отсутствует услуга {cat_meta['sku']}. Запустите seed.")

    # ── resource picking + capacity check
    resource_id: Optional[int] = None
    resource_availability = Availability(True, "")

    if cat_meta["resource_pool"] == "range":
        pool_codes = RANGE_RESOURCE_CODES
    elif cat_meta["resource_pool"] == "course":
        pool_codes = COURSE_RESOURCE_CODES
    else:
        pool_codes = HOLE_19_20_CODES
    pool_resources = _pool_resource_ids(db, pool_codes)
    pool_ids = [r.id for r in pool_resources]
    if not pool_ids:
        errors.append("Площадка не найдена в каталоге ресурсов.")
        resource_availability = Availability(False, "Нет ресурсов для этой категории")
    else:
        overlap = _overlapping_bookings_on_resources(
            db, pool_ids, inp.starts_at, inp.ends_at, inp.exclude_booking_id
        )
        if cat_meta["resource_pool"] == "range":
            used_by_booking = _range_units_by_booking(db, [b.id for b in overlap])
            used_units = sum(used_by_booking.get(b.id, 1) for b in overlap)
            remaining = cat_meta["pool_capacity"] - used_units
            if requested_range_units > remaining:
                msg = (
                    f"На Range свободно только {max(0, remaining)} {_ru_platform_word(max(0, remaining))} из "
                    f"{cat_meta['pool_capacity']} в это время."
                )
                if not range_units_exceed_limit:
                    errors.append(msg)
                resource_availability = Availability(False, msg)
            else:
                resource_availability = Availability(
                    True,
                    f"На Range останется {remaining - requested_range_units} "
                    f"{_ru_platform_word(remaining - requested_range_units)} после этой брони "
                    f"(из {cat_meta['pool_capacity']})."
                )
                # pick the resource with smallest active platform load (simple balancing)
                load: dict[int, int] = {rid: 0 for rid in pool_ids}
                for b in overlap:
                    load[b.resource_id] = load.get(b.resource_id, 0) + used_by_booking.get(b.id, 1)
                resource_id = min(pool_ids, key=lambda rid: load[rid])
        else:
            # course / hole_19_20: any overlap blocks in the simplified resource model.
            if overlap:
                msg = (
                    "Основное поле уже занято на выбранное время."
                    if cat_meta["resource_pool"] == "course"
                    else "Лунка 19, 20 уже занята на выбранное время."
                )
                errors.append(msg)
                resource_availability = Availability(False, msg)
            else:
                resource_availability = Availability(
                    True,
                    "Основное поле свободно."
                    if cat_meta["resource_pool"] == "course"
                    else "Лунка 19, 20 свободна.",
                )
                resource_id = pool_ids[0]

    # ── trainer availability
    trainer_availability = Availability(True, "")
    if inp.has_training and inp.trainer_id and trainer_name:
        if trainer_schedule_msg:
            errors.append(trainer_schedule_msg)
            trainer_availability = Availability(False, trainer_schedule_msg)
        else:
            t_overlap = _overlapping_bookings_for_trainer(
                db, inp.trainer_id, inp.starts_at, inp.ends_at, inp.exclude_booking_id
            )
            if t_overlap:
                msg = f"Тренер {trainer_name} уже занят в это время."
                errors.append(msg)
                trainer_availability = Availability(False, msg)
            else:
                trainer_availability = Availability(True, f"Тренер {trainer_name} свободен.")
    elif inp.has_training and trainer_schedule_msg:
        errors.append(trainer_schedule_msg)
        trainer_availability = Availability(False, trainer_schedule_msg)

    # ── resolve training service id
    if inp.has_training and training_sku:
        svc = _fetch_service_by_sku(db, training_sku)
        if svc:
            training_service_id = svc.id
        else:
            errors.append(f"В каталоге отсутствует тренировка {training_sku}. Запустите seed.")

    # Unit support: Range still stores platform count in legacy `baskets` for
    # capacity checks, but billing is per guest. Course/hole categories also bill
    # per guest. Older non-range basket-unit categories can still bill by unit.
    basket_unit = bool(cat_meta.get("basket_unit"))
    basket_unit_label = cat_meta.get("basket_unit_label", "")
    per_guest = bool(cat_meta.get("per_guest"))
    base_unit_price = cat_meta["base_price_kopecks"] if base_service else 0
    baskets = 1
    if basket_unit:
        baskets = max(1, int(inp.baskets or 1))
        unit_limit = cat_meta["pool_capacity"] if cat_meta["resource_pool"] == "range" else 100
        if baskets > unit_limit and cat_meta["resource_pool"] != "range":
            unit_name = cat_meta.get("basket_unit_label") or "единиц"
            errors.append(f"Слишком много: максимум {unit_limit} {unit_name} в одной брони.")
        if cat_meta["resource_pool"] == "range" and per_guest:
            base_price_kopecks = base_unit_price * max(1, inp.guests)
        else:
            base_price_kopecks = base_unit_price * baskets
    elif per_guest:
        # Weekend hour: charge per guest (balls unlimited).
        base_price_kopecks = base_unit_price * max(1, inp.guests)
    else:
        base_price_kopecks = base_unit_price

    range_balls_included = (
        cat_meta["resource_pool"] == "range"
        and resolved_category == "range_weekend_hour"
    )
    equipment_items: list[dict] = []
    for attr, (sku, name, equipment_unit_price) in EQUIPMENT_SPECS.items():
        if range_balls_included and attr == "addon_ball_baskets":
            continue
        qty = max(0, int(getattr(inp, attr, 0) or 0))
        if qty <= 0:
            continue
        equipment_items.append({
            "sku": sku,
            "name": name,
            "quantity": qty,
            "unit_price_kopecks": equipment_unit_price,
            "total_kopecks": equipment_unit_price * qty,
        })
    equipment_price_kopecks = sum(int(item["total_kopecks"]) for item in equipment_items)
    equipment_label = ", ".join(
        f"{item['name']} × {item['quantity']}" for item in equipment_items
    )

    service_subtotal = base_price_kopecks + equipment_price_kopecks + training_price_kopecks
    membership_purchase_price = 0
    membership_purchase_label = ""
    if inp.membership_purchase_id:
        purchase = db.get(Membership, inp.membership_purchase_id)
        if purchase and purchase.active and (not inp.customer_id or purchase.customer_id == inp.customer_id):
            plan = db.get(MembershipPlan, purchase.plan_id) if purchase else None
            if plan:
                membership_purchase_price = int(plan.price_kopecks or 0)
                membership_purchase_label = plan.name
        elif purchase and inp.customer_id and purchase.customer_id != inp.customer_id:
            warnings.append("Проданный абонемент не принадлежит выбранному клиенту — цена абонемента не добавлена.")

    subtotal = service_subtotal + membership_purchase_price

    # ── membership / абонемент discount
    # Two independent perks on a plan (can stack):
    #   1. covers_training → трэйнер-часть = 0 (while max_trainings not exhausted)
    #   2. discount_percent → percentage off remaining subtotal
    membership_discount = 0
    membership_label = ""
    membership_training_covered = False
    effective_membership_id = inp.membership_id or inp.membership_purchase_id
    if effective_membership_id:
        m = db.get(Membership, effective_membership_id)
        if m and m.active and (not inp.customer_id or m.customer_id == inp.customer_id):
            plan = db.get(MembershipPlan, m.plan_id) if m else None
            labels: list[str] = []
            coverage = 0
            booking_day = inp.starts_at.date()
            in_period = m.starts_on <= booking_day <= m.ends_on
            if not in_period:
                warnings.append(
                    f"Абонемент «{plan.name if plan else m.id}» не действует на дату брони — скидка не применена."
                )
            # Training coverage (абонемент): zero out the lesson part
            if (in_period and plan and plan.covers_training and inp.has_training
                    and training_price_kopecks > 0):
                cap = int(plan.max_trainings or 0)
                used = int(m.trainings_used or 0)
                if cap == 0 or used < cap:
                    coverage = training_price_kopecks
                    membership_training_covered = True
                    labels.append("тренировка покрыта")
                else:
                    warnings.append(
                        f"Абонемент «{plan.name}» исчерпан — осталось {max(0, cap - used)} тренировок."
                    )
            # Percentage discount on the uncovered remainder
            pct = int(plan.discount_percent or 0) if plan else 0
            pct_discount = 0
            if in_period and pct > 0:
                after_coverage = max(0, service_subtotal - coverage)
                pct_discount = after_coverage * pct // 100
                labels.append(f"−{pct}%")
            membership_discount = coverage + pct_discount
            if plan and labels:
                membership_label = f"{plan.name} ({', '.join(labels)})"
            elif plan:
                membership_label = plan.name
        elif m and inp.customer_id and m.customer_id != inp.customer_id:
            warnings.append("Абонемент не принадлежит выбранному клиенту — пропущен.")

    # ── coupon discount (percent or fixed, on subtotal − membership)
    coupon_discount = 0
    coupon_code_valid = ""
    coupon_label = ""
    coupon_error = ""
    code = (inp.coupon_code or "").strip()
    if code:
        from datetime import date as _date
        c = db.execute(select(Coupon).where(Coupon.code == code)).scalar_one_or_none()
        today = _date.today()
        # Coupon applies ONLY to услуги (base + equipment + training), NOT to a
        # membership purchased inside this booking — promotional discounts on a
        # 40 000 ₽ subscription would be a giveaway. The membership-coverage
        # discount has already zeroed out the lesson part if applicable; the
        # coupon then chips at the remaining services subtotal.
        coupon_base = max(0, service_subtotal - membership_discount)
        if not c:
            coupon_error = "Промокод не найден"
        elif not c.active:
            coupon_error = "Промокод деактивирован"
        elif c.valid_from and today < c.valid_from:
            coupon_error = f"Активен с {c.valid_from}"
        elif c.valid_to and today > c.valid_to:
            coupon_error = f"Истёк {c.valid_to}"
        elif c.max_uses and c.used_count >= c.max_uses:
            coupon_error = "Исчерпан лимит использований"
        else:
            if c.kind == "percent":
                coupon_discount = coupon_base * c.value // 100
                coupon_label = f"{c.code} (−{c.value}%)"
            else:  # fixed (value stored in rubles)
                coupon_discount = min(coupon_base, c.value * 100)
                coupon_label = f"{c.code} (−{c.value} ₽)"
            coupon_code_valid = c.code

    discount = membership_discount + coupon_discount
    total = max(0, subtotal - discount)

    return ResolvedScenario(
        ok=not errors,
        errors=errors,
        warnings=warnings,
        base_price_kopecks=base_price_kopecks,
        equipment_price_kopecks=equipment_price_kopecks,
        equipment_label=equipment_label,
        training_price_kopecks=training_price_kopecks,
        total_kopecks=total,
        category_title=cat_meta["title"],
        category_short=cat_meta["short"],
        category_detail=cat_meta["detail"],
        training_label=training_label,
        trainer_name=trainer_name,
        resource_availability=resource_availability,
        trainer_availability=trainer_availability,
        base_service_id=base_service_id,
        training_service_id=training_service_id,
        resource_id=resource_id,
        duration_min=cat_meta["duration_min"],
        basket_unit=basket_unit,
        basket_unit_label=basket_unit_label,
        baskets=baskets,
        basket_unit_price_kopecks=base_unit_price,
        per_guest=per_guest,
        equipment_items=equipment_items,
        subtotal_kopecks=subtotal,
        membership_discount_kopecks=membership_discount,
        membership_purchase_price_kopecks=membership_purchase_price,
        membership_purchase_label=membership_purchase_label,
        membership_training_covered=membership_training_covered,
        coupon_discount_kopecks=coupon_discount,
        discount_kopecks=discount,
        coupon_code=coupon_code_valid,
        coupon_label=coupon_label,
        coupon_error=coupon_error,
        membership_label=membership_label,
    )


def categories_public() -> list[dict]:
    """List for the frontend tile picker."""
    return [
        {
            "code": code,
            "title": meta["title"],
            "short": meta["short"],
            "detail": meta["detail"],
            "base_price_kopecks": meta["base_price_kopecks"],
            "duration_min": meta["duration_min"],
            "pool_capacity": meta["pool_capacity"],
            "basket_unit": bool(meta.get("basket_unit")),
            "basket_unit_label": meta.get("basket_unit_label", ""),
            "per_guest": bool(meta.get("per_guest")),
        }
        for code, meta in PUBLIC_CATEGORY_CATALOG.items()
    ]


def training_options_public() -> list[dict]:
    """List for the frontend training type picker with per-guest prices."""
    out = []
    for t in ("trial", "regular", "kids"):
        rows = [
            {"guests": g, "sku": sku, "price_kopecks": price}
            for (tt, g), (sku, price) in TRAINING_MATRIX.items()
            if tt == t
        ]
        rows.sort(key=lambda r: r["guests"])
        out.append({
            "type": t,
            "label": TRAINING_TYPE_LABELS[t],
            "prices": rows,
        })
    return out
