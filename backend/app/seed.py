"""Seeds initial MGGC data if DB is empty. Safe to run multiple times.

Price list — 2026 (МГГК · Крыластское):
  Драйвинг-рэндж
    - 1 корзина 40 мячей (будни)  — 1 500 ₽
    - 1 час (выходные)            — 3 000 ₽
  Академические лунки
    - Лунки 19, 20                — 2 000 ₽
  Тренировки (пробные)
    - Пробная персональная 1 гость   — 7 000 ₽
    - Пробная групповая 2/3/4 гостя  — 10 000 / 12 000 / 14 000 ₽
  Тренировки (обычные)
    - Персональная 1 гость           — 10 000 ₽
    - Групповая 2/3/4 гостя          — 14 000 / 18 000 / 21 000 ₽
  Детские тренировки (до 16 лет)
    - Персональная 1 ребёнок         — 7 000 ₽
    - Групповая 2/3/4 ребёнка        — 10 000 / 12 000 / 14 000 ₽

Ресурсы:
  Драйвинг-рэндж 1–4   — для услуг Драйвинг-рэндж
  Лунка 19, Лунка 20   — для услуги Академические лунки
  Trainer slot 1–3     — для всех тренировочных услуг
"""
import logging
import os

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import SessionLocal
from .models import (
    User, Facility, Zone, ResourceType, Resource, AvailabilityRule,
    Instructor, Service, MembershipPlan, AppSetting,
    ResourceService,
)
from .enums import UserRole, ResourceKind, Season, ServiceCategory
from .security import hash_password

log = logging.getLogger("golfadmin.seed")


def _seed_users(db: Session) -> None:
    """Create initial user roster.

    Production: refuses to insert default-password accounts. Requires the
    INITIAL_ADMIN_PASSWORD env var; creates a single admin with that password
    and must_change_password=True so the operator changes it on first login.

    Dev/staging: creates a demo roster (admin/admin, manager/manager, …) so
    local development just works. Names are placeholders, not real staff.
    """
    if settings.is_production:
        initial = os.environ.get("INITIAL_ADMIN_PASSWORD", "").strip()
        if not initial:
            raise RuntimeError(
                "Empty users table in production: set INITIAL_ADMIN_PASSWORD env "
                "var to seed the initial admin account."
            )
        if len(initial) < 8:
            raise RuntimeError("INITIAL_ADMIN_PASSWORD must be at least 8 characters")
        db.add(User(
            username="admin",
            password_hash=hash_password(initial),
            name="Администратор",
            role=UserRole.ADMIN.value,
            must_change_password=True,
        ))
        log.warning("Seeded production admin account — INITIAL_ADMIN_PASSWORD must be changed on first login")
        return

    db.add_all([
        # Руководитель — полный доступ (заводим про запас "admin" для dev).
        User(username="admin", password_hash=hash_password("admin"),
             name="Администратор", role=UserRole.ADMIN.value,
             must_change_password=True),
        # Named "руководители" — полный доступ.
        User(username="manager", password_hash=hash_password("manager"),
             name="Управляющий", role=UserRole.ADMIN.value,
             must_change_password=True),
        # "Администраторы (ресепшен)" — только брони + справочники.
        User(username="reception1", password_hash=hash_password("reception1"),
             name="Администратор ресепшена", role=UserRole.STAFF.value,
             must_change_password=True),
        User(username="reception2", password_hash=hash_password("reception2"),
             name="Администратор ресепшена (смена 2)", role=UserRole.STAFF.value,
             must_change_password=True),
    ])


def seed_if_empty():
    db: Session = SessionLocal()
    try:
        if db.scalar(select(User).limit(1)):
            return

        _seed_users(db)

        facility = Facility(name="Крылатское", code="krylatskoe",
                            address="Москва, Крылатское", timezone="Europe/Moscow")
        db.add(facility)
        db.flush()

        rt_driving = ResourceType(kind=ResourceKind.RANGE_BAY.value, name="Драйвинг-рэндж",
                                  code="driving_bay", default_duration_min=60, icon="zap", color="#2E9A6A")
        rt_hole = ResourceType(kind=ResourceKind.HOLE.value, name="Лунка",
                               code="hole", default_duration_min=60, icon="flag", color="#155E3F")
        rt_lesson = ResourceType(kind=ResourceKind.LESSON_SLOT.value, name="Урок",
                                 code="lesson", default_duration_min=60, icon="user-cog", color="#8B5A96")
        for rt in (rt_driving, rt_hole, rt_lesson):
            db.add(rt)
        db.flush()

        z_driving = Zone(facility_id=facility.id, name="Драйвинг-рэндж", code="driving", sort_order=1)
        z_academic = Zone(facility_id=facility.id, name="Академические лунки", code="academic", sort_order=2)
        z_lessons = Zone(facility_id=facility.id, name="Тренировки", code="lessons", sort_order=3)
        for z in (z_driving, z_academic, z_lessons):
            db.add(z)
        db.flush()

        driving_resources: list[Resource] = []
        # МГГК operates 24 driving-range bays (D1..D24).
        for i in range(1, 25):
            r = Resource(zone_id=z_driving.id, resource_type_id=rt_driving.id,
                         name=f"Драйвинг-рэндж {i}", code=f"D{i}", sort_order=i,
                         season=Season.ALL_YEAR.value)
            driving_resources.append(r)

        hole_resources: list[Resource] = []
        for n in (19, 20):
            r = Resource(zone_id=z_academic.id, resource_type_id=rt_hole.id,
                         name=f"Лунка {n}", code=f"H{n}", sort_order=n,
                         season=Season.ALL_YEAR.value)
            hole_resources.append(r)

        lesson_resources: list[Resource] = []
        for i in range(1, 4):
            r = Resource(zone_id=z_lessons.id, resource_type_id=rt_lesson.id,
                         name=f"Trainer slot {i}", code=f"T{i}", sort_order=i,
                         season=Season.ALL_YEAR.value)
            lesson_resources.append(r)

        all_resources = driving_resources + hole_resources + lesson_resources
        db.add_all(all_resources)
        db.flush()

        for r in all_resources:
            db.add(AvailabilityRule(resource_id=r.id, weekday=None,
                                    open_time="08:00", close_time="22:00",
                                    season=Season.ALL_YEAR.value))

        db.add_all([
            Instructor(name="Анна Тренерова", specialization="Тренер",
                       color="#2E9A6A", bio=""),
            Instructor(name="Мария Тренерова", specialization="Тренер",
                       color="#3A6EA5", bio=""),
            Instructor(name="Сергей Тренеров", specialization="Тренер",
                       color="#C9A961", bio=""),
            Instructor(name="Дарья", specialization="Стажёр",
                       color="#8B5A96", bio=""),
        ])

        #    name, category,           sku,                  price_kop, dur, group, season,    trial, kids, resources
        services_spec = [
            # Драйвинг-рэндж
            ("Драйвинг-рэндж, корзина 40 мячей (будни)",
                ServiceCategory.DRIVING_RANGE, "driving-basket-40-weekday",
                150000, 60, None, Season.ALL_YEAR, False, False, driving_resources),
            ("Драйвинг-рэндж, 1 час (выходные)",
                ServiceCategory.DRIVING_RANGE, "driving-1h-weekend",
                300000, 60, None, Season.ALL_YEAR, False, False, driving_resources),

            # Академические лунки
            ("Лунки 19, 20",
                ServiceCategory.ACADEMIC_HOLES, "academic-holes-19-20",
                200000, 60, None, Season.ALL_YEAR, False, False, hole_resources),

            # Пробные тренировки
            ("Пробная персональная тренировка (1 гость)",
                ServiceCategory.LESSON_TRIAL, "trial-lesson-1",
                700000, 60, 1, Season.ALL_YEAR, True, False, lesson_resources),
            ("Пробная групповая тренировка (2 гостя)",
                ServiceCategory.LESSON_TRIAL, "trial-lesson-2",
                1000000, 60, 2, Season.ALL_YEAR, True, False, lesson_resources),
            ("Пробная групповая тренировка (3 гостя)",
                ServiceCategory.LESSON_TRIAL, "trial-lesson-3",
                1200000, 60, 3, Season.ALL_YEAR, True, False, lesson_resources),
            ("Пробная групповая тренировка (4 гостя)",
                ServiceCategory.LESSON_TRIAL, "trial-lesson-4",
                1400000, 60, 4, Season.ALL_YEAR, True, False, lesson_resources),

            # Обычные тренировки
            ("Персональная тренировка (1 гость)",
                ServiceCategory.LESSON, "lesson-1",
                1000000, 60, 1, Season.ALL_YEAR, False, False, lesson_resources),
            ("Групповая тренировка (2 гостя)",
                ServiceCategory.LESSON, "lesson-2",
                1400000, 60, 2, Season.ALL_YEAR, False, False, lesson_resources),
            ("Групповая тренировка (3 гостя)",
                ServiceCategory.LESSON, "lesson-3",
                1800000, 60, 3, Season.ALL_YEAR, False, False, lesson_resources),
            ("Групповая тренировка (4 гостя)",
                ServiceCategory.LESSON, "lesson-4",
                2100000, 60, 4, Season.ALL_YEAR, False, False, lesson_resources),

            # Детские тренировки
            ("Персональная тренировка (1 ребёнок до 16 лет)",
                ServiceCategory.LESSON_KIDS, "kids-lesson-1",
                700000, 60, 1, Season.ALL_YEAR, False, True, lesson_resources),
            ("Групповая тренировка (2 ребёнка до 16 лет)",
                ServiceCategory.LESSON_KIDS, "kids-lesson-2",
                1000000, 60, 2, Season.ALL_YEAR, False, True, lesson_resources),
            ("Групповая тренировка (3 ребёнка до 16 лет)",
                ServiceCategory.LESSON_KIDS, "kids-lesson-3",
                1200000, 60, 3, Season.ALL_YEAR, False, True, lesson_resources),
            ("Групповая тренировка (4 ребёнка до 16 лет)",
                ServiceCategory.LESSON_KIDS, "kids-lesson-4",
                1400000, 60, 4, Season.ALL_YEAR, False, True, lesson_resources),
        ]
        requires_instructor = {
            ServiceCategory.LESSON.value,
            ServiceCategory.LESSON_TRIAL.value,
            ServiceCategory.LESSON_KIDS.value,
        }
        services_by_sku: dict[str, Service] = {}
        service_resource_links: list[tuple[str, list[Resource]]] = []
        for (name, cat, sku, price, dur, grp, season, trial, kids, res_list) in services_spec:
            svc = Service(
                category=cat.value, name=name, sku=sku,
                base_price_kopecks=price, duration_min=dur, group_size=grp,
                season=season.value, is_trial=trial, is_kids=kids,
                requires_instructor=(cat.value in requires_instructor),
            )
            db.add(svc)
            services_by_sku[sku] = svc
            service_resource_links.append((sku, res_list))
        db.flush()

        for sku, res_list in service_resource_links:
            svc = services_by_sku[sku]
            for r in res_list:
                db.add(ResourceService(resource_id=r.id, service_id=svc.id))

        # Example абонементы — admin can create more / delete these.
        db.add_all([
            MembershipPlan(
                name="Абонемент: 30 дней тренировок",
                tier=1, price_kopecks=1500000, duration_days=30,
                covers_training=True, max_trainings=0,
                description="Безлимит тренировок с тренером на 30 дней.",
            ),
            MembershipPlan(
                name="Абонемент: 8 тренировок",
                tier=1, price_kopecks=800000, duration_days=60,
                covers_training=True, max_trainings=8,
                description="8 тренировок, срок — 60 дней.",
            ),
        ])

        db.add(AppSetting(key="facility_id", value=str(facility.id)))
        db.add(AppSetting(key="season_mode", value="auto"))

        db.commit()
    finally:
        db.close()
