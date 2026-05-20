"""Official 2026 price catalog from https://golfmsk.com/price.

The CRM stores bookable items as Service rows and training packages as
MembershipPlan rows. Keep this file as the single source of truth for the
"reset/sync catalog from price" operation.
"""
from __future__ import annotations

from dataclasses import dataclass

from .enums import Season, ServiceCategory


@dataclass(frozen=True)
class ServiceSpec:
    category: str
    name: str
    sku: str
    price_rub: int
    duration_min: int
    group_size: int | None = None
    season: str = Season.ALL_YEAR.value
    is_trial: bool = False
    is_kids: bool = False
    requires_instructor: bool = False
    resource_codes: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()
    description: str = ""


@dataclass(frozen=True)
class MembershipPlanSpec:
    name: str
    price_rub: int
    duration_days: int
    max_trainings: int
    description: str
    tier: int = 1
    covers_training: bool = True
    discount_percent: int = 0
    priority_booking_days: int = 0


RANGE_RESOURCE_CODES = tuple(f"D{i}" for i in range(1, 25))
ACADEMIC_HOLE_CODES = ("H19", "H20")
LESSON_RESOURCE_CODES = ("T1", "T2", "T3")
COURSE_RESOURCE_CODES = ("COURSE",)


OFFICIAL_SERVICE_SPECS: tuple[ServiceSpec, ...] = (
    # 1. Пробное занятие
    ServiceSpec(
        ServiceCategory.LESSON_TRIAL.value,
        "Первое пробное персональное занятие для одного",
        "trial-lesson-1",
        7000,
        60,
        1,
        is_trial=True,
        requires_instructor=True,
        resource_codes=LESSON_RESOURCE_CODES,
        tags=("занятия", "пробное"),
        description="Для новых посетителей. Длительность 1 час, снаряжение включено.",
    ),
    ServiceSpec(
        ServiceCategory.LESSON_TRIAL.value,
        "Первое пробное занятие для двоих",
        "trial-lesson-2",
        10000,
        60,
        2,
        is_trial=True,
        requires_instructor=True,
        resource_codes=LESSON_RESOURCE_CODES,
        tags=("занятия", "пробное"),
        description="Для новых посетителей. Длительность 1 час, снаряжение включено.",
    ),
    ServiceSpec(
        ServiceCategory.LESSON_TRIAL.value,
        "Первое пробное занятие для троих",
        "trial-lesson-3",
        12000,
        60,
        3,
        is_trial=True,
        requires_instructor=True,
        resource_codes=LESSON_RESOURCE_CODES,
        tags=("занятия", "пробное"),
        description="Для новых посетителей. Длительность 1 час, снаряжение включено.",
    ),
    ServiceSpec(
        ServiceCategory.LESSON_TRIAL.value,
        "Первое пробное занятие для четверых",
        "trial-lesson-4",
        14000,
        60,
        4,
        is_trial=True,
        requires_instructor=True,
        resource_codes=LESSON_RESOURCE_CODES,
        tags=("занятия", "пробное"),
        description="Для новых посетителей. Длительность 1 час, снаряжение включено.",
    ),

    # 2. Индивидуальные занятия для продолжающих
    ServiceSpec(
        ServiceCategory.LESSON.value,
        "Персональное занятие для одного",
        "lesson-1",
        10000,
        60,
        1,
        requires_instructor=True,
        resource_codes=LESSON_RESOURCE_CODES,
        tags=("занятия",),
        description="Длительность 1 час, снаряжение включено.",
    ),
    ServiceSpec(
        ServiceCategory.LESSON.value,
        "Персональная тренировка для двоих",
        "lesson-2",
        14000,
        60,
        2,
        requires_instructor=True,
        resource_codes=LESSON_RESOURCE_CODES,
        tags=("занятия",),
        description="Длительность 1 час, снаряжение включено.",
    ),
    ServiceSpec(
        ServiceCategory.LESSON.value,
        "Персональная тренировка для троих",
        "lesson-3",
        18000,
        60,
        3,
        requires_instructor=True,
        resource_codes=LESSON_RESOURCE_CODES,
        tags=("занятия",),
        description="Длительность 1 час, снаряжение включено.",
    ),
    ServiceSpec(
        ServiceCategory.LESSON.value,
        "Персональная тренировка для четверых",
        "lesson-4",
        21000,
        60,
        4,
        requires_instructor=True,
        resource_codes=LESSON_RESOURCE_CODES,
        tags=("занятия",),
        description="Длительность 1 час, снаряжение включено.",
    ),

    # 4. Услуги без тренера
    ServiceSpec(
        ServiceCategory.DRIVING_RANGE.value,
        "Драйвинг-рэндж: 1 корзина (40 мячей)",
        "driving-basket-40-weekday",
        1500,
        60,
        resource_codes=RANGE_RESOURCE_CODES,
        tags=("услуги без тренера", "драйвинг-рэндж"),
    ),
    ServiceSpec(
        ServiceCategory.DRIVING_RANGE.value,
        "Драйвинг-рэндж: выходной тариф, 1 час",
        "driving-1h-weekend",
        3000,
        60,
        resource_codes=RANGE_RESOURCE_CODES,
        tags=("услуги без тренера", "драйвинг-рэндж", "выходные"),
        description="Выходной тариф: стоимость умножается на гостей, мячи без лимита.",
    ),
    ServiceSpec(
        ServiceCategory.ACADEMIC_HOLES.value,
        "Академические лунки 19, 20",
        "academic-holes-19-20",
        2000,
        60,
        resource_codes=ACADEMIC_HOLE_CODES,
        tags=("услуги без тренера", "академические лунки"),
        description="Стоимость за час.",
    ),
    ServiceSpec(
        ServiceCategory.COURSE_PLAY.value,
        "Игра на 9 лунок (будни)",
        "course-9-weekday",
        5000,
        180,
        resource_codes=COURSE_RESOURCE_CODES,
        tags=("услуги без тренера", "9 лунок"),
    ),
    ServiceSpec(
        ServiceCategory.COURSE_PLAY.value,
        "Игра на 9 лунок (выходные)",
        "course-9-weekend",
        7000,
        180,
        resource_codes=COURSE_RESOURCE_CODES,
        tags=("услуги без тренера", "9 лунок"),
    ),
    ServiceSpec(
        ServiceCategory.COURSE_PLAY.value,
        "Игра на 9 лунок (понедельник/вторник)",
        "course-9-mon-tue",
        4000,
        180,
        resource_codes=COURSE_RESOURCE_CODES,
        tags=("услуги без тренера", "9 лунок", "спецтариф"),
        description="Специальный тариф по понедельникам и вторникам.",
    ),
    ServiceSpec(
        ServiceCategory.COURSE_PLAY.value,
        "Игра на 18 лунок (будни)",
        "course-18-weekday",
        7000,
        300,
        resource_codes=COURSE_RESOURCE_CODES,
        tags=("услуги без тренера", "18 лунок"),
    ),
    ServiceSpec(
        ServiceCategory.COURSE_PLAY.value,
        "Игра на 18 лунок (выходные)",
        "course-18-weekend",
        9000,
        300,
        resource_codes=COURSE_RESOURCE_CODES,
        tags=("услуги без тренера", "18 лунок"),
    ),
    ServiceSpec(
        ServiceCategory.COURSE_PLAY.value,
        "Игра на 18 лунок (понедельник/вторник)",
        "course-18-mon-tue",
        6000,
        300,
        resource_codes=COURSE_RESOURCE_CODES,
        tags=("услуги без тренера", "18 лунок", "спецтариф"),
        description="Специальный тариф по понедельникам и вторникам.",
    ),

    # 5. Вводный курс
    ServiceSpec(
        ServiceCategory.INTRO_COURSE.value,
        "Вводный курс: группа 3–5 игроков",
        "intro-course-group-8",
        40000,
        480,
        5,
        requires_instructor=True,
        resource_codes=LESSON_RESOURCE_CODES,
        tags=("вводный курс", "занятия"),
        description="8 занятий, 2 раза в неделю по расписанию. Длительность одного занятия 1 час.",
    ),

    # 6. Аренда оборудования
    ServiceSpec(
        ServiceCategory.RENTAL.value,
        "Аренда клюшки",
        "rental-club",
        500,
        60,
        tags=("аренда", "оборудование"),
    ),
    ServiceSpec(
        ServiceCategory.RENTAL.value,
        "Аренда тележки",
        "rental-trolley",
        1000,
        60,
        tags=("аренда", "оборудование"),
    ),
    ServiceSpec(
        ServiceCategory.RENTAL.value,
        "Аренда бэга",
        "rental-bag",
        2500,
        60,
        tags=("аренда", "оборудование"),
    ),
    ServiceSpec(
        ServiceCategory.RENTAL.value,
        "Аренда гольф-кара",
        "rental-golf-cart",
        10000,
        60,
        tags=("аренда", "оборудование"),
    ),
)


OFFICIAL_MEMBERSHIP_PLANS: tuple[MembershipPlanSpec, ...] = (
    MembershipPlanSpec(
        name="5 персональных тренировок для одного",
        price_rub=40000,
        duration_days=30,
        max_trainings=5,
        description="Срок действия 30 дней с момента первого посещения, 5 тренировочных часов.",
    ),
    MembershipPlanSpec(
        name="10 персональных тренировок для одного",
        price_rub=75000,
        duration_days=45,
        max_trainings=10,
        description="Срок действия 45 дней с момента первого посещения, 10 тренировочных часов.",
    ),
    MembershipPlanSpec(
        name="5 персональных тренировок для двоих",
        price_rub=60000,
        duration_days=30,
        max_trainings=5,
        description="Срок действия 30 дней с момента первого посещения, 5 тренировочных часов для пары.",
    ),
    MembershipPlanSpec(
        name="Вводный курс: 8 занятий",
        price_rub=40000,
        duration_days=30,
        max_trainings=8,
        description="Группа 3–5 игроков, 8 занятий, 2 раза в неделю по расписанию.",
    ),
)


OFFICIAL_SERVICE_SKUS = {spec.sku for spec in OFFICIAL_SERVICE_SPECS}
LEGACY_SERVICE_SKUS_TO_ARCHIVE = {"range-basket-40"}
LEGACY_PLAN_NAMES_TO_ARCHIVE = {"Абонемент: 30 дней тренировок", "Абонемент: 8 тренировок"}
