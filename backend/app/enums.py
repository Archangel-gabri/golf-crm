import enum


class UserRole(str, enum.Enum):
    ADMIN = "admin"
    MANAGER = "manager"
    STAFF = "staff"
    INSTRUCTOR = "instructor"
    ACCOUNTING = "accounting"


class BookingStatus(str, enum.Enum):
    DRAFT = "draft"
    HELD = "held"
    CONFIRMED = "confirmed"
    CHECKED_IN = "checked_in"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class PaymentStatus(str, enum.Enum):
    PENDING = "pending"
    REQUIRES_ACTION = "requires_action"
    AUTHORIZED = "authorized"
    PAID = "paid"
    PARTIALLY_REFUNDED = "partially_refunded"
    REFUNDED = "refunded"
    FAILED = "failed"
    CANCELED = "canceled"


class ResourceKind(str, enum.Enum):
    TEE_TIME = "tee_time"
    HOLE = "hole"
    RANGE_BAY = "range_bay"
    SIMULATOR_BAY = "simulator_bay"
    BILLIARD_TABLE = "billiard_table"
    LESSON_SLOT = "lesson_slot"
    COURT = "court"
    ROOM = "room"


class ServiceCategory(str, enum.Enum):
    RANGE = "range"
    DRIVING_RANGE = "driving_range"
    ACADEMIC_HOLES = "academic_holes"
    COURSE_PLAY = "course_play"
    LESSON = "lesson"
    LESSON_TRIAL = "lesson_trial"
    LESSON_KIDS = "lesson_kids"
    INTRO_COURSE = "intro_course"
    RENTAL = "rental"
    SIMULATOR = "simulator"
    BILLIARD = "billiard"
    MASSAGE = "massage"
    EXCURSION = "excursion"
    EVENT = "event"
    PACKAGE = "package"
    ADDON = "addon"


class Season(str, enum.Enum):
    SUMMER = "summer"
    WINTER = "winter"
    ALL_YEAR = "all_year"


class AuditAction(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    STATUS_CHANGE = "status_change"
    PAYMENT = "payment"
    REFUND = "refund"
    LOGIN = "login"
    LOGIN_FAILED = "login_failed"
    CANCEL = "cancel"
    NO_SHOW = "no_show"
    CHECK_IN = "check_in"
    COMPLETE = "complete"
