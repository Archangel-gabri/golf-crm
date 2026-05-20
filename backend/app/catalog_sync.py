"""Idempotent catalog synchronization helpers."""
from __future__ import annotations

import logging
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .enums import ResourceKind, Season
from .models import (
    AppSetting,
    AvailabilityRule,
    Facility,
    Membership,
    MembershipPlan,
    Resource,
    ResourceService,
    ResourceType,
    Service,
    Zone,
)
from .official_price import (
    LEGACY_PLAN_NAMES_TO_ARCHIVE,
    LEGACY_SERVICE_SKUS_TO_ARCHIVE,
    OFFICIAL_MEMBERSHIP_PLANS,
    OFFICIAL_SERVICE_SKUS,
    OFFICIAL_SERVICE_SPECS,
)

log = logging.getLogger("golfadmin.catalog_sync")

PRICE_SYNC_MARKER = "official_price_golfmsk_2026_v1"


def ensure_official_price_catalog(
    db: Session,
    *,
    force: bool = False,
    archive_non_official: bool = False,
) -> dict[str, int | bool]:
    """Upsert services/resources/plans from the official club price list.

    Startup calls this once through a marker so operator edits are not rewritten
    every restart. The Settings "sync from price" action passes force=True and
    can optionally archive services that are not in the official price list.
    """
    if not force and db.get(AppSetting, PRICE_SYNC_MARKER):
        return {"skipped": True, "created": 0, "updated": 0, "archived": 0}

    stats = {
        "skipped": False,
        "created": 0,
        "updated": 0,
        "archived": 0,
        "linked": 0,
        "plans": 0,
    }

    _ensure_course_resource(db, stats)

    services_by_sku = {
        s.sku: s for s in db.execute(select(Service)).scalars()
    }
    resources_by_code = {
        r.code: r for r in db.execute(select(Resource)).scalars()
    }

    for spec in OFFICIAL_SERVICE_SPECS:
        svc = services_by_sku.get(spec.sku)
        if not svc:
            svc = Service(
                sku=spec.sku,
                category=spec.category,
                name=spec.name,
                base_price_kopecks=spec.price_rub * 100,
            )
            db.add(svc)
            services_by_sku[spec.sku] = svc
            stats["created"] += 1
        else:
            stats["updated"] += 1

        svc.category = spec.category
        svc.name = spec.name
        svc.base_price_kopecks = spec.price_rub * 100
        svc.duration_min = spec.duration_min
        svc.group_size = spec.group_size
        svc.season = spec.season
        svc.is_trial = spec.is_trial
        svc.is_kids = spec.is_kids
        svc.requires_instructor = spec.requires_instructor
        svc.tags = list(spec.tags)
        svc.description = spec.description
        svc.active = True

        db.flush()
        db.execute(delete(ResourceService).where(ResourceService.service_id == svc.id))
        for code in spec.resource_codes:
            resource = resources_by_code.get(code)
            if resource:
                db.add(ResourceService(resource_id=resource.id, service_id=svc.id))
                stats["linked"] += 1

    _archive_services(db, stats, archive_non_official=archive_non_official)
    _sync_membership_plans(db, stats)

    marker = db.get(AppSetting, PRICE_SYNC_MARKER)
    value = (
        f"{datetime.utcnow().isoformat()}Z;"
        f"services={len(OFFICIAL_SERVICE_SPECS)};"
        f"plans={len(OFFICIAL_MEMBERSHIP_PLANS)}"
    )
    if marker:
        marker.value = value
    else:
        db.add(AppSetting(key=PRICE_SYNC_MARKER, value=value))

    log.info(
        "Official price sync: created=%s updated=%s archived=%s linked=%s plans=%s",
        stats["created"],
        stats["updated"],
        stats["archived"],
        stats["linked"],
        stats["plans"],
    )
    return stats


def _ensure_course_resource(db: Session, stats: dict[str, int | bool]) -> None:
    facility = db.execute(select(Facility).order_by(Facility.id).limit(1)).scalar_one_or_none()
    if not facility:
        return

    rt = db.execute(
        select(ResourceType).where(ResourceType.code == "tee_time")
    ).scalar_one_or_none()
    if not rt:
        rt = ResourceType(
            kind=ResourceKind.TEE_TIME.value,
            name="Поле 9/18 лунок",
            code="tee_time",
            default_duration_min=180,
            default_capacity=4,
            icon="flag",
            color="#155E3F",
        )
        db.add(rt)
        db.flush()
        stats["created"] += 1

    zone = db.execute(
        select(Zone).where(Zone.facility_id == facility.id, Zone.code == "course")
    ).scalar_one_or_none()
    if not zone:
        zone = Zone(
            facility_id=facility.id,
            name="Поле 9/18 лунок",
            code="course",
            sort_order=4,
        )
        db.add(zone)
        db.flush()
        stats["created"] += 1

    course = db.execute(
        select(Resource).where(Resource.zone_id == zone.id, Resource.code == "COURSE")
    ).scalar_one_or_none()
    if not course:
        course = Resource(
            zone_id=zone.id,
            resource_type_id=rt.id,
            name="Основное поле",
            code="COURSE",
            capacity=4,
            sort_order=1,
            season=Season.ALL_YEAR.value,
            color="#155E3F",
        )
        db.add(course)
        db.flush()
        stats["created"] += 1
    has_rule = db.scalar(
        select(AvailabilityRule.id).where(AvailabilityRule.resource_id == course.id).limit(1)
    )
    if not has_rule:
        db.add(AvailabilityRule(
            resource_id=course.id,
            weekday=None,
            open_time="08:00",
            close_time="22:00",
            season=Season.ALL_YEAR.value,
        ))
        db.flush()
        stats["created"] += 1


def _archive_services(
    db: Session,
    stats: dict[str, int | bool],
    *,
    archive_non_official: bool,
) -> None:
    services = list(db.execute(select(Service)).scalars())
    for svc in services:
        should_archive = svc.sku in LEGACY_SERVICE_SKUS_TO_ARCHIVE
        if archive_non_official and svc.sku not in OFFICIAL_SERVICE_SKUS:
            should_archive = True
        if should_archive and svc.active:
            svc.active = False
            stats["archived"] += 1


def _sync_membership_plans(db: Session, stats: dict[str, int | bool]) -> None:
    plans = {p.name: p for p in db.execute(select(MembershipPlan)).scalars()}
    for spec in OFFICIAL_MEMBERSHIP_PLANS:
        plan = plans.get(spec.name)
        if not plan:
            plan = MembershipPlan(name=spec.name)
            db.add(plan)
            db.flush()
            plans[spec.name] = plan
            stats["created"] += 1
        else:
            stats["updated"] += 1

        plan.tier = spec.tier
        plan.price_kopecks = spec.price_rub * 100
        plan.duration_days = spec.duration_days
        plan.discount_percent = spec.discount_percent
        plan.priority_booking_days = spec.priority_booking_days
        plan.description = spec.description
        plan.covers_training = spec.covers_training
        plan.max_trainings = spec.max_trainings
        plan.active = True
        stats["plans"] += 1

    for name in LEGACY_PLAN_NAMES_TO_ARCHIVE:
        plan = plans.get(name)
        if not plan or not plan.active:
            continue
        has_memberships = db.scalar(
            select(Membership.id).where(Membership.plan_id == plan.id).limit(1)
        )
        if not has_memberships:
            plan.active = False
            stats["archived"] += 1
