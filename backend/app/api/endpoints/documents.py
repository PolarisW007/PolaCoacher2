import asyncio
import os
import uuid
from datetime import datetime, timezone
from math import ceil

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document import Document, DocumentGroup
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedData
from app.schemas.document import (
    DocumentGroupOut,
    DocumentMoveRequest,
    DocumentOut,
    GroupCreateRequest,
    GroupUpdateRequest,
    PublishRequest,
)
from app.services.doc_processor import process_document

router = APIRouter(prefix="/documents", tags=["文档"])


def _allowed_ext(filename: str) -> bool:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in settings.ALLOWED_EXTENSIONS


@router.post("/upload", response_model=ApiResponse[DocumentOut])
async def upload_document(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not file.filename or not _allowed_ext(file.filename):
        raise HTTPException(status_code=400, detail="不支持的文件格式")

    content = await file.read()
    if len(content) > settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=400, detail="文件大小超过限制")

    ext = file.filename.rsplit(".", 1)[-1].lower()
    stored_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = settings.UPLOAD_DIR / stored_name

    with open(file_path, "wb") as f:
        f.write(content)

    title = os.path.splitext(file.filename)[0]
    doc = Document(
        user_id=user.id,
        title=title,
        filename=file.filename,
        file_path=str(file_path),
        file_size=len(content),
        file_type=ext,
        source_type="upload",
        status="pending",
    )
    db.add(doc)
    await db.flush()
    doc_id = doc.id
    result = DocumentOut.model_validate(doc)

    async def _deferred_processing():
        await asyncio.sleep(1)
        await process_document(doc_id)

    asyncio.create_task(_deferred_processing())
    return ApiResponse.ok(data=result)


@router.get("/list", response_model=ApiResponse[PaginatedData[DocumentOut]])
async def list_documents(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = None,
    group_id: int | None = None,
    status_filter: str | None = Query(None, alias="status"),
    sort_by: str = Query("created_at", pattern="^(created_at|title|file_size)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Document).where(Document.user_id == user.id)
    count_query = select(func.count(Document.id)).where(Document.user_id == user.id)

    if search:
        query = query.where(Document.title.ilike(f"%{search}%"))
        count_query = count_query.where(Document.title.ilike(f"%{search}%"))
    if group_id is not None:
        query = query.where(Document.group_id == group_id)
        count_query = count_query.where(Document.group_id == group_id)
    if status_filter:
        query = query.where(Document.status == status_filter)
        count_query = count_query.where(Document.status == status_filter)

    total = (await db.execute(count_query)).scalar() or 0

    sort_col = getattr(Document, sort_by)
    query = query.order_by(sort_col.desc() if sort_order == "desc" else sort_col.asc())
    query = query.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(query)
    docs = [DocumentOut.model_validate(d) for d in result.scalars().all()]

    return ApiResponse.ok(
        data=PaginatedData(
            items=docs,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=ceil(total / page_size) if total else 0,
        )
    )


@router.get("/{doc_id}", response_model=ApiResponse[DocumentOut])
async def get_document(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)
    return ApiResponse.ok(data=DocumentOut.model_validate(doc))


@router.delete("/{doc_id}", response_model=ApiResponse)
async def delete_document(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)
    if os.path.exists(doc.file_path):
        os.remove(doc.file_path)
    await db.delete(doc)
    return ApiResponse.ok(msg="删除成功")


@router.put("/{doc_id}/move", response_model=ApiResponse[DocumentOut])
async def move_document(
    doc_id: int,
    req: DocumentMoveRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)
    if req.group_id is not None:
        grp = await db.execute(
            select(DocumentGroup).where(
                DocumentGroup.id == req.group_id, DocumentGroup.user_id == user.id
            )
        )
        if not grp.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="分组不存在")
    doc.group_id = req.group_id
    return ApiResponse.ok(data=DocumentOut.model_validate(doc))


@router.post("/{doc_id}/publish", response_model=ApiResponse[DocumentOut])
async def publish_lecture(
    doc_id: int,
    req: PublishRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)
    if doc.status != "ready":
        raise HTTPException(status_code=400, detail="文档尚未处理完成，请等待 AI 处理就绪后再发布")
    doc.lecture_visibility = "public"
    doc.published_at = datetime.now(timezone.utc)
    if req.title:
        doc.title = req.title
    if req.description:
        doc.description = req.description
    if req.tags:
        doc.tags = req.tags
    return ApiResponse.ok(data=DocumentOut.model_validate(doc))


@router.post("/{doc_id}/unpublish", response_model=ApiResponse[DocumentOut])
async def unpublish_lecture(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)
    doc.lecture_visibility = "private"
    doc.published_at = None
    return ApiResponse.ok(data=DocumentOut.model_validate(doc))


async def _get_user_doc(doc_id: int, user_id: int, db: AsyncSession) -> Document:
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return doc
