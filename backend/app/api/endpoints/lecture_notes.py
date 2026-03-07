from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.note import LectureNote
from app.models.user import User
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/documents/{doc_id}/lecture-notes", tags=["讲解备注"])


class NoteItem(BaseModel):
    id: int
    page_number: int
    content: str
    updated_at: datetime

    model_config = {"from_attributes": True}


class NoteUpsert(BaseModel):
    content: str


@router.get("", response_model=ApiResponse[list[NoteItem]])
async def list_lecture_notes(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LectureNote)
        .where(LectureNote.document_id == doc_id, LectureNote.user_id == user.id)
        .order_by(LectureNote.page_number)
    )
    return ApiResponse.ok(data=[NoteItem.model_validate(n) for n in result.scalars().all()])


@router.put("/{page}", response_model=ApiResponse[NoteItem])
async def upsert_lecture_note(
    doc_id: int,
    page: int,
    req: NoteUpsert,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LectureNote).where(
            LectureNote.document_id == doc_id,
            LectureNote.user_id == user.id,
            LectureNote.page_number == page,
        )
    )
    note = result.scalar_one_or_none()
    if note:
        note.content = req.content
    else:
        note = LectureNote(
            user_id=user.id,
            document_id=doc_id,
            page_number=page,
            content=req.content,
        )
        db.add(note)
    await db.flush()
    return ApiResponse.ok(data=NoteItem.model_validate(note))


@router.delete("/{page}", response_model=ApiResponse)
async def delete_lecture_note(
    doc_id: int,
    page: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LectureNote).where(
            LectureNote.document_id == doc_id,
            LectureNote.user_id == user.id,
            LectureNote.page_number == page,
        )
    )
    note = result.scalar_one_or_none()
    if note:
        await db.delete(note)
    return ApiResponse.ok(msg="已删除")


@router.get("/export", response_model=ApiResponse[str])
async def export_notes(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LectureNote)
        .where(LectureNote.document_id == doc_id, LectureNote.user_id == user.id)
        .order_by(LectureNote.page_number)
    )
    notes = result.scalars().all()
    lines = ["# 讲解备注\n"]
    for n in notes:
        lines.append(f"## 第 {n.page_number} 页\n")
        lines.append(n.content)
        lines.append("\n")
    return ApiResponse.ok(data="\n".join(lines))
