"""Aggregated tags list — frontend use for autocomplete."""
from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import get_current_user
from ..models import Service, Instructor

router = APIRouter(prefix="/tags", tags=["tags"])


@router.get("", response_model=dict)
def all_tags(user=Depends(get_current_user), db: Session = Depends(get_db)):
    service_tags: set[str] = set()
    for (tags,) in db.execute(select(Service.tags).where(Service.active == True)):  # noqa: E712
        for t in (tags or []):
            if isinstance(t, str) and t.strip():
                service_tags.add(t.strip())
    instructor_tags: set[str] = set()
    for (tags,) in db.execute(select(Instructor.tags).where(Instructor.active == True)):  # noqa: E712
        for t in (tags or []):
            if isinstance(t, str) and t.strip():
                instructor_tags.add(t.strip())
    return {
        "services": sorted(service_tags),
        "instructors": sorted(instructor_tags),
        "all": sorted(service_tags | instructor_tags),
    }
