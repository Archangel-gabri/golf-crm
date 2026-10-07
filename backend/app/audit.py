from __future__ import annotations
from typing import Optional
from sqlalchemy.orm import Session

from .models import AuditLog, User

# Журнал аудита хранит, КТО и ЧТО сделал, но не копию персональных данных клиента.
# У клиента в журнал попадают только значения этих полей; остальные — одним списком
# имён изменённых полей (без значений).
CUSTOMER_AUDIT_FIELDS = frozenset({"consent_marketing"})


def customer_snapshot(data: dict, changed_against: Optional[dict] = None) -> dict:
    """Безопасный снимок клиента: разрешённые поля + имена изменённых."""
    snap = {k: v for k, v in data.items() if k in CUSTOMER_AUDIT_FIELDS}
    if changed_against is not None:
        snap["changed_fields"] = sorted(
            k for k in data if k not in CUSTOMER_AUDIT_FIELDS and data[k] != changed_against.get(k)
        )
    return snap


def log(
    db: Session,
    actor: Optional[User],
    action: str,
    entity: str,
    entity_id: Optional[int],
    summary: str = "",
    before: Optional[dict] = None,
    after: Optional[dict] = None,
    ip: str = "",
) -> AuditLog:
    if entity == "customer":
        # Страховка: что бы ни передал вызывающий код, ПДн клиента в журнал не уйдут.
        before = _only_allowed(before)
        after = _only_allowed(after)
    entry = AuditLog(
        actor_user_id=actor.id if actor else None,
        actor_username=actor.username if actor else "",
        action=action,
        entity=entity,
        entity_id=entity_id,
        summary=summary,
        before=before or {},
        after=after or {},
        ip=ip,
    )
    db.add(entry)
    db.flush()
    return entry


def _only_allowed(data: Optional[dict]) -> dict:
    return {
        k: v for k, v in (data or {}).items()
        if k in CUSTOMER_AUDIT_FIELDS or k == "changed_fields"
    }
