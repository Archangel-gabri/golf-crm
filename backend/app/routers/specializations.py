"""Instructor specialization dictionary."""
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_db
from ..deps import get_current_user, require_manager
from ..models import Specialization, User
from ..enums import AuditAction
from .. import audit

router = APIRouter(prefix="/specializations", tags=["specializations"])


class SpecIn(BaseModel):
    name: str
    code: str
    description: str = ""
    applicable_categories: List[str] = []
    sort_order: int = 0
    active: bool = True


class SpecOut(SpecIn):
    model_config = ConfigDict(from_attributes=True)
    id: int


@router.get("", response_model=List[SpecOut])
def list_specs(user=Depends(get_current_user), db: Session = Depends(get_db)):
    q = select(Specialization).order_by(Specialization.sort_order, Specialization.name)
    return list(db.execute(q).scalars())


@router.post("", response_model=SpecOut, status_code=201)
def create_spec(
    payload: SpecIn,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    sp = Specialization(**payload.model_dump())
    db.add(sp)
    db.flush()
    audit.log(db, user, AuditAction.CREATE.value, "specialization", sp.id,
              summary=f"Добавлена специализация: {sp.name}")
    db.commit()
    db.refresh(sp)
    return sp


@router.put("/{sid}", response_model=SpecOut)
def update_spec(
    sid: int,
    payload: SpecIn,
    user: User = Depends(require_manager),
    db: Session = Depends(get_db),
):
    sp = db.get(Specialization, sid)
    if not sp:
        raise HTTPException(404, "Not found")
    for k, v in payload.model_dump().items():
        setattr(sp, k, v)
    audit.log(db, user, AuditAction.UPDATE.value, "specialization", sid,
              summary=f"Обновлена: {sp.name}")
    db.commit()
    db.refresh(sp)
    return sp
