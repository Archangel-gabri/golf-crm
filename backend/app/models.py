"""SQLAlchemy models for GolfAdmin — FastAPI port.

Ported from Flask app/domain/models.py. Removed Flask-specific mixins.
Schema is compatible with existing golf.db from the Flask app.
"""
from __future__ import annotations
from datetime import datetime, date
from typing import Optional, List
from sqlalchemy import (
    String, Integer, BigInteger, Boolean, DateTime, Date, Text,
    ForeignKey, UniqueConstraint, Index, CheckConstraint, JSON,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base
from .enums import BookingStatus, PaymentStatus, Season, UserRole


def _now():
    return datetime.utcnow()


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now, nullable=False)


class User(Base, TimestampMixin):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    email: Mapped[str] = mapped_column(String(255), default="")
    role: Mapped[str] = mapped_column(String(32), nullable=False, default=UserRole.STAFF.value)
    telegram_chat_id: Mapped[str] = mapped_column(String(64), default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    # For INSTRUCTOR-role accounts: link to their Instructor catalog row so the
    # timeline can filter bookings to only those assigned to this trainer.
    instructor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("instructors.id", ondelete="SET NULL"), nullable=True
    )

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN.value

    @property
    def is_manager(self) -> bool:
        return self.role in (UserRole.ADMIN.value, UserRole.MANAGER.value)


class Facility(Base, TimestampMixin):
    __tablename__ = "facilities"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    address: Mapped[str] = mapped_column(String(255), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="Europe/Moscow")
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    zones: Mapped[List["Zone"]] = relationship(back_populates="facility", cascade="all, delete-orphan")


class Zone(Base, TimestampMixin):
    __tablename__ = "zones"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    facility_id: Mapped[int] = mapped_column(ForeignKey("facilities.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    facility: Mapped[Facility] = relationship(back_populates="zones")
    resources: Mapped[List["Resource"]] = relationship(back_populates="zone", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("facility_id", "code"),)


class ResourceType(Base, TimestampMixin):
    __tablename__ = "resource_types"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    default_duration_min: Mapped[int] = mapped_column(Integer, default=60)
    default_capacity: Mapped[int] = mapped_column(Integer, default=1)
    icon: Mapped[str] = mapped_column(String(64), default="map-pin")
    color: Mapped[str] = mapped_column(String(16), default="#155E3F")
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    resources: Mapped[List["Resource"]] = relationship(back_populates="resource_type")


class Resource(Base, TimestampMixin):
    __tablename__ = "resources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id", ondelete="CASCADE"), nullable=False)
    resource_type_id: Mapped[int] = mapped_column(ForeignKey("resource_types.id"), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    capacity: Mapped[int] = mapped_column(Integer, default=1)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    season: Mapped[str] = mapped_column(String(16), default=Season.ALL_YEAR.value)
    color: Mapped[str] = mapped_column(String(16), default="")
    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    zone: Mapped[Zone] = relationship(back_populates="resources")
    resource_type: Mapped[ResourceType] = relationship(back_populates="resources")
    availability_rules: Mapped[List["AvailabilityRule"]] = relationship(
        back_populates="resource", cascade="all, delete-orphan"
    )
    blackouts: Mapped[List["Blackout"]] = relationship(
        back_populates="resource", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("zone_id", "code"),)


class AvailabilityRule(Base, TimestampMixin):
    __tablename__ = "availability_rules"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    resource_id: Mapped[int] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"), nullable=False)
    weekday: Mapped[Optional[int]] = mapped_column(Integer)
    open_time: Mapped[str] = mapped_column(String(5), nullable=False)
    close_time: Mapped[str] = mapped_column(String(5), nullable=False)
    valid_from: Mapped[Optional[date]] = mapped_column(Date)
    valid_to: Mapped[Optional[date]] = mapped_column(Date)
    season: Mapped[str] = mapped_column(String(16), default=Season.ALL_YEAR.value)

    resource: Mapped[Resource] = relationship(back_populates="availability_rules")


class Blackout(Base, TimestampMixin):
    __tablename__ = "blackouts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    resource_id: Mapped[Optional[int]] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"))
    facility_id: Mapped[Optional[int]] = mapped_column(ForeignKey("facilities.id", ondelete="CASCADE"))
    starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    reason: Mapped[str] = mapped_column(String(255), default="")
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    resource: Mapped[Optional[Resource]] = relationship(back_populates="blackouts")


class ClubEvent(Base, TimestampMixin):
    """Admin-managed club event shown in the standalone events calendar.

    These records are informational: they do not reserve resources or block
    booking slots. Operational blocking should still use bookings/blackouts.
    """
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(32), default="other", nullable=False, index=True)
    starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    location: Mapped[str] = mapped_column(String(160), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    capacity: Mapped[Optional[int]] = mapped_column(Integer)
    color: Mapped[str] = mapped_column(String(16), default="#155E3F")
    active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    __table_args__ = (
        Index("ix_events_time", "starts_at", "ends_at"),
        CheckConstraint("ends_at > starts_at", name="event_time_valid"),
    )


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    phone: Mapped[str] = mapped_column(String(32), default="", index=True)
    email: Mapped[str] = mapped_column(String(128), default="", index=True)
    car_brand: Mapped[str] = mapped_column(String(64), default="")
    car_number: Mapped[str] = mapped_column(String(32), default="")
    birthdate: Mapped[Optional[date]] = mapped_column(Date)
    notes: Mapped[str] = mapped_column(Text, default="")
    consent_marketing: Mapped[bool] = mapped_column(Boolean, default=False)
    tg_chat_id: Mapped[str] = mapped_column(String(64), default="")
    # Кто завёл клиента — для скоупа видимости тренеров (тренер видит только своих).
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    account: Mapped[Optional["Account"]] = relationship(
        back_populates="customer", uselist=False, cascade="all, delete-orphan"
    )
    memberships: Mapped[List["Membership"]] = relationship(
        back_populates="customer", cascade="all, delete-orphan"
    )
    bookings: Mapped[List["Booking"]] = relationship(back_populates="customer")


class Account(Base, TimestampMixin):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(
        ForeignKey("customers.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    balance_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    credit_limit_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)

    customer: Mapped[Customer] = relationship(back_populates="account")


class MembershipPlan(Base, TimestampMixin):
    """Абонемент — the club sells a time-limited pass to a guest.
    When `covers_training` is true, the holder's trainer portion is free during
    the active window (up to `max_trainings`; 0 = unlimited)."""
    __tablename__ = "membership_plans"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    tier: Mapped[int] = mapped_column(Integer, default=1)
    price_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    duration_days: Mapped[int] = mapped_column(Integer, default=90)
    discount_percent: Mapped[int] = mapped_column(Integer, default=0)
    priority_booking_days: Mapped[int] = mapped_column(Integer, default=0)
    description: Mapped[str] = mapped_column(Text, default="")
    # Абонемент-style perks — optional, default false.
    covers_training: Mapped[bool] = mapped_column(Boolean, default=False)
    max_trainings: Mapped[int] = mapped_column(Integer, default=0)  # 0 = unlimited
    # When true, the entire booking (field + equipment + training) is covered, not just training.
    covers_all_services: Mapped[bool] = mapped_column(Boolean, default=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Membership(Base, TimestampMixin):
    __tablename__ = "memberships"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), nullable=False)
    plan_id: Mapped[int] = mapped_column(ForeignKey("membership_plans.id"), nullable=False)
    purchased_at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    starts_on: Mapped[date] = mapped_column(Date, nullable=False)
    ends_on: Mapped[date] = mapped_column(Date, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    # How many training bookings have already consumed this абонемент.
    trainings_used: Mapped[int] = mapped_column(Integer, default=0)

    customer: Mapped[Customer] = relationship(back_populates="memberships")
    plan: Mapped[MembershipPlan] = relationship()


class Specialization(Base, TimestampMixin):
    __tablename__ = "specializations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    description: Mapped[str] = mapped_column(String(255), default="")
    applicable_categories: Mapped[list] = mapped_column(JSON, default=list)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    instructors: Mapped[List["Instructor"]] = relationship(
        secondary="instructor_specializations", back_populates="specializations"
    )


class InstructorSpecialization(Base):
    __tablename__ = "instructor_specializations"
    instructor_id: Mapped[int] = mapped_column(
        ForeignKey("instructors.id", ondelete="CASCADE"), primary_key=True
    )
    specialization_id: Mapped[int] = mapped_column(
        ForeignKey("specializations.id", ondelete="CASCADE"), primary_key=True
    )


class Instructor(Base, TimestampMixin):
    __tablename__ = "instructors"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    trainer_type: Mapped[str] = mapped_column(String(16), default="club", nullable=False)
    specialization: Mapped[str] = mapped_column(String(255), default="")
    color: Mapped[str] = mapped_column(String(16), default="#C9A961")
    bio: Mapped[str] = mapped_column(Text, default="")
    avatar_url: Mapped[str] = mapped_column(String(255), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    email: Mapped[str] = mapped_column(String(128), default="")
    working_hours: Mapped[dict] = mapped_column(JSON, default=dict)
    # Отложенный график — вступает в силу с pending_effective_from (today+7 при правке самим тренером).
    pending_working_hours: Mapped[Optional[dict]] = mapped_column(JSON)
    pending_effective_from: Mapped[Optional[date]] = mapped_column(Date)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    hourly_payout_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)  # сколько клуб платит тренеру за час
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    specializations: Mapped[List["Specialization"]] = relationship(
        secondary="instructor_specializations", back_populates="instructors"
    )


class InstructorServicePrice(Base, TimestampMixin):
    __tablename__ = "instructor_service_prices"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    instructor_id: Mapped[int] = mapped_column(ForeignKey("instructors.id", ondelete="CASCADE"), nullable=False)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    price_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    __table_args__ = (UniqueConstraint("instructor_id", "service_id"),)


class InstructorResource(Base):
    __tablename__ = "instructor_resources"
    instructor_id: Mapped[int] = mapped_column(ForeignKey("instructors.id", ondelete="CASCADE"), primary_key=True)
    resource_id: Mapped[int] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True)


class InstructorCustomer(Base, TimestampMixin):
    """M2M link: trainer → client. Trainer sees only their linked clients."""
    __tablename__ = "instructor_customers"
    instructor_id: Mapped[int] = mapped_column(ForeignKey("instructors.id", ondelete="CASCADE"), primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id", ondelete="CASCADE"), primary_key=True)


class ResourceService(Base):
    __tablename__ = "resource_services"
    resource_id: Mapped[int] = mapped_column(ForeignKey("resources.id", ondelete="CASCADE"), primary_key=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"), primary_key=True)


class Service(Base, TimestampMixin):
    __tablename__ = "services"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    category: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, default=60)
    base_price_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    group_size: Mapped[Optional[int]] = mapped_column(Integer)
    season: Mapped[str] = mapped_column(String(16), default=Season.ALL_YEAR.value)
    is_trial: Mapped[bool] = mapped_column(Boolean, default=False)
    is_kids: Mapped[bool] = mapped_column(Boolean, default=False)
    requires_instructor: Mapped[bool] = mapped_column(Boolean, default=False)
    applicable_resource_kinds: Mapped[list] = mapped_column(JSON, default=list)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class ServicePricing(Base, TimestampMixin):
    __tablename__ = "service_pricing"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    service_id: Mapped[int] = mapped_column(ForeignKey("services.id", ondelete="CASCADE"), nullable=False)
    weekdays: Mapped[list] = mapped_column(JSON, default=list)
    time_from: Mapped[Optional[str]] = mapped_column(String(5))
    time_to: Mapped[Optional[str]] = mapped_column(String(5))
    season: Mapped[str] = mapped_column(String(16), default=Season.ALL_YEAR.value)
    member_tier_min: Mapped[int] = mapped_column(Integer, default=0)
    price_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class AddOn(Base, TimestampMixin):
    __tablename__ = "addons"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    price_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Package(Base, TimestampMixin):
    __tablename__ = "packages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    price_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    includes: Mapped[dict] = mapped_column(JSON, default=dict)
    valid_days: Mapped[int] = mapped_column(Integer, default=365)
    description: Mapped[str] = mapped_column(Text, default="")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Coupon(Base, TimestampMixin):
    __tablename__ = "coupons"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="percent")
    value: Mapped[int] = mapped_column(Integer, nullable=False)
    valid_from: Mapped[Optional[date]] = mapped_column(Date)
    valid_to: Mapped[Optional[date]] = mapped_column(Date)
    max_uses: Mapped[int] = mapped_column(Integer, default=0)
    max_uses_per_user: Mapped[int] = mapped_column(Integer, default=0)
    used_count: Mapped[int] = mapped_column(Integer, default=0)
    stackable: Mapped[bool] = mapped_column(Boolean, default=False)
    conditions: Mapped[dict] = mapped_column(JSON, default=dict)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Voucher(Base, TimestampMixin):
    __tablename__ = "vouchers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    value_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    balance_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    issued_to_customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"))
    valid_until: Mapped[Optional[date]] = mapped_column(Date)
    redeemed: Mapped[bool] = mapped_column(Boolean, default=False)


class Promotion(Base, TimestampMixin):
    __tablename__ = "promotions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), default="discount")
    params: Mapped[dict] = mapped_column(JSON, default=dict)
    priority: Mapped[int] = mapped_column(Integer, default=0)
    stackable: Mapped[bool] = mapped_column(Boolean, default=False)
    valid_from: Mapped[Optional[date]] = mapped_column(Date)
    valid_to: Mapped[Optional[date]] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class BookingGroup(Base, TimestampMixin):
    __tablename__ = "booking_groups"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"))
    title: Mapped[str] = mapped_column(String(255), default="")
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    items: Mapped[List["Booking"]] = relationship(back_populates="group")


class Booking(Base, TimestampMixin):
    __tablename__ = "bookings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    group_id: Mapped[Optional[int]] = mapped_column(ForeignKey("booking_groups.id", ondelete="SET NULL"))

    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"))
    resource_id: Mapped[Optional[int]] = mapped_column(ForeignKey("resources.id"))
    service_id: Mapped[Optional[int]] = mapped_column(ForeignKey("services.id"))
    instructor_id: Mapped[Optional[int]] = mapped_column(ForeignKey("instructors.id"))

    guests: Mapped[int] = mapped_column(Integer, default=1)
    with_guest: Mapped[bool] = mapped_column(Boolean, default=False)

    starts_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    ends_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)

    status: Mapped[str] = mapped_column(String(16), default=BookingStatus.CONFIRMED.value, index=True)
    payment_status: Mapped[str] = mapped_column(String(24), default=PaymentStatus.PENDING.value, index=True)

    price_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    discount_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    total_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)

    comment: Mapped[str] = mapped_column(Text, default="")
    internal_notes: Mapped[str] = mapped_column(Text, default="")

    notified: Mapped[bool] = mapped_column(Boolean, default=False)
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    cancel_reason: Mapped[str] = mapped_column(String(255), default="")
    no_show_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    coupon_code: Mapped[str] = mapped_column(String(64), default="")

    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    group: Mapped[Optional[BookingGroup]] = relationship(back_populates="items")
    customer: Mapped[Optional[Customer]] = relationship(back_populates="bookings")
    resource: Mapped[Optional[Resource]] = relationship()
    service: Mapped[Optional[Service]] = relationship()
    instructor: Mapped[Optional[Instructor]] = relationship()
    items: Mapped[List["BookingItem"]] = relationship(back_populates="booking", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_bookings_resource_time", "resource_id", "starts_at", "ends_at"),
        CheckConstraint("ends_at > starts_at", name="booking_time_valid"),
    )


class BookingItem(Base, TimestampMixin):
    __tablename__ = "booking_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="service")
    service_id: Mapped[Optional[int]] = mapped_column(ForeignKey("services.id"))
    addon_id: Mapped[Optional[int]] = mapped_column(ForeignKey("addons.id"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    total_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)

    booking: Mapped[Booking] = relationship(back_populates="items")


class Waitlist(Base, TimestampMixin):
    __tablename__ = "waitlists"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), nullable=False)
    resource_id: Mapped[Optional[int]] = mapped_column(ForeignKey("resources.id"))
    service_id: Mapped[Optional[int]] = mapped_column(ForeignKey("services.id"))
    desired_from: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    desired_to: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    notified_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    fulfilled: Mapped[bool] = mapped_column(Boolean, default=False)


class CheckIn(Base, TimestampMixin):
    __tablename__ = "checkins"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    booking_id: Mapped[int] = mapped_column(ForeignKey("bookings.id", ondelete="CASCADE"), nullable=False)
    by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False)
    note: Mapped[str] = mapped_column(String(255), default="")


class Order(Base, TimestampMixin):
    __tablename__ = "orders"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    number: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"))
    booking_id: Mapped[Optional[int]] = mapped_column(ForeignKey("bookings.id"))
    subtotal_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    discount_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    total_kopecks: Mapped[int] = mapped_column(BigInteger, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="RUB")
    status: Mapped[str] = mapped_column(String(16), default="open")
    coupon_code: Mapped[str] = mapped_column(String(64), default="")
    created_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    items: Mapped[List["OrderItem"]] = relationship(back_populates="order", cascade="all, delete-orphan")
    payments: Mapped[List["Payment"]] = relationship(back_populates="order", cascade="all, delete-orphan")


class OrderItem(Base, TimestampMixin):
    __tablename__ = "order_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), default="service")
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_price_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")


class Payment(Base, TimestampMixin):
    __tablename__ = "payments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    order_id: Mapped[int] = mapped_column(ForeignKey("orders.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), default="manual")
    provider_ref: Mapped[str] = mapped_column(String(128), default="", index=True)
    idempotency_key: Mapped[str] = mapped_column(String(64), default="", index=True)
    amount_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default=PaymentStatus.PENDING.value)
    method: Mapped[str] = mapped_column(String(32), default="cash")
    captured_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    failure_reason: Mapped[str] = mapped_column(String(255), default="")
    received_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    order: Mapped[Order] = relationship(back_populates="payments")
    refunds: Mapped[List["Refund"]] = relationship(back_populates="payment", cascade="all, delete-orphan")


class Refund(Base, TimestampMixin):
    __tablename__ = "refunds"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    payment_id: Mapped[int] = mapped_column(ForeignKey("payments.id", ondelete="CASCADE"), nullable=False)
    amount_kopecks: Mapped[int] = mapped_column(BigInteger, nullable=False)
    reason: Mapped[str] = mapped_column(String(255), default="")
    provider_ref: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(24), default="pending")
    refunded_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))

    payment: Mapped[Payment] = relationship(back_populates="refunds")


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    at: Mapped[datetime] = mapped_column(DateTime, default=_now, nullable=False, index=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"))
    actor_username: Mapped[str] = mapped_column(String(64), default="")
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    entity: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, index=True)
    summary: Mapped[str] = mapped_column(String(255), default="")
    before: Mapped[dict] = mapped_column(JSON, default=dict)
    after: Mapped[dict] = mapped_column(JSON, default=dict)
    ip: Mapped[str] = mapped_column(String(64), default="")


class AppSetting(Base, TimestampMixin):
    __tablename__ = "app_settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")
