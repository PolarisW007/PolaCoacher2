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


def _parse_annas_archive_html(html_text: str) -> list[dict]:
    """解析 Anna's Archive 搜索结果 HTML，提取书籍信息"""
    import re
    from html import unescape

    results = []
    seen_md5: set[str] = set()

    for md5_match in re.finditer(r'href="/md5/([a-f0-9]{32})"', html_text):
        md5 = md5_match.group(1)
        if md5 in seen_md5:
            continue
        seen_md5.add(md5)

        pos = md5_match.start()
        block_start = html_text.rfind('<div', max(0, pos - 2000), pos)
        block_end = html_text.find('base score:', pos)
        if block_start < 0:
            block_start = max(0, pos - 1500)
        if block_end < 0:
            block_end = min(len(html_text), pos + 2000)
        block = html_text[block_start:block_end + 200]

        title_m = re.search(
            r'<a[^>]+href="/md5/' + md5 + r'"[^>]*>([^<]+)</a>', block
        )
        title = unescape(title_m.group(1).strip()) if title_m else ""
        if not title:
            continue

        author = ""
        author_m = re.search(
            r'<a[^>]+href="/search\?q=[^"]*"[^>]*>([^<]+)</a>', block
        )
        if author_m:
            author = unescape(author_m.group(1).strip())

        publisher = ""
        pub_matches = re.findall(
            r'<a[^>]+href="/search\?q=[^"]*"[^>]*>([^<]+)</a>', block
        )
        if len(pub_matches) > 1:
            publisher = unescape(pub_matches[1].strip())

        meta_m = re.search(
            r'([\w\s]+\[[\w-]+\])\s*·\s*(\w+)\s*·\s*([\d.]+\s*[KMGT]?B)'
            r'\s*·?\s*(\d{4})?',
            block,
        )
        lang_str = meta_m.group(1).strip() if meta_m else ""
        file_type = meta_m.group(2).strip().lower() if meta_m else ""
        file_size = meta_m.group(3).strip() if meta_m else ""
        year = meta_m.group(4) if meta_m and meta_m.group(4) else ""

        cover_url = ""
        cover_m = re.search(r'<img[^>]+src="(https?://[^"]+)"', block)
        if cover_m:
            cover_url = cover_m.group(1)

        isbn = ""
        isbn_m = re.search(r'"isbns":\["(\d{10,13})"', block)
        if isbn_m:
            isbn = isbn_m.group(1)

        results.append({
            "md5": md5,
            "title": title,
            "author": author,
            "isbn": isbn,
            "publisher": publisher,
            "publish_year": int(year) if year and year.isdigit() else None,
            "language": lang_str.split("[")[0].strip() if lang_str else "",
            "cover_url": cover_url or None,
            "file_type": file_type,
            "file_size": file_size,
            "link": f"https://annas-archive.gl/md5/{md5}",
            "source": "annas_archive",
            "download_available": file_type == "pdf",
        })
    return results


@router.get("/book-search", response_model=ApiResponse)
async def book_search(
    query: str = Query(..., min_length=1),
    language: str | None = None,
    format: str | None = None,
    page: int = Query(1, ge=1),
    user: User = Depends(get_current_user),
):
    """通过 Anna's Archive 搜索书籍（多路径尝试）"""
    import httpx as _httpx
    import logging
    from urllib.parse import quote

    _log = logging.getLogger(__name__)
    encoded_query = quote(query)

    search_urls = [
        f"https://annas-archive.gl/search?q={encoded_query}&ext=pdf",
        f"https://annas-archive.se/search?q={encoded_query}&ext=pdf",
        f"https://annas-archive.org/search?q={encoded_query}&ext=pdf",
    ]

    proxy_templates = [
        "https://api.allorigins.win/raw?url={url}",
        "https://api.codetabs.com/v1/proxy?quest={url}",
    ]

    all_urls = []
    for su in search_urls:
        all_urls.append(su)
    for su in search_urls[:1]:
        for pt in proxy_templates:
            all_urls.append(pt.format(url=quote(su)))

    _log.info(f"[BookSearch] query='{query}', trying {len(all_urls)} URLs")
    html_text = ""

    for url in all_urls:
        try:
            async with _httpx.AsyncClient(
                timeout=15, follow_redirects=True, verify=False
            ) as client:
                resp = await client.get(
                    url,
                    headers={
                        "User-Agent": (
                            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                            "AppleWebKit/537.36"
                        ),
                    },
                )
                if resp.status_code == 200 and '/md5/' in resp.text:
                    html_text = resp.text
                    _log.info(f"[BookSearch] Success via {url[:60]}...")
                    break
        except Exception as e:
            _log.debug(f"[BookSearch] Failed {url[:50]}: {e}")
            continue

    if not html_text:
        _log.warning("[BookSearch] All sources failed, returning empty")
        return ApiResponse.ok(
            data={"results": [], "total": 0, "page": page,
                  "search_url": f"https://annas-archive.gl/search?q={encoded_query}&ext=pdf",
                  "error": "搜索服务暂时不可用，请在浏览器中打开链接手动搜索"}
        )

    results = _parse_annas_archive_html(html_text)
    _log.info(f"[BookSearch] Found {len(results)} results for '{query}'")
    return ApiResponse.ok(
        data={"results": results, "total": len(results), "page": page}
    )


@router.post("/book-import", response_model=ApiResponse)
async def book_import(
    req: BookImportRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.models.social import BookImportTask
    import logging
    _log = logging.getLogger(__name__)

    if req.isbn:
        existing = await db.execute(
            select(Document).where(Document.isbn == req.isbn, Document.user_id == user.id)
        )
        if existing.scalar_one_or_none():
            raise HTTPException(status_code=400, detail="该书已在书架中")

    can_auto_download = bool(req.md5 and len(req.md5) == 32)
    has_direct_url = bool(req.download_url and req.download_url.startswith("http"))

    source_url = ""
    if req.md5:
        source_url = f"https://annas-archive.gl/md5/{req.md5}"
    elif req.download_url:
        source_url = req.download_url

    doc = Document(
        user_id=user.id,
        title=req.title,
        filename=f"{req.title}.pdf",
        file_path="",
        file_size=req.file_size,
        file_type="pdf",
        source_type=req.source or "book_search",
        source_url=source_url,
        isbn=req.isbn,
        author=req.author,
        publisher=req.publisher,
        publish_year=req.publish_year,
        language=req.language,
        cover_url=req.cover_url or None,
        status="importing" if (can_auto_download or has_direct_url) else "pending_upload",
    )
    db.add(doc)
    await db.flush()

    if not can_auto_download and not has_direct_url:
        await db.commit()
        return ApiResponse.ok(
            data={"document_id": doc.id},
            msg="书籍已添加到书架，请上传对应的 PDF 文件",
        )

    download_url = req.download_url or ""
    task = BookImportTask(
        user_id=user.id,
        document_id=doc.id,
        isbn=req.isbn,
        title=req.title,
        author=req.author,
        download_url=download_url,
        file_size=req.file_size,
        status="pending",
    )
    db.add(task)
    await db.commit()

    async def _download_and_process(task_id: int, doc_id: int, md5: str | None):
        from app.core.database import async_session_factory
        import httpx as _httpx
        import re as _re

        async with async_session_factory() as s:
            try:
                t = (await s.execute(select(BookImportTask).where(BookImportTask.id == task_id))).scalar_one()
                d = (await s.execute(select(Document).where(Document.id == doc_id))).scalar_one()
                t.status = "downloading"
                t.progress = 10
                await s.commit()

                stored_name = f"{uuid.uuid4().hex}.pdf"
                file_path = settings.UPLOAD_DIR / stored_name
                content = None
                _ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

                if md5:
                    from urllib.parse import quote as _quote

                    _log.info(f"[BookImport] 从 Libgen 下载 md5={md5}")
                    ads_html = ""
                    libgen_ads_url = f"https://libgen.li/ads.php?md5={md5}"
                    ads_urls = [
                        f"https://api.codetabs.com/v1/proxy/?quest={_quote(libgen_ads_url, safe='')}",
                        libgen_ads_url,
                        f"https://api.allorigins.win/raw?url={_quote(libgen_ads_url, safe='')}",
                    ]
                    for ads_url in ads_urls:
                        try:
                            async with _httpx.AsyncClient(timeout=30, follow_redirects=True, verify=False) as client:
                                ads_resp = await client.get(ads_url, headers={"User-Agent": _ua})
                                if ads_resp.status_code == 200 and 'get.php' in ads_resp.text:
                                    ads_html = ads_resp.text
                                    _log.info(f"[BookImport] Libgen 页面获取成功 via {ads_url[:60]}")
                                    break
                        except Exception as ex:
                            _log.debug(f"[BookImport] ads.php 失败 {ads_url[:50]}: {ex}")
                            continue

                    if not ads_html:
                        raise ValueError(f"无法访问 Libgen（md5={md5}）")

                    get_m = _re.search(
                        r'(?:href="|)(get\.php\?md5=[a-f0-9]+&key=[^"&\s]+)',
                        ads_html,
                    )
                    if not get_m:
                        raise ValueError("无法从 Libgen 页面解析下载链接")

                    get_path = get_m.group(1)
                    t.progress = 30
                    await s.commit()

                    libgen_get_url = f"https://libgen.li/{get_path}"

                    cdn_url = None
                    try:
                        async with _httpx.AsyncClient(timeout=15, follow_redirects=False, verify=False) as client:
                            redir_resp = await client.get(libgen_get_url, headers={"User-Agent": _ua})
                            if redir_resp.status_code in (301, 302, 307, 308):
                                cdn_url = redir_resp.headers.get("location")
                                _log.info(f"[BookImport] CDN redirect: {cdn_url[:80] if cdn_url else 'None'}")
                    except Exception:
                        pass

                    if not cdn_url:
                        proxy_redir_url = f"https://api.codetabs.com/v1/proxy/?quest={libgen_get_url}"
                        try:
                            async with _httpx.AsyncClient(timeout=15, follow_redirects=False, verify=False) as client:
                                pr = await client.get(proxy_redir_url, headers={"User-Agent": _ua})
                                loc = pr.headers.get("location")
                                if loc:
                                    cdn_url = loc
                        except Exception:
                            pass

                    download_urls = []
                    if cdn_url:
                        download_urls.append(f"https://api.codetabs.com/v1/proxy/?quest={_quote(cdn_url, safe='')}")
                        download_urls.append(cdn_url)
                    download_urls.append(f"https://api.codetabs.com/v1/proxy/?quest={_quote(libgen_get_url, safe='')}")
                    download_urls.append(libgen_get_url)
                    content = None
                    for dl_url in download_urls:
                        try:
                            _log.info(f"[BookImport] 尝试下载: {dl_url[:80]}")
                            async with _httpx.AsyncClient(timeout=300, follow_redirects=True, verify=False) as client:
                                resp = await client.get(dl_url, headers={"User-Agent": _ua})
                                resp.raise_for_status()
                                if len(resp.content) > 1024 and resp.content[:5].startswith(b"%PDF"):
                                    content = resp.content
                                    _log.info(f"[BookImport] 下载成功 size={len(content)}")
                                    break
                                else:
                                    _log.warning(f"[BookImport] 响应不是 PDF: size={len(resp.content)}, head={resp.content[:10]!r}")
                        except Exception as ex:
                            _log.warning(f"[BookImport] 下载失败 {dl_url[:60]}: {ex}")
                            continue

                    if not content:
                        raise ValueError(f"所有下载路径均失败（md5={md5}）")
                else:
                    _log.info(f"[BookImport] 直接下载: url={t.download_url}")
                    async with _httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                        resp = await client.get(t.download_url, headers={"User-Agent": _ua})
                        resp.raise_for_status()
                        content = resp.content

                if not content[:5].startswith(b"%PDF"):
                    raise ValueError(
                        f"文件头不是 PDF 格式（前4字节: {content[:4]!r}，size: {len(content)}）"
                    )

                with open(file_path, "wb") as f:
                    f.write(content)

                _log.info(f"[BookImport] 下载完成: task={task_id}, size={len(content)}, path={file_path}")
                d.file_path = str(file_path)
                d.file_size = len(content)
                d.status = "pending"
                t.status = "processing"
                t.progress = 50
                await s.commit()

                await process_document(doc_id)
                t.status = "done"
                t.progress = 100
                await s.commit()
                _log.info(f"[BookImport] 处理完成: task={task_id}, doc={doc_id}")
            except Exception as e:
                _log.error(f"[BookImport] 失败: task={task_id}, doc={doc_id}, error={e}")
                try:
                    t2 = (await s.execute(select(BookImportTask).where(BookImportTask.id == task_id))).scalar_one_or_none()
                    d2 = (await s.execute(select(Document).where(Document.id == doc_id))).scalar_one_or_none()
                    if t2:
                        t2.status = "error"
                        t2.error_message = str(e)[:500]
                    if d2:
                        d2.status = "pending_upload"
                    await s.commit()
                except Exception:
                    pass

    asyncio.create_task(_download_and_process(task.id, doc.id, req.md5))
    return ApiResponse.ok(data={"task_id": task.id, "document_id": doc.id}, msg="导入任务已创建，正在自动下载 PDF")


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


@router.post("/{doc_id}/upload-pdf", response_model=ApiResponse)
async def upload_pdf_for_existing(
    doc_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """为已有的 pending_upload 文档补充上传 PDF 文件"""
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user.id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.status not in ("pending_upload", "error"):
        raise HTTPException(status_code=400, detail="该文档无需上传文件")

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

    doc.file_path = str(file_path)
    doc.file_size = len(content)
    doc.file_type = ext
    doc.filename = file.filename
    doc.status = "pending"
    await db.commit()

    asyncio.create_task(process_document(doc_id))
    return ApiResponse.ok(data={"document_id": doc_id}, msg="PDF 已上传，开始 AI 处理")


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
    from app.services.ai_service import generate_cover_image, generate_image_prompt, _call_qwen

    doc = await _get_user_doc(doc_id, user.id, db)

    summary = doc.summary or ""
    key_points = doc.key_points or []
    kp_list = key_points if isinstance(key_points, list) else []
    title = doc.title or "本文"

    # 汇总所有讲解页的核心要点
    all_slide_points: list[str] = []
    lecture_slides = doc.lecture_slides or []
    if isinstance(lecture_slides, list):
        for slide in lecture_slides:
            if isinstance(slide, dict):
                pts = slide.get("points") or slide.get("key_points") or []
                if isinstance(pts, list):
                    all_slide_points.extend(pts)
                slide_title = slide.get("title", "")
                if slide_title and slide_title not in all_slide_points:
                    all_slide_points.append(slide_title)

    # 生成读后感（文字部分，快速返回）
    if not summary and not all_slide_points:
        completion_text = f"🎉 恭喜完成《{title}》的阅读！"
    else:
        kp_text = "\n".join(f"- {p}" for p in kp_list[:5])
        sp_text = "\n".join(f"- {p}" for p in all_slide_points[:10])
        prompt = (
            f"我刚刚读完了《{title}》。\n"
            f"文档摘要：{summary[:400]}\n"
            f"核心要点：\n{kp_text}\n"
            f"讲解要点汇总：\n{sp_text}\n\n"
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
        # 先用 Qwen 生成高质量的、有科技感/未来感/场景互动的图片 prompt
        # 再异步调用通义万象生图（不阻塞响应）
        async def _gen_bg():
            import logging
            _log = logging.getLogger(__name__)
            try:
                img_prompt = await generate_image_prompt(
                    title=title,
                    summary=summary,
                    key_points=kp_list,
                    all_slide_points=all_slide_points,
                )
                _log.info(f"[CompletionCard] doc={doc_id} 生成图片prompt: {img_prompt[:120]}...")
                await generate_cover_image(img_prompt, str(settings.COVER_DIR), cover_filename)
            except Exception as e:
                _log.error(f"[CompletionCard] doc={doc_id} 封面图生成失败: {e}")

        asyncio.create_task(_gen_bg())
        cover_url = None

    expected_cover_url = f"/covers/{cover_filename}"

    return ApiResponse.ok(data={
        "title": title,
        "completion_text": completion_text,
        "cover_url": cover_url,
        "expected_cover_url": expected_cover_url,
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
