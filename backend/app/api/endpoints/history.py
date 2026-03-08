from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document import Document
from app.models.social import ReadingHistory
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedData

router = APIRouter(prefix="/history", tags=["历史记录"])


class RecordHistoryRequest(BaseModel):
    document_id: int
    action: str
    last_page: int = 0
    duration_seconds: int = 0


class HistoryDocInfo(BaseModel):
    id: int
    title: str
    file_type: str
    cover_url: str | None = None
    page_count: int = 0


class HistoryOut(BaseModel):
    id: int
    document_id: int
    action: str
    last_page: int
    duration_seconds: int
    created_at: str
    updated_at: str
    document: HistoryDocInfo | None = None

    model_config = {"from_attributes": True}


@router.get("", response_model=ApiResponse[PaginatedData[HistoryOut]])
async def list_history(
    action: str = Query("all", pattern="^(read|play|all)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    base_where = [ReadingHistory.user_id == user.id]
    if action != "all":
        base_where.append(ReadingHistory.action == action)

    count_query = select(func.count(ReadingHistory.id)).where(*base_where)
    total = (await db.execute(count_query)).scalar() or 0

    query = (
        select(ReadingHistory, Document)
        .outerjoin(Document, ReadingHistory.document_id == Document.id)
        .where(*base_where)
        .order_by(ReadingHistory.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    rows = result.all()

    items = []
    for history, doc in rows:
        doc_info = None
        if doc:
            doc_info = HistoryDocInfo(
                id=doc.id,
                title=doc.title,
                file_type=doc.file_type,
                cover_url=doc.cover_url,
                page_count=doc.page_count,
            )
        items.append(
            HistoryOut(
                id=history.id,
                document_id=history.document_id,
                action=history.action,
                last_page=history.last_page,
                duration_seconds=history.duration_seconds,
                created_at=history.created_at.isoformat() if history.created_at else "",
                updated_at=history.updated_at.isoformat() if history.updated_at else "",
                document=doc_info,
            )
        )

    return ApiResponse.ok(
        data=PaginatedData(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=ceil(total / page_size) if total else 0,
        )
    )


@router.post("/record", response_model=ApiResponse[HistoryOut])
async def record_history(
    req: RecordHistoryRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.action not in ("read", "play"):
        raise HTTPException(status_code=400, detail="action 必须为 read 或 play")

    doc_result = await db.execute(
        select(Document).where(Document.id == req.document_id)
    )
    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")

    existing_result = await db.execute(
        select(ReadingHistory).where(
            and_(
                ReadingHistory.user_id == user.id,
                ReadingHistory.document_id == req.document_id,
                ReadingHistory.action == req.action,
            )
        )
    )
    history = existing_result.scalar_one_or_none()

    if history:
        history.last_page = req.last_page
        history.duration_seconds = history.duration_seconds + req.duration_seconds
    else:
        history = ReadingHistory(
            user_id=user.id,
            document_id=req.document_id,
            action=req.action,
            last_page=req.last_page,
            duration_seconds=req.duration_seconds,
        )
        db.add(history)

    await db.flush()

    doc_info = HistoryDocInfo(
        id=doc.id,
        title=doc.title,
        file_type=doc.file_type,
        cover_url=doc.cover_url,
        page_count=doc.page_count,
    )

    return ApiResponse.ok(
        data=HistoryOut(
            id=history.id,
            document_id=history.document_id,
            action=history.action,
            last_page=history.last_page,
            duration_seconds=history.duration_seconds,
            created_at=history.created_at.isoformat() if history.created_at else "",
            updated_at=history.updated_at.isoformat() if history.updated_at else "",
            document=doc_info,
        )
    )


@router.delete("/{history_id}", response_model=ApiResponse)
async def delete_history(
    history_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ReadingHistory).where(
            ReadingHistory.id == history_id, ReadingHistory.user_id == user.id
        )
    )
    history = result.scalar_one_or_none()
    if not history:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="记录不存在")

    await db.delete(history)
    return ApiResponse.ok(msg="记录已删除")
