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
from app.core.deps import get_current_user, get_optional_user
from app.models.document import Document, DocumentGroup
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedData
from app.schemas.document import (
    BookImportRequest,
    DocumentGroupOut,
    DocumentMoveRequest,
    DocumentOut,
    GroupCreateRequest,
    GroupUpdateRequest,
    ImportUrlRequest,
    PublishRequest,
)
from app.services.doc_processor import generate_lecture_for_document, process_document

router = APIRouter(prefix="/documents", tags=["文档"])


def _allowed_ext(filename: str) -> bool:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in settings.ALLOWED_EXTENSIONS


# ---- 固定路径路由必须在 /{doc_id} 之前，否则会被路径参数拦截 ----


@router.get("/book-search", response_model=ApiResponse)
async def book_search(
    query: str = Query(..., min_length=1),
    language: str | None = None,
    format: str | None = None,
    page: int = Query(1, ge=1),
    user: User = Depends(get_current_user),
):
    """使用微信读书公开搜索 API 查询书籍元数据"""
    import httpx as _httpx

    try:
        count = 20
        max_idx = (page - 1) * count

        async with _httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            resp = await client.get(
                "https://weread.qq.com/web/search/global",
                params={
                    "keyword": query,
                    "maxIdx": max_idx,
                    "lang": "zh" if not language else language,
                    "count": count,
                },
                headers={
                    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
                    "Referer": "https://weread.qq.com/",
                },
            )
            if resp.status_code != 200:
                return ApiResponse.ok(data={"results": [], "total": 0, "page": page})
            data = resp.json()

        books = data.get("books", [])
        results = []
        for item in books:
            bi = item.get("bookInfo", {})
            if not bi.get("title"):
                continue
            cover = bi.get("cover", "")
            # 微信读书封面 URL 补全
            if cover and not cover.startswith("http"):
                cover = f"https:{cover}"
            results.append({
                "title": bi.get("title", ""),
                "author": bi.get("author", ""),
                "isbn": bi.get("isbn") or "",
                "publisher": bi.get("publisher", ""),
                "publish_year": bi.get("publishTime", "")[:4] if bi.get("publishTime") else None,
                "language": "zh",
                "cover_url": cover or None,
                "intro": (bi.get("intro") or "")[:200],
                "link": f"https://weread.qq.com/web/bookDetail/{bi.get('bookId', '')}",
                "source": "weread",
            })

        total = data.get("total", len(results))
        return ApiResponse.ok(data={"results": results, "total": total, "page": page})
    except Exception as e:
        return ApiResponse.ok(data={"results": [], "total": 0, "page": page, "error": str(e)})


@router.post("/book-import", response_model=ApiResponse)
async def book_import(
    req: BookImportRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.social import BookImportTask

    if req.isbn:
        existing = await db.execute(
            select(Document).where(Document.isbn == req.isbn, Document.user_id == user.id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="该书已在书架中")

    has_download = bool(req.download_url and req.download_url.startswith("http"))

    doc = Document(
        user_id=user.id,
        title=req.title,
        filename=f"{req.title}.pdf",
        file_path="",
        file_size=req.file_size,
        file_type="pdf",
        source_type="book_search",
        source_url=req.download_url or "",
        isbn=req.isbn,
        author=req.author,
        publisher=req.publisher,
        publish_year=req.publish_year,
        language=req.language,
        cover_url=req.cover_url or None,  # 直接复用书籍搜索返回的封面 URL
        status="importing" if has_download else "error",
    )
    db.add(doc)
    await db.flush()

    if not has_download:
        # 仅保存元数据，无法自动下载，返回提示让用户手动上传
        await db.commit()
        return ApiResponse.ok(
            data={"document_id": doc.id},
            msg="书籍元数据已保存，请在书架中手动上传 PDF 文件",
        )

    task = BookImportTask(
        user_id=user.id,
        document_id=doc.id,
        isbn=req.isbn,
        title=req.title,
        author=req.author,
        download_url=req.download_url,
        file_size=req.file_size,
        status="pending",
    )
    db.add(task)
    await db.flush()

    async def _download_and_process(task_id: int, doc_id: int):
        from app.core.database import async_session_factory
        import httpx as _httpx
        async with async_session_factory() as s:
            try:
                t = (await s.execute(select(BookImportTask).where(BookImportTask.id == task_id))).scalar_one()
                d = (await s.execute(select(Document).where(Document.id == doc_id))).scalar_one()
                t.status = "downloading"
                t.progress = 10
                await s.commit()

                stored_name = f"{uuid.uuid4().hex}.pdf"
                file_path = settings.UPLOAD_DIR / stored_name
                async with _httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                    resp = await client.get(t.download_url)
                    resp.raise_for_status()
                    with open(file_path, "wb") as f:
                        f.write(resp.content)

                d.file_path = str(file_path)
                d.file_size = len(resp.content)
                d.status = "pending"
                t.status = "processing"
                t.progress = 50
                await s.commit()

                await process_document(doc_id)
                t.status = "done"
                t.progress = 100
                await s.commit()
            except Exception as e:
                try:
                    t2 = (await s.execute(select(BookImportTask).where(BookImportTask.id == task_id))).scalar_one_or_none()
                    d2 = (await s.execute(select(Document).where(Document.id == doc_id))).scalar_one_or_none()
                    if t2:
                        t2.status = "error"
                        t2.error_message = str(e)[:500]
                    if d2:
                        d2.status = "error"
                    await s.commit()
                except Exception:
                    pass

    asyncio.create_task(_download_and_process(task.id, doc.id))
    return ApiResponse.ok(data={"task_id": task.id, "document_id": doc.id}, msg="导入任务已创建")


@router.get("/book-import/{task_id}/status", response_model=ApiResponse)
async def book_import_status(
    task_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.social import BookImportTask
    result = await db.execute(
        select(BookImportTask).where(BookImportTask.id == task_id, BookImportTask.user_id == user.id)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在")
    return ApiResponse.ok(data={
        "task_id": task.id,
        "status": task.status,
        "progress": task.progress,
        "error_message": task.error_message,
        "document_id": task.document_id,
    })


@router.post("/book-import/{task_id}/retry", response_model=ApiResponse)
async def retry_book_import(
    task_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.social import BookImportTask
    result = await db.execute(
        select(BookImportTask).where(
            BookImportTask.id == task_id, BookImportTask.user_id == user.id, BookImportTask.status == "error"
        )
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="任务不存在或无法重试")
    task.status = "pending"
    task.progress = 0
    task.error_message = None
    return ApiResponse.ok(msg="重试已启动")


@router.get("/check-isbn/{isbn}", response_model=ApiResponse)
async def check_isbn(
    isbn: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Document).where(Document.isbn == isbn, Document.user_id == user.id)
    )
    exists = result.scalar_one_or_none() is not None
    return ApiResponse.ok(data={"exists": exists, "isbn": isbn})


@router.post("/import-url", response_model=ApiResponse[DocumentOut])
async def import_url(
    req: ImportUrlRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import httpx as _httpx

    title = req.title or req.url.split("/")[-1] or "导入文档"
    ext = "pdf"
    if req.url.endswith(".docx"):
        ext = "docx"
    elif req.url.endswith(".txt"):
        ext = "txt"
    elif req.url.endswith(".md"):
        ext = "md"

    stored_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = settings.UPLOAD_DIR / stored_name

    try:
        async with _httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            resp = await client.get(req.url)
            resp.raise_for_status()
            content = resp.content
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"URL 下载失败: {e}")

    with open(file_path, "wb") as f:
        f.write(content)

    doc = Document(
        user_id=user.id,
        title=title,
        filename=f"{title}.{ext}",
        file_path=str(file_path),
        file_size=len(content),
        file_type=ext,
        source_type="url",
        source_url=req.url,
        status="pending",
    )
    db.add(doc)
    await db.flush()
    doc_id = doc.id
    result = DocumentOut.model_validate(doc)

    async def _deferred():
        await asyncio.sleep(1)
        await process_document(doc_id)

    asyncio.create_task(_deferred())
    return ApiResponse.ok(data=result)


# ---- 以下路由带 {doc_id} 路径参数 ----


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


@router.get("/{doc_id}/lecture", response_model=ApiResponse)
async def get_lecture(
    doc_id: int,
    page: int = Query(default=None, ge=0, description="起始页码(0-based)，不传返回全部"),
    page_size: int = Query(default=5, ge=1, le=50),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)
    if not doc.lecture_slides:
        raise HTTPException(status_code=404, detail="讲解尚未生成")
    all_slides = doc.lecture_slides if isinstance(doc.lecture_slides, list) else []
    total = len(all_slides)

    if page is not None:
        start = page
        end = min(start + page_size, total)
        slides = all_slides[start:end]
    else:
        slides = all_slides

    return ApiResponse.ok(data={
        "slides": slides,
        "total_pages": total,
        "page": page,
        "page_size": page_size if page is not None else total,
    })


@router.get("/{doc_id}/pdf")
async def get_pdf(
    doc_id: int,
    token: str | None = Query(None, description="URL 中直接携带 JWT，供 iframe 使用"),
    user: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
):
    from fastapi.responses import FileResponse
    from app.core.security import decode_access_token
    from sqlalchemy import select as _select

    # 若 OAuth2 Bearer 未提供，则尝试从 query param 中读取 token
    if user is None and token:
        payload = decode_access_token(token)
        if payload:
            user_id_str = payload.get("sub")
            if user_id_str:
                result = await db.execute(_select(User).where(User.id == int(user_id_str)))
                user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(status_code=401, detail="未登录")

    doc = await _get_user_doc(doc_id, user.id, db)
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(
        doc.file_path,
        media_type="application/pdf" if doc.file_type == "pdf" else "application/octet-stream",
        filename=doc.filename,
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.post("/{doc_id}/generate-cover", response_model=ApiResponse)
async def trigger_cover_generation(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """手动触发/重新生成文档封面图（异步，立即返回）"""
    doc = await _get_user_doc(doc_id, user.id, db)

    # 检查是否已有封面
    if doc.cover_url:
        cover_filename = f"doc_{doc_id}_cover.png"
        cover_path = settings.COVER_DIR / cover_filename
        if cover_path.exists():
            return ApiResponse.ok(
                data={"cover_url": doc.cover_url, "status": "cached"},
                message="封面图已存在，直接使用缓存",
            )

    # 异步触发生成
    from app.services.doc_processor import _generate_cover_for_doc
    asyncio.create_task(_generate_cover_for_doc(doc_id))

    return ApiResponse.ok(
        data={"cover_url": None, "status": "generating"},
        message="封面图正在生成，稍后刷新即可看到",
    )


@router.post("/{doc_id}/completion-card", response_model=ApiResponse)
async def generate_completion_card(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """读完文章后生成总结卡片（AI读后感文字 + 异步封面图）"""
    from app.services.ai_service import generate_cover_image, _call_qwen

    doc = await _get_user_doc(doc_id, user.id, db)

    summary = doc.summary or ""
    key_points = doc.key_points or []
    kp_list = key_points if isinstance(key_points, list) else []
    title = doc.title or "本文"

    # 生成读后感（文字部分，快速返回）
    if not summary:
        completion_text = f"🎉 恭喜完成《{title}》的阅读！"
    else:
        kp_text = "\n".join(f"- {p}" for p in kp_list[:5])
        prompt = (
            f"我刚刚读完了《{title}》。\n"
            f"文档摘要：{summary[:400]}\n"
            f"核心要点：\n{kp_text}\n\n"
            f"请用80字以内，以第一人称写一段读后感，适合分享到朋友圈或小红书，"
            f"语气积极向上，带1-2个相关emoji，不要使用#话题标签。"
        )
        completion_text = await _call_qwen(prompt, system="你是善于写读书心得的文案达人，语言简洁有温度。")

    # 检查是否有缓存图
    cover_filename = f"completion_{doc_id}_{user.id}.png"
    cover_path = settings.COVER_DIR / cover_filename
    if cover_path.exists():
        cover_url = f"/covers/{cover_filename}"
    else:
        # 后台异步生成图片（不阻塞响应）
        img_prompt = (
            f"读书完成卡片，书名《{title}》，简约书签风格，暖色调，"
            f"书本和星光元素，高品质插画，适合社交媒体分享"
        )

        async def _gen_bg():
            await generate_cover_image(img_prompt, str(settings.COVER_DIR), cover_filename)

        asyncio.create_task(_gen_bg())
        cover_url = None  # 前端轮询或使用默认

    # 无论图片是否就绪，都返回预期的轮询 URL，让前端直接用
    expected_cover_url = f"/covers/{cover_filename}"

    return ApiResponse.ok(data={
        "title": title,
        "completion_text": completion_text,
        "cover_url": cover_url,                    # 已就绪时有值，否则 None
        "expected_cover_url": expected_cover_url,  # 固定返回，前端用于轮询
        "cover_ready": cover_url is not None,
        "summary": summary,
        "key_points": kp_list[:5],
    })


@router.post("/{doc_id}/generate-lecture", response_model=ApiResponse)
async def generate_lecture(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """手动触发讲解生成"""
    doc = await _get_user_doc(doc_id, user.id, db)
    if not doc.ppt_content:
        raise HTTPException(status_code=400, detail="文档尚未完成AI处理，请先等待")
    if doc.lecture_slides:
        return ApiResponse.ok(msg="讲解已生成")

    asyncio.create_task(generate_lecture_for_document(doc_id))
    return ApiResponse.ok(msg="讲解生成已启动，请稍候")


@router.get("/{doc_id}/file-url")
async def get_file_url(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """获取文档文件的可访问 URL"""
    doc = await _get_user_doc(doc_id, user.id, db)
    filename = os.path.basename(doc.file_path)
    return ApiResponse.ok(data={
        "url": f"/uploads/{filename}",
        "file_type": doc.file_type,
        "filename": doc.filename,
    })


async def _get_user_doc(doc_id: int, user_id: int, db: AsyncSession) -> Document:
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return doc
