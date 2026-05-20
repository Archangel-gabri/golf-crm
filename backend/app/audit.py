from __future__ import annotations
from typing import Optional, Any
from sqlalchemy.orm import Session

from .models import AuditLog, User


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
