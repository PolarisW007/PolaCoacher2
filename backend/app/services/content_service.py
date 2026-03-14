"""
内容解析服务 — 将 PDF/Word 文档解析为结构化章节+段落，供阅读器使用
支持：文字段落识别、图片提取、分页、翻译

提取策略（优先级）：
  1. pymupdf — 字词边界准确，支持多栏检测，图文同步提取
  2. pdfplumber — pymupdf 不可用时的备选方案
"""
import asyncio
import logging
import re

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# 文字后处理工具
# ─────────────────────────────────────────────

def _post_process_text(text: str) -> str:
    """
    修复 PDF 提取常见的文字质量问题：
      1. 字母间距标题 "R E L A T E D  W O R K" → "RELATED WORK"
      2. 多余空格清理
      3. 纯页码行过滤
    """
    if not text:
        return text

    tokens = text.split()
    if not tokens:
        return text

    # 1. 检测并修复字母间距（letter-spaced）文字
    #    如果 70%+ 的 token 都是单个字母，则将连续单字母 token 合并
    single_alpha = [t for t in tokens if len(t) == 1 and t.isalpha()]
    if len(single_alpha) >= max(3, len(tokens) * 0.65):
        merged = []
        buf = []
        for t in tokens:
            if len(t) == 1 and t.isalpha():
                buf.append(t)
            else:
                if buf:
                    merged.append("".join(buf))
                    buf = []
                merged.append(t)
        if buf:
            merged.append("".join(buf))
        text = " ".join(merged)
        tokens = text.split()

    # 2. 清理多余空白
    text = re.sub(r" {2,}", " ", text).strip()

    # 3. 纯数字行（很可能是页码）
    if re.match(r"^\d{1,4}$", text.strip()):
        return ""

    return text


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



# ─────────────────────────────────────────────
# PDF 结构化提取（带图片）
# 优先使用 pymupdf，备选 pdfplumber
# ─────────────────────────────────────────────

def extract_structured_from_pdf(
    file_path: str,
    image_save_dir: str | None = None,
    image_url_prefix: str = "/doc_images",
) -> tuple[list[dict], list[dict]]:
    """
    从 PDF 提取结构化内容（文字 + 图片）。
    返回: (chapters, paragraphs)
    """
    import pathlib

    if image_save_dir:
        pathlib.Path(image_save_dir).mkdir(parents=True, exist_ok=True)

    # ── 优先 pymupdf（更好的字词边界+多栏支持）────
    try:
        import fitz as _fitz
        return _extract_with_pymupdf(file_path, image_save_dir, image_url_prefix, _fitz)
    except ImportError:
        logger.info("pymupdf 不可用，使用 pdfplumber")
    except Exception as e:
        logger.warning(f"pymupdf 提取失败 ({e})，降级 pdfplumber")

    # ── 备选 pdfplumber ────────────────────────────
    return _extract_with_pdfplumber(file_path, image_save_dir, image_url_prefix)


def _extract_with_pymupdf(
    file_path: str,
    image_save_dir: str | None,
    image_url_prefix: str,
    fitz,
) -> tuple[list[dict], list[dict]]:
    """
    使用 pymupdf 提取 PDF 文字和图片。
    特性：
     - get_text("words") 按字符级坐标精确分词，解决字符拼合问题
     - 双栏检测：按页面宽度中线分左右栏，按栏序依次输出
     - 图片提取：inline + 页面图像
    """
    import pathlib, hashlib

    paragraphs: list[dict] = []
    chapters: list[dict] = []
    current_chapter_id: str | None = None
    para_index = 0
    seen_image_hashes: set[str] = set()

    def _add_para(ptype: str, text: str, page: int, size: float | None = None, bold: bool = False):
        nonlocal para_index, current_chapter_id
        text = _post_process_text(text.strip())
        if not text:
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
        paragraphs.append({"id": pid, "chapter_id": current_chapter_id,
                           "type": ptype, "text": text, "page": page})

    def _add_image(src: str, w: int, h: int, page: int, img_hash: str):
        nonlocal para_index
        if img_hash in seen_image_hashes or w < 40 or h < 40:
            return
        seen_image_hashes.add(img_hash)
        pid = f"p{para_index}"
        para_index += 1
        paragraphs.append({"id": pid, "chapter_id": current_chapter_id,
                           "type": "image", "src": src, "width": w, "height": h,
                           "text": f"[图片 {w}x{h}]", "page": page})

    doc = fitz.open(file_path)
    try:
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            page_num = page_idx + 1
            page_w = page.rect.width

            # ── 提取图片 ────────────────────────────────
            if image_save_dir:
                for img_info in page.get_images(full=True):
                    xref = img_info[0]
                    try:
                        base_img = doc.extract_image(xref)
                        if not base_img:
                            continue
                        img_bytes = base_img["image"]
                        w_i = base_img.get("width", 0)
                        h_i = base_img.get("height", 0)
                        ext = base_img.get("ext", "png")
                        if w_i < 40 or h_i < 40:
                            continue
                        img_hash = hashlib.md5(img_bytes[:512]).hexdigest()[:12]
                        if img_hash in seen_image_hashes:
                            continue
                        img_fn = f"{img_hash}.{ext}"
                        img_path = pathlib.Path(image_save_dir) / img_fn
                        if not img_path.exists():
                            img_path.write_bytes(img_bytes)
                        _add_image(f"{image_url_prefix}/{img_fn}", w_i, h_i, page_num, img_hash)
                    except Exception:
                        pass

            # ── 提取文字（word 级）─────────────────────
            # 返回 (x0, y0, x1, y1, word, block_no, line_no, word_no)
            raw_words = page.get_text("words") or []
            if not raw_words:
                continue

            # ── 双栏检测 ─────────────────────────────────
            # 统计 word 中心 x 落在页面中间 20% 区域的占比；占比低 → 双栏
            mid_lo, mid_hi = page_w * 0.4, page_w * 0.6
            mid_count = sum(1 for w in raw_words if mid_lo < (w[0] + w[2]) / 2 < mid_hi)
            is_two_col = (len(raw_words) >= 10) and (mid_count < len(raw_words) * 0.12)

            if is_two_col:
                col_cut = page_w / 2
                left_w  = sorted([w for w in raw_words if (w[0] + w[2]) / 2 < col_cut],
                                  key=lambda w: (round(w[1] / 3), w[0]))
                right_w = sorted([w for w in raw_words if (w[0] + w[2]) / 2 >= col_cut],
                                  key=lambda w: (round(w[1] / 3), w[0]))
                ordered = left_w + right_w
            else:
                ordered = sorted(raw_words, key=lambda w: (round(w[1] / 3), w[0]))

            # ── 按行聚合 ──────────────────────────────────
            lines: list[list] = []
            curr: list = []
            for wd in ordered:
                if curr:
                    dy = abs(wd[1] - curr[-1][1])
                    if dy > 4:
                        lines.append(curr)
                        curr = []
                curr.append(wd)
            if curr:
                lines.append(curr)

            # ── 行 → 段落 ─────────────────────────────────
            para_buf: list[str] = []
            para_size: float | None = None

            def _flush_buf():
                nonlocal para_buf, para_size
                if para_buf:
                    _add_para("auto", " ".join(para_buf), page_num, para_size)
                    para_buf = []
                    para_size = None

            for line_words in lines:
                line_text = " ".join(w[4] for w in line_words).strip()
                if not line_text:
                    continue
                line_text = _post_process_text(line_text)
                if not line_text:
                    continue

                # 使用 block_no 估算字体大小（粗略）
                ltype = _classify_paragraph(line_text)

                if ltype in ("heading1", "heading2", "heading3", "list"):
                    _flush_buf()
                    _add_para(ltype, line_text, page_num)
                else:
                    # 短行（<60 字符）且缓冲区已足够 → 换段
                    if len(line_text) < 60 and para_buf and len(" ".join(para_buf)) > 300:
                        _flush_buf()
                    para_buf.append(line_text)
                    if para_size is None:
                        para_size = 11.0

            _flush_buf()

    finally:
        try:
            doc.close()
        except Exception:
            pass

    if not chapters and paragraphs:
        chapters = _generate_virtual_chapters(paragraphs)

    return chapters, paragraphs


def _extract_with_pdfplumber(
    file_path: str,
    image_save_dir: str | None,
    image_url_prefix: str,
) -> tuple[list[dict], list[dict]]:
    """
    pdfplumber 备用提取路径（当 pymupdf 不可用时）。
    使用 extract_text() 而非 extract_words()，规避字间距引起的拼合问题。
    """
    import pathlib, hashlib

    paragraphs: list[dict] = []
    chapters: list[dict] = []
    current_chapter_id: str | None = None
    para_index = 0
    seen_image_hashes: set[str] = set()

    def _add_para(ptype: str, text: str, page: int, size=None, bold=False):
        nonlocal para_index, current_chapter_id
        text = _post_process_text(text.strip())
        if not text:
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
        paragraphs.append({"id": pid, "chapter_id": current_chapter_id,
                           "type": ptype, "text": text, "page": page})

    try:
        import pdfplumber

        with pdfplumber.open(file_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                # 先尝试带词信息的提取（x_tolerance 放宽到 6，减少错误拼合）
                words = page.extract_words(
                    x_tolerance=6, y_tolerance=4,
                    extra_attrs=["size", "fontname"],
                ) or []

                if words:
                    # 按行聚合
                    lines: list[tuple] = []
                    curr_words: list[dict] = []
                    for w in words:
                        if curr_words:
                            dy = abs(w.get("top", 0) - curr_words[-1].get("top", 0))
                            if dy > 5:
                                _flush_line_with_y(curr_words, lines)
                                curr_words = []
                        curr_words.append(w)
                    if curr_words:
                        _flush_line_with_y(curr_words, lines)

                    para_buf: list[str] = []
                    para_size: float | None = None
                    para_bold: bool = False

                    def _emit():
                        nonlocal para_buf, para_size, para_bold
                        if para_buf:
                            _add_para("auto", " ".join(para_buf), page_num, para_size, para_bold)
                            para_buf.clear()
                            para_size = None
                            para_bold = False

                    for line_text, avg_size, is_bold, _ in lines:
                        line_text = _post_process_text(line_text)
                        if not line_text:
                            continue
                        ltype = _classify_paragraph(line_text, avg_size, is_bold)
                        if ltype in ("heading1", "heading2", "heading3", "list"):
                            _emit()
                            _add_para(ltype, line_text, page_num, avg_size, is_bold)
                        elif ltype == "empty":
                            _emit()
                        else:
                            if len(line_text) < 55 and para_buf and len(" ".join(para_buf)) > 250:
                                _emit()
                            if para_size is None:
                                para_size = avg_size
                                para_bold = is_bold
                            para_buf.append(line_text)
                    _emit()
                else:
                    # fallback: extract_text
                    raw = page.extract_text() or ""
                    for line in raw.split("\n"):
                        line = _post_process_text(line.strip())
                        if line:
                            _add_para("auto", line, page_num)

    except ImportError:
        logger.warning("pdfplumber 未安装，使用纯文本 fallback")
        chs, paras = _extract_structured_plain(file_path)
        return chs, paras
    except Exception as e:
        logger.error(f"pdfplumber 提取失败: {e}", exc_info=True)
        return [], []

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
