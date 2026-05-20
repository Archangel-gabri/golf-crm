"""Pydantic DTOs for the API."""
from __future__ import annotations
from datetime import datetime, date
from typing import Optional, List
from pydantic import BaseModel, ConfigDict, Field


# ── Auth ──────────────────────────────────────────────────────────────
class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    name: str
    email: str = ""
    role: str
    active: bool
    instructor_id: Optional[int] = None
    must_change_password: bool = False


# ── Resource / Zone / Facility ────────────────────────────────────────
class ResourceTypeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    kind: str
    name: str
    code: str
    color: str
    icon: str
    default_duration_min: int


class ResourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    zone_id: int
    resource_type_id: int
    name: str
    code: str
    capacity: int
    sort_order: int
    season: str
    color: str
    active: bool


class ZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    code: str
    sort_order: int
    active: bool
    resources: List[ResourceOut] = []


# ── Customer ──────────────────────────────────────────────────────────
class CustomerIn(BaseModel):
    name: str
    phone: str = ""
    email: str = ""
    car_brand: str = ""
    car_number: str = ""
    birthdate: Optional[date] = None
    notes: str = ""
    consent_marketing: bool = False


class CustomerOut(CustomerIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime


class CustomerWithStatsOut(CustomerOut):
    visits: int = 0
    total_spent_kopecks: int = 0
    active_memberships: List[str] = []


# ── Service / Instructor ──────────────────────────────────────────────
class ServiceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    category: str
    name: str
    sku: str
    duration_min: int
    base_price_kopecks: int
    group_size: Optional[int] = None
    season: str
    is_trial: bool
    is_kids: bool
    requires_instructor: bool
    active: bool


class InstructorOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    trainer_type: str = "club"
    specialization: str
    color: str
    bio: str
    phone: str
    email: str
    active: bool


# ── Booking ───────────────────────────────────────────────────────────
class BookingIn(BaseModel):
    resource_id: Optional[int] = None
    service_id: Optional[int] = None
    customer_id: Optional[int] = None
    instructor_id: Optional[int] = None
    starts_at: datetime
    ends_at: datetime
    guests: int = 1
    with_guest: bool = False
    price_kopecks: int = 0
    discount_kopecks: int = 0
    comment: str = ""
    coupon_code: str = ""


class BookingPatch(BaseModel):
    resource_id: Optional[int] = None
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    comment: Optional[str] = None


class BookingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    resource_id: Optional[int]
    service_id: Optional[int]
    customer_id: Optional[int]
    instructor_id: Optional[int]
    starts_at: datetime
    ends_at: datetime
    guests: int
    status: str
    payment_status: str
    price_kopecks: int
    discount_kopecks: int
    total_kopecks: int
    comment: str


class BookingRichOut(BookingOut):
    customer_name: Optional[str] = None
    service_name: Optional[str] = None
    resource_name: Optional[str] = None
    instructor_name: Optional[str] = None


# ── Dashboard ─────────────────────────────────────────────────────────
class DashboardStats(BaseModel):
    bookings_today: int
    revenue_today_kopecks: int
    customers_total: int
    resources_active: int
    upcoming: List[BookingRichOut] = []


# ── Slot grid ─────────────────────────────────────────────────────────
class SlotOut(BaseModel):
    resource_id: int
    starts_at: datetime
    ends_at: datetime
    state: str  # free | booked | blackout
    booking_id: Optional[int] = None


# ── Scenario-driven booking ───────────────────────────────────────────
class ScenarioIn(BaseModel):
    category: str = Field(..., description="range | hole_19_20 | course_9 | course_18")
    guests: int = Field(1, ge=1, le=99)
    has_training: bool = False
    training_type: Optional[str] = Field(None, description="trial | regular | kids")
    trainer_id: Optional[int] = None
    starts_at: datetime
    ends_at: datetime
    customer_id: Optional[int] = None
    comment: str = ""
    exclude_booking_id: Optional[int] = None
    baskets: int = Field(1, ge=1, le=100, description="Unit count: Range platforms, legacy basket-unit categories")
    addon_clubs: int = Field(0, ge=0, le=100)
    addon_ball_baskets: int = Field(0, ge=0, le=100)
    addon_trolleys: int = Field(0, ge=0, le=100)
    addon_bags: int = Field(0, ge=0, le=100)
    addon_golf_carts: int = Field(0, ge=0, le=20)
    coupon_code: str = ""
    membership_id: Optional[int] = None
    membership_purchase_id: Optional[int] = None


class CategoryOption(BaseModel):
    code: str
    title: str
    short: str
    detail: str
    base_price_kopecks: int
    duration_min: int
    pool_capacity: int
    basket_unit: bool = False
    basket_unit_label: str = ""
    per_guest: bool = False


class TrainingPriceRow(BaseModel):
    guests: int
    sku: str
    price_kopecks: int


class TrainingOption(BaseModel):
    type: str
    label: str
    prices: list[TrainingPriceRow]


class ScenarioCatalog(BaseModel):
    categories: list[CategoryOption]
    trainings: list[TrainingOption]
