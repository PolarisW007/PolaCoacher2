"""
内容解析服务 — 将 PDF/Word 文档解析为结构化章节+段落，供阅读器使用
支持：文字段落识别、图片提取、分页、翻译
"""
import asyncio
import logging
import re

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

    if font_size and font_size > 18:
        return "heading1"
    if font_size and font_size > 14:
        return "heading2"
    if font_size and font_size > 12 and is_bold:
        return "heading3"

    if re.match(r"^(第[一二三四五六七八九十百\d]+[章节部篇]|Chapter\s+\d+|CHAPTER\s+\d+|Part\s+\d+|Section\s+\d+)", stripped, re.IGNORECASE):
        return "heading1"
    if re.match(r"^(\d+[\.\s]\s*[A-Z\u4e00-\u9fff]|\d+\.\d+[\s\.])", stripped):
        return "heading2"
    if re.match(r"^[一二三四五六七八九十]\s*[、\.\s]\s*[\u4e00-\u9fff A-Z]", stripped):
        return "heading2"
    if re.match(r"^[（(]\s*[一二三四五六七八九十\d]\s*[)）]\s*[\u4e00-\u9fff A-Z]", stripped):
        return "heading3"
    if re.match(r"^[-•·▸◆▶●○]\s", stripped) or re.match(r"^\d+[.)]\s", stripped):
        return "list"
    return "body"


def _flush_line(words: list[dict], lines: list[tuple[str, float, bool]]):
    text = " ".join(w.get("text", "") for w in words).strip()
    if not text:
        return
    sizes = [w.get("size", 12) for w in words if w.get("size")]
    avg_size = sum(sizes) / len(sizes) if sizes else 12.0
    is_bold = any("bold" in (w.get("fontname") or "").lower() for w in words)
    lines.append((text, avg_size, is_bold))


# ─────────────────────────────────────────────
# PDF 结构化提取（带图片）
# ─────────────────────────────────────────────

def extract_structured_from_pdf(
    file_path: str,
    image_save_dir: str | None = None,
    image_url_prefix: str = "/doc_images",
) -> tuple[list[dict], list[dict]]:
    """
    从 PDF 提取结构化内容（文字 + 图片）
    返回: (chapters, paragraphs)
      paragraphs 节点类型:
        {id, chapter_id, type="body"|"heading1"|"heading2"|"list", text, page}
        {id, chapter_id, type="image", src="/doc_images/xxx.png", width, height, page}
    """
    import pathlib

    paragraphs: list[dict] = []
    chapters: list[dict] = []
    current_chapter_id: str | None = None
    para_index = 0

    # 图片去重（避免同一图片在不同层多次出现）
    seen_image_hashes: set[str] = set()

    def _add_paragraph(ptype: str, text: str, page: int, size=None, bold=False):
        nonlocal para_index, current_chapter_id
        if not text.strip():
            return
        ptype = _classify_paragraph(text, size, bold) if ptype == "auto" else ptype
        if ptype == "empty":
            return
        pid = f"p{para_index}"
        para_index += 1
        if ptype in ("heading1", "heading2", "heading3"):
            cid = f"c{len(chapters)}"
            chapters.append({"id": cid, "title": text[:120], "level": int(ptype[-1]), "para_index": para_index - 1})
            current_chapter_id = cid
        paragraphs.append({"id": pid, "chapter_id": current_chapter_id, "type": ptype, "text": text, "page": page})

    def _add_image(src: str, width: int, height: int, page: int, img_hash: str):
        nonlocal para_index
        if img_hash in seen_image_hashes:
            return
        if width < 30 or height < 30:   # 过滤装饰性小图
            return
        seen_image_hashes.add(img_hash)
        pid = f"p{para_index}"
        para_index += 1
        paragraphs.append({
            "id": pid, "chapter_id": current_chapter_id,
            "type": "image", "src": src, "width": width, "height": height,
            "text": f"[图片 {width}x{height}]", "page": page,
        })

    try:
        import pdfplumber

        # 尝试用 pymupdf 提取图片（更准确），降级到 pdfplumber
        fitz_available = False
        try:
            import fitz as pymupdf  # pymupdf
            fitz_available = True
        except ImportError:
            pass

        if image_save_dir:
            pathlib.Path(image_save_dir).mkdir(parents=True, exist_ok=True)

        # ── 用 pymupdf 提取图片 ────────────────────────
        page_images: dict[int, list[dict]] = {}   # page_num(1-based) -> [{src, width, height, y0, hash}]
        if fitz_available and image_save_dir:
            doc_fitz = None
            try:
                doc_fitz = pymupdf.open(file_path)
                for page_idx in range(len(doc_fitz)):
                    page_num = page_idx + 1
                    fitz_page = doc_fitz[page_idx]
                    img_list = fitz_page.get_images(full=True)
                    page_images[page_num] = []
                    for img_info in img_list:
                        xref = img_info[0]
                        base_img = doc_fitz.extract_image(xref)
                        if not base_img:
                            continue
                        img_bytes = base_img["image"]
                        w = base_img.get("width", 0)
                        h = base_img.get("height", 0)
                        ext = base_img.get("ext", "png")
                        if w < 30 or h < 30:
                            continue
                        import hashlib
                        img_hash = hashlib.md5(img_bytes[:256]).hexdigest()[:12]
                        img_filename = f"{img_hash}.{ext}"
                        img_path = pathlib.Path(image_save_dir) / img_filename
                        if not img_path.exists():
                            with open(img_path, "wb") as f:
                                f.write(img_bytes)
                        src = f"{image_url_prefix}/{img_filename}"
                        rects = fitz_page.get_image_rects(xref)
                        y0 = rects[0].y0 if rects else 0
                        page_images[page_num].append({
                            "src": src, "width": w, "height": h, "y0": y0, "hash": img_hash,
                        })
            except Exception as e:
                logger.warning(f"pymupdf 图片提取失败: {e}, 跳过图片")
                page_images = {}
            finally:
                if doc_fitz is not None:
                    try:
                        doc_fitz.close()
                    except Exception:
                        pass

        # ── 用 pdfplumber 提取文字 ─────────────────────
        with pdfplumber.open(file_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                # 获取该页图片（按 y0 排序，用于按位置插入）
                page_img_list = sorted(page_images.get(page_num, []), key=lambda x: x["y0"])
                img_cursor = 0   # 下一个待插入图片的索引

                def _maybe_insert_images_above(text_y: float):
                    """插入 y 坐标在 text_y 之前的图片"""
                    nonlocal img_cursor
                    while img_cursor < len(page_img_list):
                        img = page_img_list[img_cursor]
                        if img["y0"] <= text_y:
                            _add_image(img["src"], img["width"], img["height"], page_num, img["hash"])
                            img_cursor += 1
                        else:
                            break

                # 获取带字体信息的词列表
                words = page.extract_words(
                    x_tolerance=3,
                    y_tolerance=3,
                    extra_attrs=["size", "fontname"],
                ) or []

                if not words:
                    # 纯文本 fallback（仅当 extract_words 无结果时走此路径，不重复）
                    raw = page.extract_text() or ""
                    for line in raw.split("\n"):
                        _add_paragraph("auto", line.strip(), page_num)
                    # 页面剩余图片（文字之后的图片）
                    for img in page_img_list[img_cursor:]:
                        _add_image(img["src"], img["width"], img["height"], page_num, img["hash"])
                    continue

                # ── 按行聚合（相近 y 的 words 合为一行）────
                lines: list[tuple[str, float, bool, float]] = []  # (text, avg_size, is_bold, avg_top)
                current_line_words: list[dict] = []

                for w in words:
                    if current_line_words:
                        y_diff = abs(w.get("top", 0) - current_line_words[-1].get("top", 0))
                        if y_diff > 5:
                            _flush_line_with_y(current_line_words, lines)
                            current_line_words = []
                    current_line_words.append(w)
                if current_line_words:
                    _flush_line_with_y(current_line_words, lines)

                # ── 合并连续 body 行为段落 ─────────────────
                para_buffer: list[str] = []
                para_size: float | None = None
                para_bold: bool = False
                para_top: float = 0.0

                def _emit():
                    nonlocal para_buffer, para_size, para_bold
                    if not para_buffer:
                        return
                    _add_paragraph("auto", " ".join(para_buffer), page_num, para_size, para_bold)
                    para_buffer.clear()
                    para_size = None
                    para_bold = False

                for line_text, avg_size, is_bold, avg_top in lines:
                    _maybe_insert_images_above(avg_top)
                    line_type = _classify_paragraph(line_text, avg_size, is_bold)
                    if line_type in ("heading1", "heading2", "heading3", "list"):
                        _emit()
                        _add_paragraph(line_type, line_text, page_num, avg_size, is_bold)
                    elif line_type == "empty":
                        _emit()
                    else:
                        # body：短行且缓冲区已很长时换段
                        if len(line_text) < 55 and para_buffer and len(" ".join(para_buffer)) > 250:
                            _emit()
                        if para_size is None:
                            para_size = avg_size
                            para_bold = is_bold
                            para_top = avg_top
                        para_buffer.append(line_text)

                _emit()

                # 页面剩余图片（位于所有文字之后）
                for img in page_img_list[img_cursor:]:
                    _add_image(img["src"], img["width"], img["height"], page_num, img["hash"])

    except ImportError:
        logger.warning("pdfplumber 未安装，使用纯文本 fallback")
        return _extract_structured_plain(file_path), []  # type: ignore
    except Exception as e:
        logger.error(f"PDF 结构化提取失败: {e}", exc_info=True)
        return [], []

    # 如果没识别到章节，按约每 25 段生成虚拟章节
    if not chapters and paragraphs:
        chapters = _generate_virtual_chapters(paragraphs)

    return chapters, paragraphs


def _flush_line_with_y(words: list[dict], lines: list[tuple]):
    text = " ".join(w.get("text", "") for w in words).strip()
    if not text:
        return
    sizes = [w.get("size", 12) for w in words if w.get("size")]
    avg_size = sum(sizes) / len(sizes) if sizes else 12.0
    is_bold = any("bold" in (w.get("fontname") or "").lower() for w in words)
    tops = [w.get("top", 0) for w in words]
    avg_top = sum(tops) / len(tops) if tops else 0.0
    lines.append((text, avg_size, is_bold, avg_top))


def _generate_virtual_chapters(paragraphs: list[dict]) -> list[dict]:
    """当 PDF 没有明显章节标题时，按 25 段生成虚拟章节"""
    chapters = []
    step = max(25, len(paragraphs) // 20)
    for i in range(0, len(paragraphs), step):
        cid = f"c{len(chapters)}"
        p = paragraphs[i]
        first_text = p["text"][:40] + ("…" if len(p["text"]) > 40 else "")
        chapters.append({"id": cid, "title": first_text, "level": 1, "para_index": i})
        for j in range(i, min(i + step, len(paragraphs))):
            if not paragraphs[j].get("chapter_id"):
                paragraphs[j]["chapter_id"] = cid
    return chapters


def _extract_structured_plain(file_path: str) -> tuple[list[dict], list[dict]]:
    """纯文本 fallback"""
    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()
    except Exception:
        return [], []

    paragraphs, chapters = [], []
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
    try:
        from docx import Document as DocxDoc
        doc = DocxDoc(file_path)
        paragraphs, chapters = [], []
        current_cid = None
        idx = 0

        for para in doc.paragraphs:
            text = para.text.strip()
            if not text:
                continue
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


def extract_structured(
    file_path: str,
    file_type: str,
    image_save_dir: str | None = None,
    image_url_prefix: str = "/doc_images",
) -> tuple[list[dict], list[dict]]:
    """按文件类型路由结构化提取"""
    if file_type == "pdf":
        return extract_structured_from_pdf(file_path, image_save_dir, image_url_prefix)
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
    """按章节批量翻译，每翻译完一章就持久化到数据库"""
    from sqlalchemy import select
    from app.models.document import Document
    from app.services.ai_service import translate_text

    chapter_paras: dict[str, list[dict]] = {}
    for p in paragraphs:
        cid = p.get("chapter_id") or "_none_"
        chapter_paras.setdefault(cid, []).append(p)

    translated_chapters: list[dict] = []
    sem = asyncio.Semaphore(3)

    async def _translate_one(chapter: dict) -> dict | None:
        async with sem:
            cid = chapter["id"]
            paras = [p for p in chapter_paras.get(cid, []) if p["type"] not in ("empty", "image")]
            if not paras:
                return {"chapter_id": cid, "title_translated": chapter["title"], "paragraphs": []}

            separator = "\n<<<PARA_SEP>>>\n"
            batch_text = separator.join(p["text"] for p in paras)
            if not batch_text.strip():
                return {"chapter_id": cid, "title_translated": chapter["title"], "paragraphs": []}

            try:
                title_tr = await translate_text(chapter["title"], source_lang, target_lang)
                translated_batch = await translate_text(batch_text[:12000], source_lang, target_lang)
                parts = translated_batch.split("<<<PARA_SEP>>>")
                result_paras = [
                    {"id": p["id"], "text": parts[i].strip() if i < len(parts) else ""}
                    for i, p in enumerate(paras)
                ]
                return {"chapter_id": cid, "title_translated": title_tr.strip(), "paragraphs": result_paras}
            except Exception as e:
                logger.error(f"章节 {cid} 翻译失败: {e}")
                return None

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
        translated = await _translate_one(chapter)
        if translated:
            translated_chapters.append(translated)
            async with db_session_factory() as db:
                try:
                    result = await db.execute(select(Document).where(Document.id == doc_id))
                    doc = result.scalar_one_or_none()
                    if doc:
                        doc.translated_content = translated_chapters
                        await db.commit()
                except Exception as e:
                    logger.error(f"[Doc {doc_id}] 翻译持久化失败: {e}")

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
            logger.error(f"[Doc {doc_id}] 翻译完成写库失败: {e}")
