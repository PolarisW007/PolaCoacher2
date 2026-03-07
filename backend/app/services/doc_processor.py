"""
文档处理服务 — 异步后台处理文档解析+AI增强
"""
import asyncio
import logging
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.document import Document
from app.services.ai_service import extract_key_points, generate_ppt_content, generate_summary

logger = logging.getLogger(__name__)


def _extract_text_from_pdf(file_path: str) -> tuple[str, int]:
    """从 PDF 提取文本"""
    try:
        import pdfplumber
        text_parts = []
        with pdfplumber.open(file_path) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    text_parts.append(t)
        return "\n\n".join(text_parts), page_count
    except ImportError:
        logger.warning("pdfplumber 未安装，使用基础文本提取")
        return _read_file_text(file_path), 1
    except Exception as e:
        logger.error(f"PDF 解析失败: {e}")
        return "", 0


def _extract_text_from_docx(file_path: str) -> tuple[str, int]:
    """从 Word 文档提取文本"""
    try:
        from docx import Document as DocxDocument
        doc = DocxDocument(file_path)
        paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
        return "\n\n".join(paragraphs), max(len(paragraphs) // 5, 1)
    except ImportError:
        logger.warning("python-docx 未安装")
        return "", 0
    except Exception as e:
        logger.error(f"Word 解析失败: {e}")
        return "", 0


def _read_file_text(file_path: str) -> str:
    """读取文本文件"""
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            return f.read()
    except UnicodeDecodeError:
        with open(file_path, "r", encoding="gbk", errors="ignore") as f:
            return f.read()


def extract_text(file_path: str, file_type: str) -> tuple[str, int]:
    """根据文件类型提取文本和页数"""
    if file_type == "pdf":
        return _extract_text_from_pdf(file_path)
    elif file_type == "docx":
        return _extract_text_from_docx(file_path)
    elif file_type in ("txt", "md"):
        text = _read_file_text(file_path)
        page_count = max(len(text) // 3000, 1)
        return text, page_count
    else:
        return "", 0


async def process_document(doc_id: int) -> None:
    """
    异步处理文档的完整流程：
    1. 解析文本
    2. Qwen Plus 生成摘要
    3. Qwen Plus 提取关键知识点
    4. Qwen Plus 生成 PPT 结构化内容
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
            await db.commit()

            # Step 1: 文本提取
            logger.info(f"[Doc {doc_id}] Step 1: 文本提取 - {doc.file_type}")
            text, page_count = await asyncio.to_thread(
                extract_text, doc.file_path, doc.file_type
            )

            if not text:
                doc.status = "error"
                doc.progress = 0
                await db.commit()
                logger.error(f"[Doc {doc_id}] 文本提取失败")
                return

            doc.page_count = page_count
            doc.word_count = len(text)
            doc.progress = 20.0
            await db.commit()

            # Step 2: AI 生成摘要 (Qwen Plus)
            logger.info(f"[Doc {doc_id}] Step 2: Qwen Plus 生成摘要")
            summary = await generate_summary(text)
            doc.summary = summary
            doc.progress = 45.0
            await db.commit()

            # Step 3: AI 提取关键知识点 (Qwen Plus)
            logger.info(f"[Doc {doc_id}] Step 3: Qwen Plus 提取关键知识点")
            key_points = await extract_key_points(text)
            doc.key_points = key_points
            doc.progress = 70.0
            await db.commit()

            # Step 4: AI 生成 PPT 内容 (Qwen Plus)
            logger.info(f"[Doc {doc_id}] Step 4: Qwen Plus 生成 PPT 内容")
            ppt_content = await generate_ppt_content(text, page_count)
            doc.ppt_content = ppt_content
            doc.progress = 100.0
            doc.status = "ready"
            await db.commit()

            logger.info(f"[Doc {doc_id}] 处理完成 ✓")

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
