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

# ─────────────────────────────────────────────
# PDF 逐页对照翻译
# ─────────────────────────────────────────────

@router.get("/{doc_id}/pdf-page-translate", response_model=ApiResponse)
async def pdf_page_translate(
    doc_id: int,
    page: int = Query(1, ge=1, description="PDF 页码（1-based）"),
    target_lang: str = Query("zh", description="目标语言，默认中文"),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    提取 PDF 指定页的文字块并翻译，供左右对照视图使用。
    返回结构化文字块列表，含原文 + 译文 + 块类型（heading/text/caption）。
    图片块也会被标记（type=image），前端可显示占位符。
    """
    import os
    doc = await _get_user_doc(doc_id, user.id, db)
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="PDF 文件不存在")

    # ── 用 pymupdf 提取页面文字块 ──────────────────
    try:
        import fitz as _fitz
    except ImportError:
        raise HTTPException(status_code=500, detail="服务端未安装 pymupdf，无法提取页面内容")

    blocks_raw: list[dict] = []
    try:
        with _fitz.open(doc.file_path) as _doc:
            total_pages = _doc.page_count
            if page > total_pages:
                raise HTTPException(status_code=400, detail=f"页码超出范围（共 {total_pages} 页）")
            _page = _doc[page - 1]
            _page_w = _page.rect.width

            # get_text("dict") 返回块→行→span 结构，保留位置信息
            _raw = _page.get_text("dict", flags=_fitz.TEXT_PRESERVE_WHITESPACE | _fitz.TEXT_MEDIABOX_CLIP)
            for blk in _raw.get("blocks", []):
                if blk.get("type") == 1:
                    # 图片块：记录位置，前端显示图片占位符
                    bbox = blk.get("bbox", [0, 0, 0, 0])
                    blocks_raw.append({
                        "type": "image",
                        "text": "",
                        "translated": "",
                        "font_size": 0,
                        "bbox": bbox,
                        "width_ratio": (bbox[2] - bbox[0]) / _page_w if _page_w else 1,
                    })
                    continue
                if blk.get("type") != 0:
                    continue

                # 拼合文字行，同时统计最大字号
                lines_text: list[str] = []
                max_size = 0.0
                is_bold = False
                for line in blk.get("lines", []):
                    line_parts: list[str] = []
                    for span in line.get("spans", []):
                        t = span.get("text", "").strip()
                        if t:
                            line_parts.append(t)
                        sz = span.get("size", 0)
                        if sz > max_size:
                            max_size = sz
                        flags = span.get("flags", 0)
                        if flags & 16:   # bold flag
                            is_bold = True
                    if line_parts:
                        lines_text.append(" ".join(line_parts))

                full_text = "\n".join(lines_text).strip()
                if not full_text:
                    continue

                # 判断块类型：大字号或粗体 → heading；其他 → text
                if max_size >= 14 or is_bold:
                    blk_type = "heading"
                elif max_size <= 8:
                    blk_type = "caption"
                else:
                    blk_type = "text"

                blocks_raw.append({
                    "type": blk_type,
                    "text": full_text,
                    "translated": "",
                    "font_size": round(max_size, 1),
                    "bbox": blk.get("bbox", []),
                })
    except HTTPException:
        raise
    except Exception as _e:
        logger.error(f"[PdfPageTranslate] 提取失败 doc={doc_id} page={page}: {_e}")
        raise HTTPException(status_code=500, detail=f"PDF 页面提取失败：{_e}")

    # ── 并行翻译所有文字块 ─────────────────────────
    from app.services.ai_service import _call_qwen
    lang_name = "中文" if target_lang == "zh" else "英文"
    sem = asyncio.Semaphore(4)

    async def _translate_block(blk: dict) -> dict:
        if blk["type"] == "image" or not blk["text"]:
            return blk
        async with sem:
            try:
                result = await _call_qwen(
                    f"请将下列文本翻译为{lang_name}，保持原有段落结构，只输出译文，不加任何解释或标注：\n\n{blk['text']}",
                    system="你是专业学术翻译，译文准确流畅，直接输出结果。",
                    model="qwen-plus",
                )
                return {**blk, "translated": result.strip()}
            except Exception as _e:
                logger.warning(f"[PdfPageTranslate] block 翻译失败: {_e}")
                return {**blk, "translated": blk["text"]}

    translated_blocks = await asyncio.gather(*[_translate_block(b) for b in blocks_raw])

    return ApiResponse.ok(data={
        "doc_id": doc_id,
        "page": page,
        "total_pages": total_pages,
        "target_lang": target_lang,
        "blocks": list(translated_blocks),
    })


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
