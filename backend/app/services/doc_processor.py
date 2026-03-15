"""
文档处理服务 — 异步后台处理文档解析+AI增强+讲解生成

分批策略（5MB 单元）：
  - 全局文档处理信号量限制同时处理的文档数（默认 2）
  - 讲解生成分批，每批 SLIDE_BATCH_SIZE 个 slide
  - 场景图分批创建 task，避免一次性创建 30+ 协程
"""
import asyncio
import gc
import logging

from sqlalchemy import select

from app.core.config import settings
from app.core.database import async_session_factory
from app.models.document import Document
from app.services.ai_service import (
    classify_document_type,
    classify_slide_style,
    extract_key_points,
    generate_cover_image,
    generate_image_prompt,
    generate_lecture_text,
    generate_ppt_content,
    generate_slide_scene_image,
    generate_summary,
    translate_text,
)
from app.services.content_service import (
    detect_language,
    extract_structured,
    translate_chapters,
)

logger = logging.getLogger(__name__)

# ── 全局并发控制（防止多文档同时处理撑爆内存/IO）──
_PROCESS_SEM = asyncio.Semaphore(settings.PROCESS_CONCURRENCY)

# 每批合并的 PDF 页数：控制全文字符串内存峰值，大文件防 OOM
_PDF_BATCH_PAGES = 30   # 每 30 PDF 页合并一次全文，不超过 ~1.5MB 文本
_FULL_TEXT_MAX_CHARS = 80_000   # 传给 AI 的全文最多 8 万字符
_SLIDE_BATCH = settings.SLIDE_BATCH_SIZE  # 讲解生成每批 slide 数


def _extract_text_from_pdf(file_path: str) -> tuple[str, int, list[str]]:
    """
    从 PDF 逐页流式提取文本，返回 (全文, 页数, 逐页文本列表)。
    主方案：pdfplumber；若提取内容为空（扫描版/图片PDF）自动降级到 pypdf。
    """
    text_parts: list[str] = []
    full_text_chunks: list[str] = []
    total_chars = 0
    page_count = 0

    # ── 主方案：pdfplumber ──────────────────────────
    try:
        import pdfplumber
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                t = page.extract_text() or ""
                text_parts.append(t)
                if total_chars < _FULL_TEXT_MAX_CHARS:
                    take = min(len(t), _FULL_TEXT_MAX_CHARS - total_chars)
                    full_text_chunks.append(t[:take])
                    total_chars += take
        full_text = "\n\n".join(full_text_chunks).strip()
        if full_text:
            return full_text, page_count, text_parts
        logger.warning(f"pdfplumber 提取内容为空（可能是扫描版PDF），尝试 pypdf 降级: {file_path}")
    except ImportError:
        logger.warning("pdfplumber 未安装，降级到 pypdf")
    except Exception as e:
        logger.warning(f"pdfplumber 解析失败: {e}，降级到 pypdf")

    # ── 降级方案：pypdf ─────────────────────────────
    try:
        import pypdf
        text_parts = []
        full_text_chunks = []
        total_chars = 0
        with pypdf.PdfReader(file_path) as reader:
            page_count = len(reader.pages)
            for page in reader.pages:
                t = page.extract_text() or ""
                text_parts.append(t)
                if total_chars < _FULL_TEXT_MAX_CHARS:
                    take = min(len(t), _FULL_TEXT_MAX_CHARS - total_chars)
                    full_text_chunks.append(t[:take])
                    total_chars += take
        full_text = "\n\n".join(full_text_chunks).strip()
        if full_text:
            logger.info(f"pypdf 降级提取成功: {page_count} 页")
            return full_text, page_count, text_parts
        logger.warning("pypdf 提取内容也为空（可能是图片/扫描版PDF）")
    except ImportError:
        logger.warning("pypdf 未安装")
    except Exception as e:
        logger.warning(f"pypdf 解析失败: {e}")

    return "", page_count or 0, text_parts


def _extract_text_from_docx(file_path: str) -> tuple[str, int, list[str]]:
    """从 Word 文档提取文本"""
    try:
        from docx import Document as DocxDocument
        doc = DocxDocument(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        full = "\n\n".join(paragraphs)[:_FULL_TEXT_MAX_CHARS]
        chunk_size = 5
        pages = [
            "\n".join(paragraphs[i:i + chunk_size])
            for i in range(0, len(paragraphs), chunk_size)
        ]
        return full, len(pages), pages
    except ImportError:
        logger.warning("python-docx 未安装")
        return "", 0, []
    except Exception as e:
        logger.error(f"Word 解析失败: {e}")
        return "", 0, []


def _read_file_text(file_path: str) -> str:
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read(_FULL_TEXT_MAX_CHARS * 4)  # 按字节预读，避免超大文本文件全量读入
    except UnicodeDecodeError:
        with open(file_path, "r", encoding="gbk", errors="ignore") as f:
            return f.read(_FULL_TEXT_MAX_CHARS * 4)


def extract_text(file_path: str, file_type: str) -> tuple[str, int, list[str]]:
    """根据文件类型提取文本，返回 (全文, 页数, 逐页列表)"""
    if file_type == "pdf":
        return _extract_text_from_pdf(file_path)
    elif file_type == "docx":
        return _extract_text_from_docx(file_path)
    elif file_type in ("txt", "md"):
        text = _read_file_text(file_path)
        chunk = 3000
        pages = [text[i:i + chunk] for i in range(0, max(len(text), 1), chunk)]
        return text[:_FULL_TEXT_MAX_CHARS], len(pages), pages
    else:
        return "", 0, []


async def process_document(doc_id: int) -> None:
    """
    异步处理文档（上传后自动触发）：
    1. 解析文本  2. 生成摘要  3. 关键知识点  4. PPT 内容

    全局信号量限制同时处理文档数，防止多用户同时上传大 PDF 导致 OOM。
    """
    async with _PROCESS_SEM:
        await _process_document_impl(doc_id)


async def _process_document_impl(doc_id: int) -> None:
    async with async_session_factory() as db:
        try:
            result = await db.execute(select(Document).where(Document.id == doc_id))
            doc = result.scalar_one_or_none()
            if not doc:
                logger.error(f"Document {doc_id} not found")
                return

            doc.status = "processing"
            doc.progress = 5.0
            doc.processing_step = "准备中"
            await db.commit()

            logger.info(f"[Doc {doc_id}] Step 1: 文本提取 - {doc.file_type}")
            doc.processing_step = "提取文本"
            doc.progress = 10.0
            await db.commit()

            text, page_count, page_texts = await asyncio.to_thread(
                extract_text, doc.file_path, doc.file_type
            )

            if not text:
                doc.status = "error"
                doc.progress = 0
                doc.processing_step = None
                doc.error_detail = "PDF文本提取失败：该文件可能是扫描版图片PDF，无法提取文字内容。请确认PDF是否包含可选中的文字。"
                await db.commit()
                logger.error(f"[Doc {doc_id}] 文本提取失败")
                return

            doc.page_count = page_count
            doc.word_count = len(text)
            doc.progress = 20.0
            doc.processing_step = "生成摘要与知识点"
            await db.commit()

            MAX_SLIDES = 30
            effective_page_count = min(page_count, MAX_SLIDES)

            logger.info(f"[Doc {doc_id}] Step 2+3: 并行生成摘要 + 提取关键知识点")
            summary, key_points = await asyncio.gather(
                generate_summary(text),
                extract_key_points(text),
            )
            doc.summary = summary
            doc.key_points = key_points
            doc.progress = 45.0
            doc.processing_step = "识别文档类型"
            await db.commit()

            logger.info(f"[Doc {doc_id}] Step 3.5: 识别文档类型与IP信息")
            doc_meta = await classify_document_type(
                title=doc.title or "",
                summary=summary[:400],
                text_sample=text[:600],
            )
            doc.doc_type = doc_meta.get("doc_type", "science_pop")
            doc.ip_info = {k: v for k, v in doc_meta.items() if k != "doc_type"} if doc_meta.get("ip_name") else None
            logger.info(f"[Doc {doc_id}] 文档类型={doc.doc_type}, IP={doc_meta.get('ip_name')}")
            doc.progress = 55.0
            doc.processing_step = "生成PPT大纲"
            await db.commit()

            logger.info(f"[Doc {doc_id}] Step 4: Qwen Plus 生成 PPT 内容 (最多 {MAX_SLIDES} 页)")
            ppt_content = await generate_ppt_content(text, effective_page_count)
            doc.ppt_content = ppt_content
            doc.progress = 70.0
            doc.processing_step = "生成讲解"
            await db.commit()

            logger.info(f"[Doc {doc_id}] Step 5: 生成讲解文本（分批，每批 {_SLIDE_BATCH} 页）")
            slides = await _generate_all_lectures(
                ppt_content,
                page_texts[:MAX_SLIDES],
                doc_id=doc_id,
                doc_type=doc.doc_type or "science_pop",
                ip_info=doc.ip_info,
            )
            doc.lecture_slides = slides
            doc.progress = 100.0
            doc.status = "ready"
            doc.processing_step = None
            await db.commit()

            logger.info(f"[Doc {doc_id}] 处理完成 ✓ ({len(slides)} slides)")

            asyncio.create_task(_pregenerate_audio(doc_id, min(3, len(slides))))
            asyncio.create_task(_generate_cover_for_doc(doc_id))
            asyncio.create_task(_extract_and_translate(doc_id, doc.file_path, doc.file_type))

        except Exception as e:
            logger.error(f"[Doc {doc_id}] 处理异常: {e}", exc_info=True)
            try:
                result = await db.execute(select(Document).where(Document.id == doc_id))
                doc = result.scalar_one_or_none()
                if doc:
                    doc.status = "error"
                    doc.progress = 0
                    doc.processing_step = None
                    err_str = str(e)
                    if "API" in err_str or "timeout" in err_str.lower() or "connect" in err_str.lower():
                        doc.error_detail = f"AI服务调用失败（网络超时或API异常），可稍后重新处理。详情：{err_str[:200]}"
                    elif "token" in err_str.lower() or "quota" in err_str.lower():
                        doc.error_detail = f"AI配额不足，请检查API Key余额后重新处理。"
                    else:
                        doc.error_detail = f"处理异常：{err_str[:300]}"
                    await db.commit()
            except Exception:
                pass


async def generate_lecture_for_document(doc_id: int) -> None:
    """
    单独触发讲解生成（用于已 ready 但无 lecture_slides 的文档）
    """
    async with async_session_factory() as db:
        try:
            result = await db.execute(select(Document).where(Document.id == doc_id))
            doc = result.scalar_one_or_none()
            if not doc or not doc.ppt_content:
                return

            doc.status = "processing"
            doc.progress = 80.0
            await db.commit()

            text, _, page_texts = await asyncio.to_thread(
                extract_text, doc.file_path, doc.file_type
            )

            slides = await _generate_all_lectures(doc.ppt_content, page_texts, doc_id=doc_id)
            doc.lecture_slides = slides
            doc.progress = 100.0
            doc.status = "ready"
            await db.commit()

            logger.info(f"[Doc {doc_id}] 讲解生成完成 ✓ ({len(slides)} slides)")

            asyncio.create_task(_pregenerate_audio(doc_id, min(3, len(slides))))
        except Exception as e:
            logger.error(f"[Doc {doc_id}] 讲解生成异常: {e}", exc_info=True)
            try:
                result = await db.execute(select(Document).where(Document.id == doc_id))
                doc = result.scalar_one_or_none()
                if doc:
                    doc.status = "ready"
                    await db.commit()
            except Exception:
                pass


async def _pregenerate_audio(doc_id: int, num_pages: int) -> None:
    """讲解完成后异步预生成前几页音频"""
    from app.api.endpoints.tts import _background_synthesize_page_by_doc

    logger.info(f"[Doc {doc_id}] 开始预生成前 {num_pages} 页音频")
    for page in range(num_pages):
        try:
            await _background_synthesize_page_by_doc(doc_id, page)
        except Exception as e:
            logger.error(f"[Doc {doc_id}] 第 {page} 页音频预生成失败: {e}")
    logger.info(f"[Doc {doc_id}] 前 {num_pages} 页音频预生成完成")


async def _generate_all_lectures(
    ppt_content: list[dict],
    page_texts: list[str],
    doc_id: int | None = None,
    doc_type: str = "science_pop",
    ip_info: dict | None = None,
) -> list[dict]:
    """分批为每页 PPT 生成讲解文本 + 翻译，每批 _SLIDE_BATCH 个 slide。
    批间持久化到数据库，避免一次性创建所有协程占用内存。
    """
    sem = asyncio.Semaphore(2)
    total = len(ppt_content)
    slides: list[dict] = []

    async def _one_slide(idx: int, slide: dict) -> dict:
        async with sem:
            page_text = page_texts[idx] if idx < len(page_texts) else ""
            lecture = await generate_lecture_text(slide, page_text)
            translation = await translate_text(lecture, "zh", "en")
            title = slide.get("title", f"第 {idx + 1} 页")
            points = slide.get("points", [])
            return {
                "slide": idx + 1,
                "title": title,
                "points": points,
                "lecture_text": lecture,
                "translation": translation,
                "page_text": page_text[:500],
                "doc_type": doc_type,
                "scene_image_url": None,
            }

    for batch_start in range(0, total, _SLIDE_BATCH):
        batch_end = min(batch_start + _SLIDE_BATCH, total)
        batch = ppt_content[batch_start:batch_end]

        tasks = [_one_slide(batch_start + i, s) for i, s in enumerate(batch)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for i, r in enumerate(results):
            abs_idx = batch_start + i
            if isinstance(r, Exception):
                logger.error(f"Slide {abs_idx + 1} 生成失败: {r}")
                slides.append({
                    "slide": abs_idx + 1,
                    "title": ppt_content[abs_idx].get("title", f"第 {abs_idx + 1} 页"),
                    "points": ppt_content[abs_idx].get("points", []),
                    "lecture_text": "讲解生成失败，请重试。",
                    "translation": "",
                    "page_text": "",
                    "doc_type": doc_type,
                    "scene_image_url": None,
                })
            else:
                slides.append(r)

        # 每批完成后持久化进度到数据库
        if doc_id is not None:
            try:
                async with async_session_factory() as _db:
                    _r = await _db.execute(select(Document).where(Document.id == doc_id))
                    _doc = _r.scalar_one_or_none()
                    if _doc:
                        _doc.lecture_slides = slides
                        await _db.commit()
            except Exception:
                pass

        logger.info(f"[Doc {doc_id}] 讲解进度 {batch_end}/{total}")
        gc.collect()

    if doc_id is not None:
        asyncio.create_task(_generate_all_slide_images(doc_id, slides, doc_type=doc_type, ip_info=ip_info))

    return slides


async def _generate_all_slide_images(
    doc_id: int,
    slides: list[dict],
    doc_type: str = "science_pop",
    ip_info: dict | None = None,
) -> None:
    """后台分批为所有讲解页生成场景图，逐页写回数据库"""
    await asyncio.sleep(300)
    sem = asyncio.Semaphore(1)
    total = len(slides)

    async def _gen_one(idx: int, slide: dict) -> None:
        async with sem:
            title = slide.get("title", "")
            points = slide.get("points", [])
            lecture_text = slide.get("lecture_text", "")
            effective_doc_type = slide.get("doc_type") or doc_type
            try:
                url = await generate_slide_scene_image(
                    doc_id, idx, title, points, lecture_text,
                    doc_type=effective_doc_type,
                    ip_info=ip_info,
                    total_slides=total,
                )
                if url:
                    await _write_slide_image_url(doc_id, idx, url)
            except Exception as e:
                logger.error(f"[Doc {doc_id}] Slide {idx} 场景图生成失败: {e}")

    logger.info(f"[Doc {doc_id}] 开始后台分批生成 {total} 张场景图 (类型={doc_type})")
    for batch_start in range(0, total, _SLIDE_BATCH):
        batch = slides[batch_start:batch_start + _SLIDE_BATCH]
        await asyncio.gather(*[_gen_one(batch_start + i, s) for i, s in enumerate(batch)])
        gc.collect()
        logger.info(f"[Doc {doc_id}] 场景图进度 {min(batch_start + _SLIDE_BATCH, total)}/{total}")
    logger.info(f"[Doc {doc_id}] 全部场景图生成完成")


async def _write_slide_image_url(doc_id: int, slide_idx: int, url: str) -> None:
    """将生成好的场景图 URL 写回 lecture_slides[slide_idx].scene_image_url"""
    async with async_session_factory() as db:
        try:
            result = await db.execute(select(Document).where(Document.id == doc_id))
            doc = result.scalar_one_or_none()
            if not doc or not doc.lecture_slides:
                return
            slides = list(doc.lecture_slides)
            if slide_idx < len(slides):
                slides[slide_idx] = {**slides[slide_idx], "scene_image_url": url}
                doc.lecture_slides = slides
                await db.commit()
                logger.info(f"[Doc {doc_id}] Slide {slide_idx} 场景图 URL 已写入: {url}")
        except Exception as e:
            logger.error(f"[Doc {doc_id}] 写入场景图 URL 失败: {e}")


async def _extract_and_translate(doc_id: int, file_path: str, file_type: str) -> None:
    """后台异步：提取结构化内容，检测语言，非中文自动翻译"""
    from app.core.config import settings

    async with async_session_factory() as db:
        try:
            result = await db.execute(select(Document).where(Document.id == doc_id))
            doc = result.scalar_one_or_none()
            if not doc:
                return

            # 图片保存目录
            image_dir = str(settings.DOC_IMAGES_DIR)
            image_url_prefix = "/doc_images"

            logger.info(f"[Doc {doc_id}] 开始结构化内容提取（含图片）")
            chapters, paragraphs = await asyncio.to_thread(
                extract_structured, file_path, file_type, image_dir, image_url_prefix
            )

            if not paragraphs:
                logger.warning(f"[Doc {doc_id}] 结构化提取结果为空，跳过")
                return

            doc.chapters = chapters
            doc.parsed_content = paragraphs
            await db.commit()
            logger.info(f"[Doc {doc_id}] 结构化提取完成：{len(chapters)} 章，{len(paragraphs)} 段")

            # 语言检测
            sample_text = " ".join(p["text"] for p in paragraphs[:50])
            lang = detect_language(sample_text)
            doc.language = lang
            await db.commit()

            # 非中文文档自动翻译为中文
            if lang != "zh":
                logger.info(f"[Doc {doc_id}] 检测到外文({lang})，开始自动翻译")
                asyncio.create_task(
                    translate_chapters(chapters, paragraphs, lang, "zh", doc_id, async_session_factory)
                )
        except Exception as e:
            logger.error(f"[Doc {doc_id}] 结构化提取/翻译异常: {e}", exc_info=True)


async def _generate_cover_for_doc(doc_id: int) -> None:
    """为文档生成 AI 封面图，结果持久化到 DB 和磁盘，已有封面则跳过。"""
    from app.core.config import settings

    async with async_session_factory() as db:
        try:
            result = await db.execute(select(Document).where(Document.id == doc_id))
            doc = result.scalar_one_or_none()
            if not doc:
                return
            cover_filename = f"doc_{doc_id}_cover.png"
            cover_path = settings.COVER_DIR / cover_filename

            if doc.cover_url and cover_path.exists():
                logger.info(f"[Doc {doc_id}] 封面图已存在于本地，跳过生成")
                return

            if doc.cover_url and doc.cover_url.startswith("http"):
                try:
                    import httpx as _httpx
                    from urllib.parse import quote as _q
                    _cover_urls = [
                        f"https://api.codetabs.com/v1/proxy/?quest={_q(doc.cover_url, safe='')}",
                        doc.cover_url,
                    ]
                    for _cu in _cover_urls:
                        try:
                            async with _httpx.AsyncClient(timeout=20, verify=False) as _c:
                                _r = await _c.get(_cu, headers={"User-Agent": "Mozilla/5.0"})
                                if _r.status_code == 200 and len(_r.content) > 500:
                                    settings.COVER_DIR.mkdir(parents=True, exist_ok=True)
                                    ext = "jpg" if b"\xff\xd8\xff" in _r.content[:4] else "png"
                                    cover_filename = f"doc_{doc_id}_cover.{ext}"
                                    cover_path = settings.COVER_DIR / cover_filename
                                    with open(cover_path, "wb") as _f:
                                        _f.write(_r.content)
                                    doc.cover_url = f"/covers/{cover_filename}"
                                    await db.commit()
                                    logger.info(f"[Doc {doc_id}] 已下载外部封面图并保存: {cover_filename}")
                                    return
                        except Exception:
                            continue
                    logger.warning(f"[Doc {doc_id}] 所有封面下载渠道失败，将使用 AI 生成")
                except Exception as ex:
                    logger.warning(f"[Doc {doc_id}] 下载外部封面失败: {ex}，将使用 AI 生成")

            title = doc.title or "文档"
            summary = (doc.summary or "")[:300]
            key_points = doc.key_points or []
            kp_list = key_points if isinstance(key_points, list) else []
            doc_type = doc.doc_type or "science_pop"
            ip_info = doc.ip_info or None

            # 汇总讲解页要点
            all_slide_points: list[str] = []
            lecture_slides = doc.lecture_slides or []
            if isinstance(lecture_slides, list):
                for sl in lecture_slides:
                    if isinstance(sl, dict):
                        pts = sl.get("points") or sl.get("key_points") or []
                        if isinstance(pts, list):
                            all_slide_points.extend(pts)

            img_prompt = await generate_image_prompt(
                title=title,
                summary=summary,
                key_points=kp_list,
                all_slide_points=all_slide_points,
                doc_type=doc_type,
                ip_info=ip_info,
            )
            logger.info(f"[Doc {doc_id}] 封面图prompt (类型={doc_type}): {img_prompt[:120]}...")

            cover_filename = f"doc_{doc_id}_cover.png"
            cover_url = await generate_cover_image(
                img_prompt,
                str(settings.COVER_DIR),
                cover_filename,
            )

            if cover_url:
                doc.cover_url = cover_url
                await db.commit()
                logger.info(f"[Doc {doc_id}] 封面图生成成功: {cover_url}")
            else:
                logger.warning(f"[Doc {doc_id}] 封面图生成失败（API 未配置或调用失败）")

        except Exception as e:
            logger.error(f"[Doc {doc_id}] 封面图生成异常: {e}", exc_info=True)
