from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document import Document
from app.models.note import DocumentNote
from app.models.user import User
from app.schemas.common import ApiResponse

doc_notes_router = APIRouter(prefix="/documents/{doc_id}/notes", tags=["阅读笔记"])
notes_router = APIRouter(prefix="/notes", tags=["阅读笔记"])


class NoteCreateRequest(BaseModel):
    page_number: int
    content: str
    highlight_text: str | None = None
    position: dict | None = None


class NoteUpdateRequest(BaseModel):
    content: str


class NoteOut(BaseModel):
    id: int
    document_id: int
    page_number: int
    content: str
    highlight_text: str | None = None
    position: dict | None = None
    created_at: str

    model_config = {"from_attributes": True}


async def _get_user_doc(doc_id: int, user_id: int, db: AsyncSession) -> Document:
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return doc


@doc_notes_router.post("", response_model=ApiResponse[NoteOut])
async def create_note(
    doc_id: int,
    req: NoteCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_user_doc(doc_id, user.id, db)

    note = DocumentNote(
        user_id=user.id,
        document_id=doc_id,
        page_number=req.page_number,
        content=req.content,
        highlight_text=req.highlight_text,
        position=req.position,
    )
    db.add(note)
    await db.flush()

    return ApiResponse.ok(
        data=NoteOut(
            id=note.id,
            document_id=note.document_id,
            page_number=note.page_number,
            content=note.content,
            highlight_text=note.highlight_text,
            position=note.position,
            created_at=note.created_at.isoformat() if note.created_at else "",
        )
    )


@doc_notes_router.get("", response_model=ApiResponse[list[NoteOut]])
async def list_notes(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_user_doc(doc_id, user.id, db)

    result = await db.execute(
        select(DocumentNote)
        .where(DocumentNote.user_id == user.id, DocumentNote.document_id == doc_id)
        .order_by(DocumentNote.page_number.asc(), DocumentNote.created_at.asc())
    )
    notes = [
        NoteOut(
            id=n.id,
            document_id=n.document_id,
            page_number=n.page_number,
            content=n.content,
            highlight_text=n.highlight_text,
            position=n.position,
            created_at=n.created_at.isoformat() if n.created_at else "",
        )
        for n in result.scalars().all()
    ]
    return ApiResponse.ok(data=notes)


@notes_router.put("/{note_id}", response_model=ApiResponse[NoteOut])
async def update_note(
    note_id: int,
    req: NoteUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DocumentNote).where(
            DocumentNote.id == note_id, DocumentNote.user_id == user.id
        )
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="笔记不存在")

    note.content = req.content
    await db.flush()

    return ApiResponse.ok(
        data=NoteOut(
            id=note.id,
            document_id=note.document_id,
            page_number=note.page_number,
            content=note.content,
            highlight_text=note.highlight_text,
            position=note.position,
            created_at=note.created_at.isoformat() if note.created_at else "",
        )
    )


@notes_router.delete("/{note_id}", response_model=ApiResponse)
async def delete_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DocumentNote).where(
            DocumentNote.id == note_id, DocumentNote.user_id == user.id
        )
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="笔记不存在")

    await db.delete(note)
    return ApiResponse.ok(msg="笔记已删除")
