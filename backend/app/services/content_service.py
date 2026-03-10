"""
内容解析服务 — 将 PDF/Word 文档解析为结构化章节+段落，供阅读器使用
并负责按章节异步翻译
"""
import asyncio
import logging
import re
import uuid

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# 语言检测
# ─────────────────────────────────────────────

def detect_language(text: str) -> str:
    """简单语言检测：统计中文字符占比"""
    if not text:
        return "en"
    sample = text[:2000]
    chinese = sum(1 for c in sample if "\u4e00" <= c <= "\u9fff")
    ratio = chinese / max(len(sample), 1)
    return "zh" if ratio > 0.15 else "en"


# ─────────────────────────────────────────────
# 段落类型识别
# ─────────────────────────────────────────────

def _classify_paragraph(text: str, font_size: float | None = None, is_bold: bool = False) -> str:
    """识别段落类型：heading1/heading2/heading3/body/list/empty"""
    stripped = text.strip()
    if not stripped:
        return "empty"

    # 基于字体大小识别标题（pdfplumber 返回的 top/bottom 差值）
    if font_size and font_size > 18:
        return "heading1"
    if font_size and font_size > 14:
        return "heading2"
    if font_size and font_size > 12 and is_bold:
        return "heading3"

    # 基于文字规则识别标题
    if re.match(r"^(第[一二三四五六七八九十百\d]+[章节部篇]|Chapter\s+\d+|CHAPTER\s+\d+|Part\s+\d+|Section\s+\d+)", stripped, re.IGNORECASE):
        return "heading1"
    if re.match(r"^(\d+[\.\s]\s*[A-Z\u4e00-\u9fff]|\d+\.\d+[\s\.])", stripped):
        return "heading2"
    if re.match(r"^[一二三四五六七八九十]\s*[、\.\s]\s*[\u4e00-\u9fff A-Z]", stripped):
        return "heading2"
    if re.match(r"^[（(]\s*[一二三四五六七八九十\d]\s*[)）]\s*[\u4e00-\u9fff A-Z]", stripped):
        return "heading3"

    # 列表项
    if re.match(r"^[-•·▸◆▶●○]\s", stripped) or re.match(r"^\d+[.)]\s", stripped):
        return "list"

    return "body"


# ─────────────────────────────────────────────
# PDF 结构化提取
# ─────────────────────────────────────────────

def extract_structured_from_pdf(file_path: str) -> tuple[list[dict], list[dict]]:
    """
    从 PDF 提取结构化内容
    返回: (chapters, paragraphs)
      chapters: [{id, title, level, para_index}]
      paragraphs: [{id, chapter_id, type, text, page}]
    """
    paragraphs: list[dict] = []
    chapters: list[dict] = []
    current_chapter_id: str | None = None

    try:
        import pdfplumber

        with pdfplumber.open(file_path) as pdf:
            para_index = 0

            for page_num, page in enumerate(pdf.pages, 1):
                # 尝试获取带字体信息的文字块
                words = page.extract_words(
                    x_tolerance=3,
                    y_tolerance=3,
                    extra_attrs=["size", "fontname"],
                ) or []

                if not words:
                    # fallback: 纯文本
                    raw = page.extract_text() or ""
                    for line in raw.split("\n"):
                        line = line.strip()
                        if not line:
                            continue
                        ptype = _classify_paragraph(line)
                        pid = f"p{para_index}"
                        para_index += 1
                        if ptype in ("heading1", "heading2", "heading3"):
                            cid = f"c{len(chapters)}"
                            chapters.append({
                                "id": cid, "title": line[:120],
                                "level": int(ptype[-1]), "para_index": para_index - 1,
                            })
                            current_chapter_id = cid
                        paragraphs.append({
                            "id": pid, "chapter_id": current_chapter_id,
                            "type": ptype, "text": line, "page": page_num,
                        })
                    continue

                # 按行聚合文字（相近 y 坐标的 words 合并为一行）
                lines: list[tuple[str, float, bool]] = []  # (text, avg_size, is_bold)
                current_line_words: list[dict] = []

                for w in words:
                    if current_line_words:
                        y_diff = abs(w.get("top", 0) - current_line_words[-1].get("top", 0))
                        if y_diff > 5:
                            _flush_line(current_line_words, lines)
                            current_line_words = []
                    current_line_words.append(w)
                if current_line_words:
                    _flush_line(current_line_words, lines)

                # 合并短行为段落（连续 body 行合并）
                para_buffer: list[str] = []
                para_size: float | None = None
                para_bold: bool = False

                def _emit_buffer():
                    nonlocal para_buffer, para_size, para_bold, para_index, current_chapter_id
                    if not para_buffer:
                        return
                    text = " ".join(para_buffer).strip()
                    if not text:
                        para_buffer = []
                        return
                    ptype = _classify_paragraph(text, para_size, para_bold)
                    pid = f"p{para_index}"
                    para_index += 1
                    if ptype in ("heading1", "heading2", "heading3"):
                        cid = f"c{len(chapters)}"
                        chapters.append({
                            "id": cid, "title": text[:120],
                            "level": int(ptype[-1]), "para_index": para_index - 1,
                        })
                        current_chapter_id = cid
                    paragraphs.append({
                        "id": pid, "chapter_id": current_chapter_id,
                        "type": ptype, "text": text, "page": page_num,
                    })
                    para_buffer = []
                    para_size = None
                    para_bold = False

                for line_text, avg_size, is_bold in lines:
                    line_type = _classify_paragraph(line_text, avg_size, is_bold)
                    if line_type in ("heading1", "heading2", "heading3", "list"):
                        _emit_buffer()
                        para_buffer = [line_text]
                        para_size = avg_size
                        para_bold = is_bold
                        _emit_buffer()
                    elif line_type == "empty":
                        _emit_buffer()
                    else:
                        # body — 短行（<60字）可能是标题的延续，长行合并
                        if len(line_text) < 60 and para_buffer and len(" ".join(para_buffer)) > 200:
                            _emit_buffer()
                        para_buffer.append(line_text)
                        if para_size is None:
                            para_size = avg_size
                            para_bold = is_bold

                _emit_buffer()

    except ImportError:
        logger.warning("pdfplumber 未安装，使用纯文本 fallback")
        return _extract_structured_plain(file_path)
    except Exception as e:
        logger.error(f"PDF 结构化提取失败: {e}", exc_info=True)
        return [], []

    # 如果没有识别到章节，按段落数量每 20 段生成一个虚拟章节
    if not chapters and paragraphs:
        chapters = _generate_virtual_chapters(paragraphs)
        for p in paragraphs:
            if p["chapter_id"] is None:
                # 找到对应章节
                for c in reversed(chapters):
                    if c["para_index"] <= paragraphs.index(p):
                        p["chapter_id"] = c["id"]
                        break

    return chapters, paragraphs


def _flush_line(words: list[dict], lines: list[tuple[str, float, bool]]):
    text = " ".join(w.get("text", "") for w in words).strip()
    if not text:
        return
    sizes = [w.get("size", 12) for w in words if w.get("size")]
    avg_size = sum(sizes) / len(sizes) if sizes else 12.0
    is_bold = any("bold" in (w.get("fontname") or "").lower() for w in words)
    lines.append((text, avg_size, is_bold))


def _generate_virtual_chapters(paragraphs: list[dict]) -> list[dict]:
    """当 PDF 没有明显章节标题时，按每 30 段生成虚拟章节"""
    chapters = []
    step = max(30, len(paragraphs) // 15)
    for i in range(0, len(paragraphs), step):
        cid = f"c{len(chapters)}"
        first_text = paragraphs[i]["text"][:40] + ("..." if len(paragraphs[i]["text"]) > 40 else "")
        chapters.append({"id": cid, "title": first_text, "level": 1, "para_index": i})
        for j in range(i, min(i + step, len(paragraphs))):
            if paragraphs[j]["chapter_id"] is None:
                paragraphs[j]["chapter_id"] = cid
    return chapters


def _extract_structured_plain(file_path: str) -> tuple[list[dict], list[dict]]:
    """纯文本 fallback"""
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
    except Exception:
        return [], []

    paragraphs = []
    chapters = []
    current_cid = None
    idx = 0
    for line in text.split("\n"):
        line = line.strip()
        if not line:
            continue
        ptype = _classify_paragraph(line)
        pid = f"p{idx}"
        idx += 1
        if ptype in ("heading1", "heading2"):
            cid = f"c{len(chapters)}"
            chapters.append({"id": cid, "title": line[:120], "level": int(ptype[-1]), "para_index": idx - 1})
            current_cid = cid
        paragraphs.append({"id": pid, "chapter_id": current_cid, "type": ptype, "text": line, "page": 0})

    if not chapters and paragraphs:
        chapters = _generate_virtual_chapters(paragraphs)
    return chapters, paragraphs


# ─────────────────────────────────────────────
# Word/DOCX 结构化提取
# ─────────────────────────────────────────────

def extract_structured_from_docx(file_path: str) -> tuple[list[dict], list[dict]]:
    """从 Word 文档提取结构化内容"""
    try:
        from docx import Document as DocxDoc
        doc = DocxDoc(file_path)
        paragraphs = []
        chapters = []
        current_cid = None
        idx = 0

        for para in doc.paragraphs:
            text = para.text.strip()
            if not text:
                continue

            # python-docx 提供样式名
            style_name = (para.style.name or "").lower()
            if "heading 1" in style_name or "标题 1" in style_name:
                ptype = "heading1"
            elif "heading 2" in style_name or "标题 2" in style_name:
                ptype = "heading2"
            elif "heading 3" in style_name or "标题 3" in style_name:
                ptype = "heading3"
            else:
                ptype = _classify_paragraph(text)

            pid = f"p{idx}"
            idx += 1
            if ptype in ("heading1", "heading2", "heading3"):
                cid = f"c{len(chapters)}"
                chapters.append({"id": cid, "title": text[:120], "level": int(ptype[-1]), "para_index": idx - 1})
                current_cid = cid
            paragraphs.append({"id": pid, "chapter_id": current_cid, "type": ptype, "text": text, "page": 0})

        if not chapters and paragraphs:
            chapters = _generate_virtual_chapters(paragraphs)
        return chapters, paragraphs

    except ImportError:
        logger.warning("python-docx 未安装")
        return [], []
    except Exception as e:
        logger.error(f"Word 结构化提取失败: {e}", exc_info=True)
        return [], []


def extract_structured(file_path: str, file_type: str) -> tuple[list[dict], list[dict]]:
    """按文件类型路由结构化提取"""
    if file_type == "pdf":
        return extract_structured_from_pdf(file_path)
    elif file_type == "docx":
        return extract_structured_from_docx(file_path)
    elif file_type in ("txt", "md"):
        return _extract_structured_plain(file_path)
    return [], []


# ─────────────────────────────────────────────
# 翻译服务
# ─────────────────────────────────────────────

async def translate_chapters(
    chapters: list[dict],
    paragraphs: list[dict],
    source_lang: str,
    target_lang: str,
    doc_id: int,
    db_session_factory,
) -> None:
    """
    按章节批量翻译，每翻译完一章就持久化到数据库
    在后台 asyncio.create_task 中运行
    """
    from sqlalchemy import select
    from app.models.document import Document
    from app.services.ai_service import translate_text

    # 按 chapter_id 分组段落
    chapter_paras: dict[str, list[dict]] = {}
    for p in paragraphs:
        cid = p.get("chapter_id") or "_none_"
        chapter_paras.setdefault(cid, []).append(p)

    translated_chapters: list[dict] = []
    sem = asyncio.Semaphore(3)  # 最多 3 个章节并发

    async def _translate_one_chapter(chapter: dict) -> dict | None:
        async with sem:
            cid = chapter["id"]
            paras = chapter_paras.get(cid, [])
            if not paras:
                return {"chapter_id": cid, "title_translated": chapter["title"], "paragraphs": []}

            # 将本章段落拼接后一次翻译（节省 token），每段加分隔符
            separator = "\n<<<PARA_SEP>>>\n"
            batch_text = separator.join(
                p["text"] for p in paras if p["type"] not in ("empty",)
            )
            if not batch_text.strip():
                return {"chapter_id": cid, "title_translated": chapter["title"], "paragraphs": []}

            try:
                # 章节标题翻译
                title_tr = await translate_text(chapter["title"], source_lang, target_lang)
                # 段落批量翻译
                translated_batch = await translate_text(batch_text[:12000], source_lang, target_lang)
                translated_parts = translated_batch.split("<<<PARA_SEP>>>")

                result_paras = []
                body_paras = [p for p in paras if p["type"] not in ("empty",)]
                for i, p in enumerate(body_paras):
                    tr_text = translated_parts[i].strip() if i < len(translated_parts) else ""
                    result_paras.append({"id": p["id"], "text": tr_text})

                return {"chapter_id": cid, "title_translated": title_tr.strip(), "paragraphs": result_paras}

            except Exception as e:
                logger.error(f"章节 {cid} 翻译失败: {e}")
                return None

    # 逐章翻译，边翻边持久化
    async with db_session_factory() as db:
        try:
            result = await db.execute(select(Document).where(Document.id == doc_id))
            doc = result.scalar_one_or_none()
            if not doc:
                return
            doc.translation_status = "translating"
            doc.translation_lang = target_lang
            await db.commit()
        except Exception as e:
            logger.error(f"[Doc {doc_id}] 翻译初始化失败: {e}")
            return

    for chapter in chapters:
        translated = await _translate_one_chapter(chapter)
        if translated:
            translated_chapters.append(translated)
            # 每翻完一章立即写库（允许前端分章节查看进度）
            async with db_session_factory() as db:
                try:
                    result = await db.execute(select(Document).where(Document.id == doc_id))
                    doc = result.scalar_one_or_none()
                    if doc:
                        doc.translated_content = translated_chapters
                        await db.commit()
                except Exception as e:
                    logger.error(f"[Doc {doc_id}] 翻译持久化失败: {e}")

    # 全部完成
    async with db_session_factory() as db:
        try:
            result = await db.execute(select(Document).where(Document.id == doc_id))
            doc = result.scalar_one_or_none()
            if doc:
                doc.translation_status = "done"
                doc.translated_content = translated_chapters
                await db.commit()
                logger.info(f"[Doc {doc_id}] 翻译完成 ✓ ({len(translated_chapters)} 章)")
        except Exception as e:
            logger.error(f"[Doc {doc_id}] 翻译完成持久化失败: {e}")
