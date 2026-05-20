"""Global search — powers the Cmd+K palette. Unicode folding done in Python."""
from typing import List, Literal
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import get_current_user
from ..enums import UserRole
from ..models import Customer, Booking, Service, Instructor

router = APIRouter(prefix="/search", tags=["search"])


class SearchHit(BaseModel):
    kind: Literal["booking", "customer", "instructor", "service"]
    icon: str
    title: str
    subtitle: str
    id: int


def _contains(haystack: str, needle: str) -> bool:
    return needle.casefold() in (haystack or "").casefold()


@router.get("", response_model=List[SearchHit])
def global_search(
    q: str = Query(..., min_length=2, max_length=64),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = q.strip()
    results: List[SearchHit] = []

    if q.isdigit():
        b = db.get(Booking, int(q))
        if b:
            sub = (b.customer.name if b.customer else "Без клиента") + \
                  f' · {b.starts_at.strftime("%d.%m %H:%M")}'
            results.append(SearchHit(
                kind="booking", icon="bookmark", title=f"Бронь #{b.id}",
                subtitle=sub, id=b.id,
            ))

    customer_q = select(Customer)
    # Тренер видит только своих клиентов и в глобальном поиске.
    if user.role == UserRole.INSTRUCTOR.value:
        from .customers import _trainer_visible_customer_ids
        visible = _trainer_visible_customer_ids(db, user)
        if not visible:
            customer_q = customer_q.where(Customer.id == -1)
        else:
            customer_q = customer_q.where(Customer.id.in_(visible))
    customers = list(db.execute(customer_q).scalars())
    for c in customers:
        if _contains(c.name, q) or _contains(c.phone, q) or _contains(c.email, q):
            results.append(SearchHit(
                kind="customer", icon="user", title=c.name,
                subtitle=c.phone or c.email or "—", id=c.id,
            ))
            if sum(1 for r in results if r.kind == "customer") >= 6:
                break

    instructors = list(db.execute(
        select(Instructor).where(Instructor.active == True)  # noqa: E712
    ).scalars())
    for i in instructors:
        if _contains(i.name, q) or _contains(i.specialization, q):
            results.append(SearchHit(
                kind="instructor", icon="user-cog", title=i.name,
                subtitle=i.specialization or "Тренер", id=i.id,
            ))
            if sum(1 for r in results if r.kind == "instructor") >= 4:
                break

    services = list(db.execute(
        select(Service).where(Service.active == True)  # noqa: E712
    ).scalars())
    for svc in services:
        if _contains(svc.name, q) or _contains(svc.category, q):
            results.append(SearchHit(
                kind="service", icon="tag", title=svc.name,
                subtitle=f"{svc.category} · {svc.base_price_kopecks // 100} ₽", id=svc.id,
            ))
            if sum(1 for r in results if r.kind == "service") >= 4:
                break

    return results
