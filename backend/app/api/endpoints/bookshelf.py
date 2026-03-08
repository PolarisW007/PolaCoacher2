import os
from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document import Document, DocumentGroup
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedData

router = APIRouter(prefix="/bookshelf", tags=["书架"])


class BookshelfDocOut(BaseModel):
    id: int
    title: str
    filename: str
    file_type: str
    file_size: int
    status: str
    progress: float
    page_count: int
    cover_url: str | None = None
    group_id: int | None = None
    summary: str | None = None
    created_at: str

    model_config = {"from_attributes": True}


class AddToBookshelfRequest(BaseModel):
    document_id: int


class BatchOperationRequest(BaseModel):
    doc_ids: list[int]
    action: str
    group_id: int | None = None


class MoveDocumentRequest(BaseModel):
    group_id: int | None = None


@router.get("/list", response_model=ApiResponse[PaginatedData[BookshelfDocOut]])
async def bookshelf_list(
    tab: str = Query("default", pattern="^(default|lecture|document|group)$"),
    group_id: int | None = None,
    search: str | None = None,
    sort_by: str = Query("created_at", pattern="^(created_at|title|file_size)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Document).where(Document.user_id == user.id)
    count_query = select(func.count(Document.id)).where(Document.user_id == user.id)

    if tab == "lecture":
        query = query.where(Document.status == "ready")
        count_query = count_query.where(Document.status == "ready")
    elif tab == "group":
        if group_id is None:
            raise HTTPException(status_code=400, detail="分组模式需要提供 group_id")
        query = query.where(Document.group_id == group_id)
        count_query = count_query.where(Document.group_id == group_id)

    if group_id is not None and tab != "group":
        query = query.where(Document.group_id == group_id)
        count_query = count_query.where(Document.group_id == group_id)

    if search:
        query = query.where(Document.title.ilike(f"%{search}%"))
        count_query = count_query.where(Document.title.ilike(f"%{search}%"))

    total = (await db.execute(count_query)).scalar() or 0

    sort_col = getattr(Document, sort_by)
    query = query.order_by(sort_col.desc() if sort_order == "desc" else sort_col.asc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    docs = [
        BookshelfDocOut(
            id=d.id,
            title=d.title,
            filename=d.filename,
            file_type=d.file_type,
            file_size=d.file_size,
            status=d.status,
            progress=d.progress,
            page_count=d.page_count,
            cover_url=d.cover_url,
            group_id=d.group_id,
            summary=d.summary,
            created_at=d.created_at.isoformat() if d.created_at else "",
        )
        for d in result.scalars().all()
    ]

    return ApiResponse.ok(
        data=PaginatedData(
            items=docs,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=ceil(total / page_size) if total else 0,
        )
    )


@router.post("/add", response_model=ApiResponse[BookshelfDocOut])
async def add_to_bookshelf(
    req: AddToBookshelfRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(Document.id == req.document_id)
    )
    source_doc = result.scalar_one_or_none()
    if not source_doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")

    if source_doc.user_id == user.id:
        raise HTTPException(status_code=400, detail="不能收藏自己的文档")

    existing = await db.execute(
        select(Document).where(
            Document.user_id == user.id,
            Document.source_url == f"favorite:{source_doc.id}",
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="该文档已在书架中")

    new_doc = Document(
        user_id=user.id,
        title=source_doc.title,
        filename=source_doc.filename,
        file_path=source_doc.file_path,
        file_size=source_doc.file_size,
        file_type=source_doc.file_type,
        source_type="favorite",
        source_url=f"favorite:{source_doc.id}",
        page_count=source_doc.page_count,
        word_count=source_doc.word_count,
        summary=source_doc.summary,
        key_points=source_doc.key_points,
        ppt_content=source_doc.ppt_content,
        lecture_slides=source_doc.lecture_slides,
        status=source_doc.status,
        progress=source_doc.progress,
        cover_url=source_doc.cover_url,
    )
    db.add(new_doc)
    await db.flush()

    return ApiResponse.ok(
        data=BookshelfDocOut(
            id=new_doc.id,
            title=new_doc.title,
            filename=new_doc.filename,
            file_type=new_doc.file_type,
            file_size=new_doc.file_size,
            status=new_doc.status,
            progress=new_doc.progress,
            page_count=new_doc.page_count,
            cover_url=new_doc.cover_url,
            group_id=new_doc.group_id,
            summary=new_doc.summary,
            created_at=new_doc.created_at.isoformat() if new_doc.created_at else "",
        )
    )


@router.delete("/remove/{doc_id}", response_model=ApiResponse)
async def remove_from_bookshelf(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")

    if os.path.exists(doc.file_path) and doc.source_type != "favorite":
        os.remove(doc.file_path)

    await db.delete(doc)
    return ApiResponse.ok(msg="已从书架移除")


@router.put("/documents/batch", response_model=ApiResponse)
async def batch_operation(
    req: BatchOperationRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.action not in ("delete", "move_group"):
        raise HTTPException(status_code=400, detail="不支持的操作类型")

    result = await db.execute(
        select(Document).where(
            Document.id.in_(req.doc_ids), Document.user_id == user.id
        )
    )
    docs = result.scalars().all()

    if not docs:
        raise HTTPException(status_code=404, detail="未找到匹配的文档")

    if req.action == "delete":
        for doc in docs:
            if os.path.exists(doc.file_path) and doc.source_type != "favorite":
                os.remove(doc.file_path)
            await db.delete(doc)
        return ApiResponse.ok(msg=f"已删除 {len(docs)} 个文档")

    if req.action == "move_group":
        if req.group_id is not None:
            grp_result = await db.execute(
                select(DocumentGroup).where(
                    DocumentGroup.id == req.group_id,
                    DocumentGroup.user_id == user.id,
                )
            )
            if not grp_result.scalar_one_or_none():
                raise HTTPException(status_code=404, detail="分组不存在")
        for doc in docs:
            doc.group_id = req.group_id
        return ApiResponse.ok(msg=f"已移动 {len(docs)} 个文档")

    return ApiResponse.ok()


@router.put("/documents/{doc_id}/move", response_model=ApiResponse)
async def move_document(
    doc_id: int,
    req: MoveDocumentRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")

    if req.group_id is not None:
        grp_result = await db.execute(
            select(DocumentGroup).where(
                DocumentGroup.id == req.group_id,
                DocumentGroup.user_id == user.id,
            )
        )
        if not grp_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="分组不存在")

    doc.group_id = req.group_id
    return ApiResponse.ok(msg="文档已移动")
