import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone
from math import ceil
from pathlib import Path

logger = logging.getLogger(__name__)

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
from app.services.doc_processor import generate_lecture_for_document, process_document, _generate_all_slide_images
from app.services.ai_service import generate_slide_scene_image

router = APIRouter(prefix="/documents", tags=["文档"])

# 静态路径单独路由，必须在主 router 之前挂载，避免被 /{doc_id} 抢先匹配（见测试报告 3.1）
documents_static_router = APIRouter(tags=["文档"])

# 流式写磁盘：每次从 UploadFile 读取 CHUNK_SIZE，写入目标文件，避免整个文件驻留内存
_CHUNK_SIZE = settings.CHUNK_SIZE_MB * 1024 * 1024  # 50 MB per chunk
_MAX_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024  # 200 MB hard limit


async def _stream_to_disk(upload_file: UploadFile, dest: Path) -> int:
    """
    将 UploadFile 以流式分块方式写入 dest，返回实际写入字节数。
    每次读取 _CHUNK_SIZE 字节，一边读一边写，内存中最多保留一个 chunk。
    若总字节数超过 _MAX_BYTES 抛出 413 HTTPException。
    """
    total = 0
    loop = asyncio.get_event_loop()
    try:
        with dest.open("wb") as f:
            while True:
                chunk = await upload_file.read(_CHUNK_SIZE)
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_BYTES:
                    # 超限：立即删除临时文件
                    f.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"文件大小超过最大限制 {settings.MAX_UPLOAD_SIZE_MB} MB",
                    )
                # 异步写入：避免阻塞事件循环
                await loop.run_in_executor(None, f.write, chunk)
    except HTTPException:
        raise
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"文件写入失败: {e}")
    return total


def _allowed_ext(filename: str) -> bool:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in settings.ALLOWED_EXTENSIONS


# ---- 固定路径路由必须在 /{doc_id} 之前，否则会被路径参数拦截 ----


def _parse_annas_archive_html(html_text: str, libgen_source: bool = False) -> list[dict]:
    """解析 Anna's Archive 搜索结果 HTML，提取书籍信息。

    libgen_source=True 时表示该 HTML 来自 lgrsnf/lgli 过滤搜索，书籍来自 Libgen 可直接下载。
    """
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

        # 判断是否可自动下载：libgen 来源的书（lgrsnf/lgli）可通过 ads.php 下载
        can_auto_download = libgen_source and file_type == "pdf"

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
            "can_auto_download": can_auto_download,
        })
    return results


@documents_static_router.get("/book-search", response_model=ApiResponse)
async def book_search(
    query: str = Query(..., min_length=1),
    language: str | None = None,
    format: str | None = None,
    page: int = Query(1, ge=1),
    user: User = Depends(get_current_user),
):
    """通过 Anna's Archive 搜索书籍（双轨策略：优先 Libgen 可下载书籍）"""
    import httpx as _httpx
    import logging
    from urllib.parse import quote

    _log = logging.getLogger(__name__)
    encoded_query = quote(query)
    UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

    def make_proxy_urls(target_url: str) -> list[str]:
        return [
            f"https://api.codetabs.com/v1/proxy/?quest={quote(target_url, safe='')}",
            f"https://api.allorigins.win/raw?url={quote(target_url, safe='')}",
            target_url,
        ]

    async def fetch_html(target_url: str, label: str = "") -> str:
        for url in make_proxy_urls(target_url):
            try:
                async with _httpx.AsyncClient(timeout=30, follow_redirects=True, verify=False) as c:
                    resp = await c.get(url, headers={"User-Agent": UA})
                    if resp.status_code == 200 and '/md5/' in resp.text:
                        _log.info(f"[BookSearch] {label} Success via {url[:60]}...")
                        return resp.text
            except Exception as e:
                _log.debug(f"[BookSearch] {label} Failed {url[:50]}: {e}")
        return ""

    _log.info(f"[BookSearch] query='{query}'")

    # 检查是否有 Z-Library 凭据
    from app.services.zlib_service import _cred_store as _zlib_creds
    has_zlib = _zlib_creds.has_credentials

    # 并行搜索可下载来源：
    #   lgrsnf = Libgen 非小说（自动下载）
    #   lgli   = Libgen 小说（自动下载）
    #   lgrs   = Libgen RS（自动下载）
    #   zlib   = Z-Library（有账号时可下载）
    # 不再搜索通用（含 duxiu 读秀、upload 社区上传等无法下载来源）
    search_tasks = [
        ("lgrsnf", True,  asyncio.create_task(fetch_html(
            f"https://annas-archive.gl/search?q={encoded_query}&ext=pdf&src=lgrsnf", "lgrsnf"
        ))),
        ("lgli",   True,  asyncio.create_task(fetch_html(
            f"https://annas-archive.gl/search?q={encoded_query}&ext=pdf&src=lgli", "lgli"
        ))),
        ("lgrs",   True,  asyncio.create_task(fetch_html(
            f"https://annas-archive.gl/search?q={encoded_query}&ext=pdf&src=lgrs", "lgrs"
        ))),
    ]
    if has_zlib:
        search_tasks.append((
            "zlib", False, asyncio.create_task(fetch_html(
                f"https://annas-archive.gl/search?q={encoded_query}&ext=pdf&src=zlib", "zlib"
            ))
        ))

    htmls = await asyncio.gather(*[t for _, _, t in search_tasks])

    seen_md5: set[str] = set()
    results: list[dict] = []

    for (src_name, is_libgen, _), html in zip(search_tasks, htmls):
        if not html:
            continue
        for item in _parse_annas_archive_html(html, libgen_source=is_libgen):
            if item["md5"] not in seen_md5:
                seen_md5.add(item["md5"])
                item["book_source"] = src_name  # lgrsnf / lgli / lgrs / zlib
                results.append(item)

    # 可自动下载（Libgen）排前面，zlib 次之
    def _sort_key(r):
        if r.get("can_auto_download"):
            return 0
        if r.get("book_source") == "zlib":
            return 1
        return 2

    results.sort(key=_sort_key)

    _log.info(
        f"[BookSearch] Found {len(results)} results for '{query}' "
        f"(libgen={sum(1 for r in results if r.get('can_auto_download'))}, "
        f"zlib={sum(1 for r in results if r.get('book_source') == 'zlib')})"
    )

    if not results:
        fallback_url = f"https://annas-archive.gl/search?q={encoded_query}&ext=pdf"
        return ApiResponse.ok(
            data={"results": [], "total": 0, "page": page,
                  "search_url": fallback_url,
                  "error": "搜索服务暂时不可用，请在浏览器中打开链接手动搜索"}
        )

    return ApiResponse.ok(
        data={"results": results, "total": len(results), "page": page}
    )


@documents_static_router.post("/book-import", response_model=ApiResponse)
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

    def _parse_file_size(v) -> int:
        if isinstance(v, int):
            return v
        if not isinstance(v, str):
            return 0
        v = v.strip().upper()
        import re as _re
        m = _re.match(r'([\d.]+)\s*(KB|MB|GB|TB|B)?', v)
        if not m:
            return 0
        num = float(m.group(1))
        unit = m.group(2) or 'B'
        multipliers = {'B': 1, 'KB': 1024, 'MB': 1024**2, 'GB': 1024**3, 'TB': 1024**4}
        return int(num * multipliers.get(unit, 1))

    file_size_int = _parse_file_size(req.file_size)

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
        file_size=file_size_int,
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
        file_size=file_size_int,
        status="pending",
    )
    db.add(task)
    await db.commit()

    asyncio.create_task(_download_and_process_pdf(task.id, doc.id, req.md5, book_source=req.book_source))
    return ApiResponse.ok(data={"task_id": task.id, "document_id": doc.id}, msg="导入任务已创建，正在自动下载 PDF")


async def _try_download_pdf(
    md5: str,
    _ua: str,
    _log,
    _httpx,
    _re,
    _quote,
    book_source: str = "lgrsnf",
) -> bytes | None:
    """
    多策略下载 PDF，返回 bytes 或 None。

    策略顺序（优先直连，减少代理依赖）：
      1. library.lol 直连（最稳定的 Libgen 镜像）
      2. libgen.rs 直连
      3. libgen.st 直连
      4. libgen.li/ads.php → get.php（直连 + 代理兜底）
      5. Anna's Archive md5 页面 → 提取链接
      6. Z-Library（仅 zlib 来源书籍）
    """
    import asyncio as _asyncio

    PROXIES = [
        lambda u: f"https://api.codetabs.com/v1/proxy/?quest={_quote(u, safe='')}",
        lambda u: f"https://api.allorigins.win/raw?url={_quote(u, safe='')}",
    ]

    # Libgen 直连镜像（按稳定性排序）
    LIBGEN_MIRRORS = [
        f"https://library.lol/main/{md5}",
        f"https://libgen.rs/book/index.php?md5={md5}",
        f"https://libgen.st/book/index.php?md5={md5}",
        f"https://libgen.li/ads.php?md5={md5}",
    ]

    async def _get(url: str, timeout: int = 45, follow: bool = True):
        async with _httpx.AsyncClient(
            timeout=timeout, follow_redirects=follow, verify=False,
            headers={"User-Agent": _ua}
        ) as c:
            return await c.get(url)

    def _is_pdf(content: bytes) -> bool:
        return len(content) > 4096 and content[:4] == b"%PDF"

    async def _fetch_and_extract_download_link(page_url: str, source_name: str) -> str | None:
        """从书籍详情页中提取实际的 PDF 下载链接"""
        try:
            resp = await _get(page_url, timeout=20)
            if resp.status_code != 200:
                return None
            text = resp.text
            # library.lol 的下载链接格式
            m = _re.search(r'href="(https?://[^"]*(?:get\.php|/dl/|download)[^"]*)"', text)
            if m:
                return m.group(1)
            # libgen.rs/libgen.st 的 get.php 格式
            m = _re.search(r'href="(get\.php\?md5=[a-f0-9]+[^"]*)"', text)
            if m:
                base = page_url.rsplit("/", 2)[0]
                return f"{base}/{m.group(1)}"
            # ads.php 中的 get.php 链接
            m = _re.search(r'(?:href="|)(get\.php\?md5=[a-f0-9]+&key=[^"&\s]+)', text)
            if m:
                return f"https://libgen.li/{m.group(1)}"
        except Exception as ex:
            _log.debug(f"[BookImport] {source_name} 页面解析失败: {ex}")
        return None

    async def _download_url_direct(download_url: str, source_name: str) -> bytes | None:
        """直接下载指定 URL，返回 PDF bytes 或 None"""
        try:
            _log.info(f"[BookImport] {source_name} 直连下载: {download_url[:100]}")
            resp = await _get(download_url, timeout=120)
            if resp.status_code == 200 and _is_pdf(resp.content):
                _log.info(f"[BookImport] {source_name} 下载成功! size={len(resp.content)}")
                return resp.content
            _log.debug(f"[BookImport] {source_name} 返回非PDF: status={resp.status_code} size={len(resp.content)} head={resp.content[:8]!r}")
        except Exception as ex:
            _log.debug(f"[BookImport] {source_name} 直连失败: {ex}")
        return None

    async def _download_url_with_proxy_fallback(download_url: str, source_name: str) -> bytes | None:
        """直连失败后用代理重试"""
        result = await _download_url_direct(download_url, source_name)
        if result:
            return result
        for make_proxy in PROXIES:
            proxy_url = make_proxy(download_url)
            try:
                _log.info(f"[BookImport] {source_name} 代理重试: {proxy_url[:100]}")
                resp = await _get(proxy_url, timeout=120)
                if resp.status_code == 200 and _is_pdf(resp.content):
                    _log.info(f"[BookImport] {source_name} 代理下载成功! size={len(resp.content)}")
                    return resp.content
            except Exception as ex:
                _log.debug(f"[BookImport] {source_name} 代理失败: {ex}")
        return None

    # ── 策略 1-3：直连各 Libgen 镜像 ────────────────
    mirror_names = ["library.lol", "libgen.rs", "libgen.st", "libgen.li"]
    for mirror_url, mirror_name in zip(LIBGEN_MIRRORS[:3], mirror_names[:3]):
        _log.info(f"[BookImport] 尝试 {mirror_name} 直连: md5={md5[:8]}")
        dl_link = await _fetch_and_extract_download_link(mirror_url, mirror_name)
        if dl_link:
            result = await _download_url_direct(dl_link, mirror_name)
            if result:
                return result
        await _asyncio.sleep(1)  # 避免触发限速

    # ── 策略 4：libgen.li/ads.php（直连 + 代理兜底） ─
    _log.info(f"[BookImport] 策略4: libgen.li ads.php md5={md5[:8]}")
    ads_url = LIBGEN_MIRRORS[3]
    for attempt in range(2):
        if attempt > 0:
            await _asyncio.sleep(8)
        # 先直连
        dl_link = await _fetch_and_extract_download_link(ads_url, "libgen.li直连")
        if dl_link:
            result = await _download_url_direct(dl_link, "libgen.li")
            if result:
                return result
        # 再用代理
        for make_proxy in PROXIES:
            try:
                resp = await _get(make_proxy(ads_url), timeout=30)
                if resp.status_code == 200 and "get.php" in resp.text:
                    m = _re.search(r'(?:href="|)(get\.php\?md5=[a-f0-9]+&key=[^"&\s]+)', resp.text)
                    if m:
                        get_url = f"https://libgen.li/{m.group(1)}"
                        result = await _download_url_with_proxy_fallback(get_url, "libgen.li(proxy)")
                        if result:
                            return result
                elif "max_user_connections" in resp.text:
                    _log.warning("[BookImport] Libgen DB过载，等待后重试")
                    break
            except Exception as ex:
                _log.debug(f"[BookImport] ads.php 代理失败: {ex}")

    # ── 策略 5：Anna's Archive md5 页面（直连 + 代理） ─
    _log.info(f"[BookImport] 策略5: Anna's Archive md5={md5[:8]}")
    for anna_domain in ["https://annas-archive.gl", "https://annas-archive.org"]:
        anna_url = f"{anna_domain}/md5/{md5}"
        for fetch_fn in [
            lambda u: _get(u, timeout=25),
            lambda u: _get(PROXIES[0](u), timeout=25),
            lambda u: _get(PROXIES[1](u), timeout=25),
        ]:
            try:
                resp = await fetch_fn(anna_url)
                if resp.status_code != 200 or len(resp.content) < 3000:
                    continue
                text = resp.text
                # 提取 libgen 下载链接
                for pattern in [
                    r'libgen\.li/ads\.php\?md5=([a-f0-9]{32})',
                    r'libgen\.rs/book/index\.php\?md5=([a-f0-9]{32})',
                ]:
                    for alt_md5 in _re.findall(pattern, text):
                        if alt_md5 == md5:
                            continue
                        _log.info(f"[BookImport] Anna's Archive 找到备用 md5={alt_md5[:8]}")
                        for mirror_url, mirror_name in zip(LIBGEN_MIRRORS[:2], mirror_names[:2]):
                            alt_url = mirror_url.replace(md5, alt_md5)
                            dl_link = await _fetch_and_extract_download_link(alt_url, mirror_name)
                            if dl_link:
                                result = await _download_url_direct(dl_link, mirror_name)
                                if result:
                                    return result
                # 提取页面上的直接下载链接
                for dl_pattern in [
                    r'href="(https?://[^"]*libgen[^"]*(?:get\.php|/dl/)[^"]*)"',
                    r'href="(https?://library\.lol/[^"]+)"',
                ]:
                    m = _re.search(dl_pattern, text)
                    if m:
                        result = await _download_url_with_proxy_fallback(m.group(1), "Anna直链")
                        if result:
                            return result
                break
            except Exception as ex:
                _log.debug(f"[BookImport] Anna's Archive 失败: {ex}")

    # ── 策略 6：Z-Library ────────────────────────────
    if book_source == "zlib":
        _log.info(f"[BookImport] 策略6: Z-Library md5={md5[:8]}")
        try:
            from app.services.zlib_service import download_zlib_book
            zlib_content = await download_zlib_book(md5)
            if zlib_content:
                _log.info(f"[BookImport] Z-Library 下载成功 size={len(zlib_content)}")
                return zlib_content
        except Exception as ex:
            _log.debug(f"[BookImport] Z-Library 下载异常: {ex}")

    _log.warning(f"[BookImport] 所有下载策略均失败 md5={md5}")
    return None


async def _download_and_process_pdf(
    task_id: int,
    doc_id: int,
    md5: str | None,
    book_source: str = "lgrsnf",
):
    """从 Libgen/ZLib 下载 PDF 并启动 AI 处理（模块级函数，供 import 和 retry 使用）"""
    from app.core.database import async_session_factory
    import httpx as _httpx
    import re as _re
    import uuid
    import logging
    from app.core.config import settings
    from app.models.social import BookImportTask
    from app.services.doc_processor import process_document

    _log = logging.getLogger(__name__)

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

                _log.info(f"[BookImport] 下载 md5={md5} source={book_source}")
                content = await _try_download_pdf(md5, _ua, _log, _httpx, _re, _quote, book_source=book_source)

                if content:
                    t.progress = 80
                    await s.commit()
                else:
                    raise ValueError(
                        f"该书籍暂不支持自动下载（md5={md5}），请手动上传 PDF"
                    )
            else:
                _log.info(f"[BookImport] 直接下载: url={t.download_url}")
                # 流式下载，避免超大书籍撑爆内存
                _chunk = settings.CHUNK_SIZE_MB * 1024 * 1024
                _max = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
                _total = 0
                _header_bytes = b""
                import asyncio as _aio
                _loop = _aio.get_event_loop()
                async with _httpx.AsyncClient(timeout=300, follow_redirects=True) as client:
                    async with client.stream("GET", t.download_url, headers={"User-Agent": _ua}) as resp:
                        resp.raise_for_status()
                        with open(file_path, "wb") as f:
                            async for _ck in resp.aiter_bytes(_chunk):
                                if not _header_bytes and len(_ck) >= 5:
                                    _header_bytes = _ck[:5]
                                _total += len(_ck)
                                if _total > _max:
                                    file_path.unlink(missing_ok=True)
                                    raise ValueError(f"书籍文件超过大小限制 {settings.MAX_UPLOAD_SIZE_MB} MB")
                                await _loop.run_in_executor(None, f.write, _ck)
                content = None  # 已写磁盘，不再需要内存中的 content

            if content is not None:
                # md5 下载方式仍返回 bytes，走原有验证逻辑
                if not content[:5].startswith(b"%PDF"):
                    raise ValueError(
                        f"文件头不是 PDF 格式（前4字节: {content[:4]!r}，size: {len(content)}）"
                    )
                with open(file_path, "wb") as f:
                    f.write(content)
                file_size = len(content)
            else:
                # 流式下载：用已读取的头部验证 PDF 格式
                if _header_bytes and not _header_bytes.startswith(b"%PDF"):
                    file_path.unlink(missing_ok=True)
                    raise ValueError(f"文件头不是 PDF 格式（前5字节: {_header_bytes!r}）")
                file_size = _total

            _log.info(f"[BookImport] 下载完成: task={task_id}, size={file_size}, path={file_path}")
            d.file_path = str(file_path)
            d.file_size = file_size
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
                    err_str = str(e)
                    if "PDF" in err_str and "格式" in err_str:
                        d2.error_detail = "下载的文件不是有效的 PDF 格式，可能是版权保护或下载链接失效。"
                    elif "自动下载" in err_str or "所有下载策略" in err_str:
                        d2.error_detail = "该书籍在所有镜像源均无法自动下载，请手动上传 PDF 文件。"
                    elif "大小限制" in err_str:
                        d2.error_detail = f"书籍文件过大，超过系统限制。{err_str}"
                    else:
                        d2.error_detail = f"下载失败：{err_str[:300]}"
                await s.commit()
            except Exception:
                pass


_retry_download_task = _download_and_process_pdf


@documents_static_router.get("/book-import/{task_id}/status", response_model=ApiResponse)
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


@documents_static_router.post("/book-import/{task_id}/retry", response_model=ApiResponse)
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
    await db.commit()
    return ApiResponse.ok(msg="重试已启动")


@router.post("/{doc_id}/retry-download", response_model=ApiResponse)
async def retry_download(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """对 pending_upload 状态的文档重新尝试自动下载 PDF"""
    import asyncio
    import re as _re
    from app.models.social import BookImportTask

    doc = (await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user.id)
    )).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="文档不存在")
    if doc.status not in ("pending_upload", "error"):
        raise HTTPException(status_code=400, detail="当前状态不支持重新下载")

    md5 = ""
    if doc.source_url:
        m = _re.search(r'/md5/([a-f0-9]{32})', doc.source_url)
        if m:
            md5 = m.group(1)

    if not md5:
        raise HTTPException(status_code=400, detail="该文档无法自动下载，请手动上传 PDF")

    doc.status = "importing"
    task_result = await db.execute(
        select(BookImportTask).where(
            BookImportTask.document_id == doc_id
        ).order_by(BookImportTask.id.desc())
    )
    existing_task = task_result.scalar_one_or_none()

    if existing_task:
        existing_task.status = "pending"
        existing_task.progress = 0
        existing_task.error_message = None
        await db.commit()
        task_id = existing_task.id
    else:
        task = BookImportTask(
            user_id=user.id,
            document_id=doc.id,
            isbn=doc.isbn,
            title=doc.title,
            author=doc.author,
            download_url=doc.source_url or "",
            file_size=doc.file_size,
            status="pending",
        )
        db.add(task)
        await db.commit()
        task_id = task.id

    # 推断 book_source：source_type 含 zlib 或 source_url 含 z-lib 时走 zlib 策略
    retry_book_source = "lgrsnf"
    if doc.source_type and "zlib" in doc.source_type.lower():
        retry_book_source = "zlib"
    elif doc.source_url and "z-lib" in doc.source_url.lower():
        retry_book_source = "zlib"

    asyncio.create_task(_retry_download_task(task_id, doc_id, md5, book_source=retry_book_source))
    return ApiResponse.ok(
        data={"task_id": task_id, "document_id": doc_id},
        msg="正在重新下载 PDF，请稍候..."
    )


@documents_static_router.get("/check-isbn/{isbn}", response_model=ApiResponse)
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


@documents_static_router.post("/import-url", response_model=ApiResponse[DocumentOut])
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

    # 流式下载：每次读取一个 chunk，避免整个文件驻留内存
    total = 0
    try:
        async with _httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            async with client.stream("GET", req.url) as resp:
                resp.raise_for_status()
                loop = asyncio.get_event_loop()
                with file_path.open("wb") as f:
                    async for chunk in resp.aiter_bytes(_CHUNK_SIZE):
                        total += len(chunk)
                        if total > _MAX_BYTES:
                            file_path.unlink(missing_ok=True)
                            raise HTTPException(
                                status_code=413,
                                detail=f"URL 文件大小超过最大限制 {settings.MAX_UPLOAD_SIZE_MB} MB",
                            )
                        await loop.run_in_executor(None, f.write, chunk)
    except HTTPException:
        raise
    except Exception as e:
        file_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail=f"URL 下载失败: {e}")

    doc = Document(
        user_id=user.id,
        title=title,
        filename=f"{title}.{ext}",
        file_path=str(file_path),
        file_size=total,
        file_type=ext,
        source_type="url",
        source_url=req.url,
        status="pending",
    )
    db.add(doc)
    await db.flush()
    doc_id = doc.id
    await db.commit()
    result = DocumentOut.model_validate(doc)

    async def _deferred():
        await asyncio.sleep(1)
        await process_document(doc_id)

    asyncio.create_task(_deferred())
    return ApiResponse.ok(data=result)


# ---- 以下路由带 {doc_id} 路径参数 ----


@documents_static_router.post("/upload", response_model=ApiResponse[DocumentOut])
async def upload_document(
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    import logging
    _log = logging.getLogger(__name__)

    if not file.filename or not _allowed_ext(file.filename):
        raise HTTPException(status_code=400, detail="不支持的文件格式")

    ext = file.filename.rsplit(".", 1)[-1].lower()
    stored_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = settings.UPLOAD_DIR / stored_name

    _log.info(f"[Upload] 开始接收文件: {file.filename} ({ext})")
    file_size = await _stream_to_disk(file, file_path)
    _log.info(f"[Upload] 文件写入完成: {file.filename}, size={file_size}")

    title = os.path.splitext(file.filename)[0]
    doc = Document(
        user_id=user.id,
        title=title,
        filename=file.filename,
        file_path=str(file_path),
        file_size=file_size,
        file_type=ext,
        source_type="upload",
        status="pending",
    )
    db.add(doc)
    await db.flush()
    doc_id = doc.id
    await db.commit()
    result = DocumentOut.model_validate(doc)

    async def _deferred_processing():
        try:
            await asyncio.sleep(1)
            await process_document(doc_id)
        except Exception as e:
            _log.error(f"[Upload] 后台处理异常 doc_id={doc_id}: {e}", exc_info=True)

    asyncio.create_task(_deferred_processing())
    _log.info(f"[Upload] 上传响应返回, doc_id={doc_id}")
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

    ext = file.filename.rsplit(".", 1)[-1].lower()
    stored_name = f"{uuid.uuid4().hex}.{ext}"
    file_path = settings.UPLOAD_DIR / stored_name

    # 流式分块写磁盘
    file_size = await _stream_to_disk(file, file_path)

    # 清理旧文件（若存在）
    if doc.file_path and os.path.exists(doc.file_path):
        try:
            os.unlink(doc.file_path)
        except OSError:
            pass

    doc.file_path = str(file_path)
    doc.file_size = file_size
    doc.file_type = ext
    doc.filename = file.filename
    doc.status = "pending"
    await db.commit()

    asyncio.create_task(process_document(doc_id))
    return ApiResponse.ok(data={"document_id": doc_id}, msg="PDF 已上传，开始 AI 处理")


@documents_static_router.get("/list", response_model=ApiResponse[PaginatedData[DocumentOut]])
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


@router.post("/{doc_id}/reprocess", response_model=ApiResponse)
async def reprocess_document(
    doc_id: int,
    force_redownload: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    智能重新处理（含卡死状态恢复）：
    - importing 状态超时卡死 → 可强制中断并重新下载
    - 文件存在且可读（含文字）→ 直接重跑 AI 处理
    - 文件存在但是扫描版（无文字）→ 返回明确提示，不无限循环重下
    - 文件损坏/不存在且有 md5 → 重新下载
    - force_redownload=True → 强制删除旧文件并重新下载
    """
    import re as _re
    from app.models.social import BookImportTask

    doc = await _get_user_doc(doc_id, user.id, db)

    # 允许更多状态进入重处理，包含 importing（卡死恢复）
    ALLOWED = ("pending", "error", "pending_upload", "importing")
    if doc.status not in ALLOWED:
        raise HTTPException(status_code=400, detail=f"当前状态 {doc.status} 不支持重新处理")

    # ── 强制重下载模式 ──────────────────────────────────
    if force_redownload and doc.file_path and os.path.exists(doc.file_path):
        try:
            os.remove(doc.file_path)
        except Exception:
            pass
        doc.file_path = ""

    # ── 检查本地文件状态 ───────────────────────────────
    file_ok = False
    is_scanned = False   # 有效PDF但无可提取文字（扫描版）

    if not force_redownload and doc.file_path and os.path.exists(doc.file_path) and os.path.getsize(doc.file_path) > 1024:
        # 优先用 pymupdf 判断（更准确）
        try:
            import fitz as _fitz
            with _fitz.open(doc.file_path) as _fz:
                _page_count = _fz.page_count
                if _page_count > 0:
                    # PDF 结构有效，检查是否有可提取文字
                    _sample = ""
                    for _pg in _fz[:min(3, _page_count)]:
                        _sample += _pg.get_text()
                    if _sample.strip():
                        file_ok = True
                    else:
                        is_scanned = True   # 有效PDF但无文字 = 扫描版
                # page_count == 0 → 损坏，file_ok = False, is_scanned = False
        except ImportError:
            # pymupdf 不可用，退回 pdfplumber
            try:
                import pdfplumber as _pdfplumber
                with _pdfplumber.open(doc.file_path) as _pdf:
                    if _pdf.pages:
                        _sample = ""
                        for _page in _pdf.pages[:3]:
                            _sample += (_page.extract_text() or "")
                        if _sample.strip():
                            file_ok = True
                        else:
                            is_scanned = True
            except Exception:
                pass  # 打开失败 → 损坏
        except Exception:
            pass  # 其他错误 → 损坏

        # 扫描版：不删不重下，直接返回明确说明
        if is_scanned:
            logger.warning(f"[Reprocess] doc_id={doc_id} 检测为扫描版PDF，无文字可提取")
            doc.status = "error"
            doc.error_detail = (
                "该PDF为扫描版图片格式，无法自动提取文字。"
                "请在网上搜索文字版（可复制文字的）PDF，或手动上传文字版本。"
                "若确认已有更好的版本，请点击「手动上传PDF」替换。"
            )
            await db.commit()
            raise HTTPException(
                status_code=400,
                detail=doc.error_detail,
            )

        # 损坏的文件：删除，走重下流程
        if not file_ok:
            logger.warning(f"[Reprocess] doc_id={doc_id} PDF 结构损坏，删除后重新下载")
            try:
                os.remove(doc.file_path)
            except Exception:
                pass
            doc.file_path = ""

    # ── 文件可用 → 重跑 AI ─────────────────────────────
    if file_ok:
        doc.status = "pending"
        doc.progress = 0
        doc.error_detail = None
        await db.commit()
        asyncio.create_task(process_document(doc_id))
        return ApiResponse.ok(msg="已重新启动 AI 处理")

    # ── 文件不存在 → 尝试重新下载 ─────────────────────
    md5 = ""
    if doc.source_url:
        m = _re.search(r'/md5/([a-f0-9]{32})', doc.source_url)
        if m:
            md5 = m.group(1)

    if not md5:
        raise HTTPException(
            status_code=400,
            detail="文档文件丢失且无法自动重新下载（无下载源），请手动上传 PDF 文件"
        )

    # 有 md5，启动重新下载
    if not doc.file_path:
        doc.file_path = ""
    doc.status = "importing"
    doc.error_detail = None
    task_result = await db.execute(
        select(BookImportTask).where(
            BookImportTask.document_id == doc_id
        ).order_by(BookImportTask.id.desc())
    )
    existing_task = task_result.scalar_one_or_none()
    if existing_task:
        existing_task.status = "pending"
        existing_task.progress = 0
        existing_task.error_message = None
        await db.commit()
        task_id = existing_task.id
    else:
        new_task = BookImportTask(
            user_id=user.id,
            document_id=doc.id,
            isbn=doc.isbn,
            title=doc.title,
            author=doc.author,
            download_url=doc.source_url or "",
            status="pending",
        )
        db.add(new_task)
        await db.commit()
        task_id = new_task.id

    retry_book_source = "zlib" if (doc.source_type and "zlib" in doc.source_type.lower()) else "lgrsnf"
    asyncio.create_task(_retry_download_task(task_id, doc_id, md5, book_source=retry_book_source))
    return ApiResponse.ok(msg="已重新启动下载，请稍候（约1-3分钟）...")


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
                    doc_type=doc.doc_type or "science_pop",
                    ip_info=doc.ip_info,
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


@router.post("/{doc_id}/generate-slide-images", response_model=ApiResponse)
async def trigger_slide_images(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """手动触发所有讲解页的场景图生成（用于旧文档补生成）"""
    doc = await _get_user_doc(doc_id, user.id, db)
    if not doc.lecture_slides:
        raise HTTPException(status_code=400, detail="请先生成讲解")
    asyncio.create_task(_generate_all_slide_images(doc_id, doc.lecture_slides))
    return ApiResponse.ok(msg=f"已触发 {len(doc.lecture_slides)} 页场景图生成")


@router.post("/{doc_id}/slide/{slide_idx}/generate-image", response_model=ApiResponse)
async def trigger_single_slide_image(
    doc_id: int,
    slide_idx: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """手动触发单页场景图生成，实时返回 URL"""
    doc = await _get_user_doc(doc_id, user.id, db)
    if not doc.lecture_slides or slide_idx >= len(doc.lecture_slides):
        raise HTTPException(status_code=400, detail="页码超出范围")
    slide = doc.lecture_slides[slide_idx]
    url = await generate_slide_scene_image(
        doc_id, slide_idx,
        slide.get("title", ""),
        slide.get("points", []),
        slide.get("lecture_text", ""),
    )
    if url:
        slides = list(doc.lecture_slides)
        slides[slide_idx] = {**slides[slide_idx], "scene_image_url": url}
        doc.lecture_slides = slides
        await db.commit()
    return ApiResponse.ok(data={"scene_image_url": url})


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
