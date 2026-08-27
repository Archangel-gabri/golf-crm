from typing import List, Optional
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import get_current_user
from ..enums import UserRole
from ..models import Service, Instructor
from ..schemas import ServiceOut, InstructorOut

router = APIRouter(prefix="/catalog", tags=["catalog"])


@router.get("/services", response_model=List[ServiceOut])
def list_services(
    category: Optional[str] = None,
    active_only: bool = True,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Service).order_by(Service.category, Service.name)
    if active_only:
        q = q.where(Service.active == True)  # noqa: E712
    if category:
        q = q.where(Service.category == category)
    return list(db.execute(q).scalars())


@router.get("/instructors", response_model=List[InstructorOut])
def list_instructors(
    active_only: bool = True,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = select(Instructor).order_by(Instructor.trainer_type, Instructor.name)
    if active_only:
        q = q.where(Instructor.active == True)  # noqa: E712
    # Trainers must not see their colleagues — privacy + smaller surface for
    # accidentally referencing another trainer's id from the UI. They get only
    # their own row (linked via users.instructor_id).
    if user.role == UserRole.INSTRUCTOR.value:
        if not user.instructor_id:
            return []
        q = q.where(Instructor.id == user.instructor_id)
    return list(db.execute(q).scalars())
