"""
文档处理服务 — 异步后台处理文档解析+AI增强+讲解生成
"""
import asyncio
import logging

from sqlalchemy import select

from app.core.database import async_session_factory
from app.models.document import Document
from app.services.ai_service import (
    extract_key_points,
    generate_cover_image,
    generate_lecture_text,
    generate_ppt_content,
    generate_summary,
    translate_text,
)

logger = logging.getLogger(__name__)


def _extract_text_from_pdf(file_path: str) -> tuple[str, int, list[str]]:
    """从 PDF 提取文本，返回 (全文, 页数, 逐页文本列表)"""
    try:
        import pdfplumber
        text_parts: list[str] = []
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                t = page.extract_text() or ""
                text_parts.append(t)
        return "\n\n".join(text_parts), page_count, text_parts
    except ImportError:
        logger.warning("pdfplumber 未安装，使用基础文本提取")
        text = _read_file_text(file_path)
        return text, 1, [text]
    except Exception as e:
        logger.error(f"PDF 解析失败: {e}")
        return "", 0, []


def _extract_text_from_docx(file_path: str) -> tuple[str, int, list[str]]:
    """从 Word 文档提取文本"""
    try:
        from docx import Document as DocxDocument
        doc = DocxDocument(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        full = "\n\n".join(paragraphs)
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
            return f.read()
    except UnicodeDecodeError:
        with open(file_path, "r", encoding="gbk", errors="ignore") as f:
            return f.read()


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
        return text, len(pages), pages
    else:
        return "", 0, []


async def process_document(doc_id: int) -> None:
    """
    异步处理文档（上传后自动触发）：
    1. 解析文本  2. 生成摘要  3. 关键知识点  4. PPT 内容
    """
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
                await db.commit()
                logger.error(f"[Doc {doc_id}] 文本提取失败")
                return

            doc.page_count = page_count
            doc.word_count = len(text)
            doc.progress = 20.0
            doc.processing_step = "生成摘要与知识点"
            await db.commit()

            logger.info(f"[Doc {doc_id}] Step 2+3: 并行生成摘要 + 提取关键知识点")
            summary, key_points = await asyncio.gather(
                generate_summary(text),
                extract_key_points(text),
            )
            doc.summary = summary
            doc.key_points = key_points
            doc.progress = 55.0
            doc.processing_step = "生成PPT大纲"
            await db.commit()

            logger.info(f"[Doc {doc_id}] Step 4: Qwen Plus 生成 PPT 内容")
            ppt_content = await generate_ppt_content(text, page_count)
            doc.ppt_content = ppt_content
            doc.progress = 70.0
            doc.processing_step = "生成讲解"
            await db.commit()

            logger.info(f"[Doc {doc_id}] Step 5: 生成讲解文本")
            slides = await _generate_all_lectures(ppt_content, page_texts)
            doc.lecture_slides = slides
            doc.progress = 100.0
            doc.status = "ready"
            doc.processing_step = None
            await db.commit()

            logger.info(f"[Doc {doc_id}] 处理完成 ✓ ({len(slides)} slides)")

            asyncio.create_task(_pregenerate_audio(doc_id, min(3, len(slides))))
            # 异步生成封面图（不阻塞主流程，已有缓存则跳过）
            asyncio.create_task(_generate_cover_for_doc(doc_id))

        except Exception as e:
            logger.error(f"[Doc {doc_id}] 处理异常: {e}", exc_info=True)
            try:
                result = await db.execute(select(Document).where(Document.id == doc_id))
                doc = result.scalar_one_or_none()
                if doc:
                    doc.status = "error"
                    doc.progress = 0
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

            slides = await _generate_all_lectures(doc.ppt_content, page_texts)
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
    ppt_content: list[dict], page_texts: list[str]
) -> list[dict]:
    """为每页 PPT 并行生成讲解文本 + 翻译"""
    sem = asyncio.Semaphore(4)

    async def _one_slide(idx: int, slide: dict) -> dict:
        async with sem:
            page_text = page_texts[idx] if idx < len(page_texts) else ""
            lecture = await generate_lecture_text(slide, page_text)
            translation = await translate_text(lecture, "zh", "en")
            return {
                "slide": idx + 1,
                "title": slide.get("title", f"第 {idx + 1} 页"),
                "points": slide.get("points", []),
                "lecture_text": lecture,
                "translation": translation,
                "page_text": page_text[:500],
            }

    tasks = [_one_slide(i, s) for i, s in enumerate(ppt_content)]
    results = await asyncio.gather(*tasks, return_exceptions=True)

    slides = []
    for i, r in enumerate(results):
        if isinstance(r, Exception):
            logger.error(f"Slide {i + 1} 生成失败: {r}")
            slides.append({
                "slide": i + 1,
                "title": ppt_content[i].get("title", f"第 {i + 1} 页"),
                "points": ppt_content[i].get("points", []),
                "lecture_text": "讲解生成失败，请重试。",
                "translation": "",
                "page_text": "",
            })
        else:
            slides.append(r)
    return slides


async def _generate_cover_for_doc(doc_id: int) -> None:
    """为文档生成 AI 封面图，结果持久化到 DB 和磁盘，已有封面则跳过。"""
    from app.core.config import settings

    async with async_session_factory() as db:
        try:
            result = await db.execute(select(Document).where(Document.id == doc_id))
            doc = result.scalar_one_or_none()
            if not doc:
                return
            # 已有封面且文件存在则直接跳过
            if doc.cover_url:
                import os
                cover_filename = f"doc_{doc_id}_cover.png"
                cover_path = settings.COVER_DIR / cover_filename
                if cover_path.exists():
                    logger.info(f"[Doc {doc_id}] 封面图已存在，跳过生成")
                    return

            title = doc.title or "文档"
            summary = (doc.summary or "")[:200]
            key_points = doc.key_points or []
            kp_text = "、".join(
                (key_points if isinstance(key_points, list) else [])[:3]
            )

            img_prompt = (
                f"专业学术文档封面插画，主题：《{title}》。"
                f"内容概要：{summary[:80]}。"
                f"风格：简约现代，渐变色背景，几何图案装饰，高品质，"
                f"适合知识类产品封面，无文字，16:9比例。"
            )

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
