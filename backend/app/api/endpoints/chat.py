import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document import Document
from app.models.social import ChatMessage
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services.ai_service import chat_with_document
from app.services.doc_processor import extract_text

router = APIRouter(prefix="/documents/{doc_id}/chat", tags=["AI对话"])


class ChatRequest(BaseModel):
    question: str
    session_id: str | None = None


class ChatMessageOut(BaseModel):
    id: int
    session_id: str
    role: str
    content: str
    created_at: str

    model_config = {"from_attributes": True}


class ChatResponse(BaseModel):
    session_id: str
    answer: str


async def _get_user_doc(doc_id: int, user_id: int, db: AsyncSession) -> Document:
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return doc


@router.post("", response_model=ApiResponse[ChatResponse])
async def chat(
    doc_id: int,
    req: ChatRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)

    session_id = req.session_id or uuid.uuid4().hex

    full_text, _, _ = extract_text(doc.file_path, doc.file_type)
    if not full_text:
        raise HTTPException(status_code=400, detail="无法提取文档内容")

    history_result = await db.execute(
        select(ChatMessage)
        .where(
            ChatMessage.user_id == user.id,
            ChatMessage.document_id == doc_id,
            ChatMessage.session_id == session_id,
        )
        .order_by(ChatMessage.created_at.desc())
        .limit(10)
    )
    history_msgs = list(reversed(history_result.scalars().all()))
    history = [{"role": m.role, "content": m.content} for m in history_msgs]

    answer = await chat_with_document(
        question=req.question,
        doc_text=full_text,
        history=history,
    )

    user_msg = ChatMessage(
        user_id=user.id,
        document_id=doc_id,
        session_id=session_id,
        role="user",
        content=req.question,
    )
    assistant_msg = ChatMessage(
        user_id=user.id,
        document_id=doc_id,
        session_id=session_id,
        role="assistant",
        content=answer,
    )
    db.add(user_msg)
    db.add(assistant_msg)
    await db.flush()

    return ApiResponse.ok(data=ChatResponse(session_id=session_id, answer=answer))


@router.get("/history", response_model=ApiResponse[list[ChatMessageOut]])
async def get_chat_history(
    doc_id: int,
    session_id: str | None = Query(None),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_user_doc(doc_id, user.id, db)

    query = select(ChatMessage).where(
        ChatMessage.user_id == user.id,
        ChatMessage.document_id == doc_id,
    )
    if session_id:
        query = query.where(ChatMessage.session_id == session_id)
    query = query.order_by(ChatMessage.created_at.asc())

    result = await db.execute(query)
    messages = [
        ChatMessageOut(
            id=m.id,
            session_id=m.session_id,
            role=m.role,
            content=m.content,
            created_at=m.created_at.isoformat() if m.created_at else "",
        )
        for m in result.scalars().all()
    ]
    return ApiResponse.ok(data=messages)


@router.delete("/sessions/{session_id}", response_model=ApiResponse)
async def delete_chat_session(
    doc_id: int,
    session_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_user_doc(doc_id, user.id, db)

    await db.execute(
        delete(ChatMessage).where(
            ChatMessage.user_id == user.id,
            ChatMessage.document_id == doc_id,
            ChatMessage.session_id == session_id,
        )
    )
    return ApiResponse.ok(msg="会话已删除")
