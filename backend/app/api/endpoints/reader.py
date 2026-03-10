"""
阅读器 API — 提供结构化内容、翻译、高亮划线等接口
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory, get_db
from app.core.deps import get_current_user
from app.models.document import Document
from app.models.user import User
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/documents", tags=["阅读器"])
logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# 辅助
# ─────────────────────────────────────────────

async def _get_user_doc(doc_id: int, user_id: int, db: AsyncSession) -> Document:
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return doc


# ─────────────────────────────────────────────
# 获取结构化内容（全部）
# ─────────────────────────────────────────────

@router.get("/{doc_id}/content", response_model=ApiResponse)
async def get_content(
    doc_id: int,
    chapter_id: str | None = Query(None, description="指定章节ID，不传则返回全部"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回文档结构化内容（章节列表 + 段落列表）"""
    doc = await _get_user_doc(doc_id, user.id, db)

    chapters = doc.chapters or []
    paragraphs = doc.parsed_content or []

    if chapter_id:
        paragraphs = [p for p in paragraphs if p.get("chapter_id") == chapter_id]

    # 如果还没提取，触发提取
    if not chapters and doc.file_path and doc.status == "ready":
        asyncio.create_task(_trigger_extract(doc_id, doc.file_path, doc.file_type))

    return ApiResponse.ok(data={
        "doc_id": doc_id,
        "title": doc.title,
        "author": doc.author,
        "language": doc.language or "zh",
        "chapters": chapters,
        "paragraphs": paragraphs,
        "total_paragraphs": len(paragraphs),
        "total_chapters": len(chapters),
        "has_content": len(paragraphs) > 0,
        "translation_status": doc.translation_status,
        "translation_lang": doc.translation_lang,
    })


async def _trigger_extract(doc_id: int, file_path: str, file_type: str):
    """按需触发结构化提取（内容接口首次访问时）"""
    from app.services.doc_processor import _extract_and_translate
    await _extract_and_translate(doc_id, file_path, file_type)


# ─────────────────────────────────────────────
# 获取翻译内容
# ─────────────────────────────────────────────

@router.get("/{doc_id}/translation", response_model=ApiResponse)
async def get_translation(
    doc_id: int,
    chapter_id: str | None = Query(None, description="指定章节ID"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """返回翻译内容（按章节返回，支持部分翻译完成的状态）"""
    doc = await _get_user_doc(doc_id, user.id, db)

    translated = doc.translated_content or []
    if chapter_id:
        translated = [c for c in translated if c.get("chapter_id") == chapter_id]

    return ApiResponse.ok(data={
        "doc_id": doc_id,
        "translation_status": doc.translation_status,
        "translation_lang": doc.translation_lang,
        "translated_chapters": translated,
        "translated_count": len(translated),
        "total_chapters": len(doc.chapters or []),
    })


# ─────────────────────────────────────────────
# 手动触发翻译
# ─────────────────────────────────────────────

class TranslateRequest(BaseModel):
    target_lang: str = "zh"   # zh 或 en


@router.post("/{doc_id}/translate", response_model=ApiResponse)
async def trigger_translation(
    doc_id: int,
    req: TranslateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """手动触发翻译（用户主动请求翻译时调用）"""
    doc = await _get_user_doc(doc_id, user.id, db)

    if doc.translation_status == "translating":
        return ApiResponse.ok(data={"status": "translating", "msg": "翻译正在进行中，请稍候"})

    if not doc.chapters or not doc.parsed_content:
        raise HTTPException(status_code=400, detail="文档内容尚未解析，请等待文档处理完成")

    src_lang = doc.language or "en"
    if src_lang == req.target_lang:
        raise HTTPException(status_code=400, detail="源语言与目标语言相同，无需翻译")

    # 重置翻译状态
    doc.translation_status = "translating"
    doc.translation_lang = req.target_lang
    doc.translated_content = []
    await db.commit()

    chapters = doc.chapters
    paragraphs = doc.parsed_content

    asyncio.create_task(
        translate_chapters_task(doc_id, chapters, paragraphs, src_lang, req.target_lang)
    )

    return ApiResponse.ok(data={"status": "translating", "msg": "翻译已开始，将按章节陆续完成"})


async def translate_chapters_task(doc_id, chapters, paragraphs, src_lang, target_lang):
    from app.services.content_service import translate_chapters
    await translate_chapters(chapters, paragraphs, src_lang, target_lang, doc_id, async_session_factory)


# ─────────────────────────────────────────────
# 重新提取内容（强制刷新）
# ─────────────────────────────────────────────

@router.post("/{doc_id}/reparse", response_model=ApiResponse)
async def reparse_content(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """强制重新解析文档结构化内容"""
    doc = await _get_user_doc(doc_id, user.id, db)

    if not doc.file_path:
        raise HTTPException(status_code=400, detail="文档无文件路径，无法解析")

    doc.chapters = None
    doc.parsed_content = None
    doc.translation_status = None
    doc.translated_content = None
    await db.commit()

    asyncio.create_task(_trigger_extract(doc_id, doc.file_path, doc.file_type))

    return ApiResponse.ok(data={"msg": "重新解析已开始，请稍候刷新"})
