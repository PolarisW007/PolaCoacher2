"""
AI 服务 — 封装阿里云 DashScope (通义千问 Qwen) 调用，含自动重试与降级
"""
import asyncio
import json as _json
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

QWEN_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"

_MAX_RETRIES = 3
_RETRY_BACKOFF = [2, 5, 10]


async def _call_qwen(
    prompt: str,
    system: str = "",
    model: str = "qwen-plus",
    max_tokens: int = 4096,
    temperature: float = 0.7,
) -> str:
    """调用通义千问模型，内置 3 次指数退避重试"""
    if not settings.DASHSCOPE_API_KEY:
        logger.warning("DASHSCOPE_API_KEY 未配置，返回模拟数据")
        return f"[模拟 AI 响应] 基于提示生成的内容（API Key 未配置）\n提示摘要: {prompt[:100]}..."

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    last_exc: Exception | None = None
    for attempt in range(_MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    QWEN_API_URL,
                    headers={
                        "Authorization": f"Bearer {settings.DASHSCOPE_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": model,
                        "messages": messages,
                        "temperature": temperature,
                        "max_tokens": max_tokens,
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                return data["choices"][0]["message"]["content"]
        except Exception as exc:
            last_exc = exc
            wait = _RETRY_BACKOFF[attempt] if attempt < len(_RETRY_BACKOFF) else 10
            logger.warning(f"Qwen API 调用失败 (attempt {attempt + 1}): {exc}, {wait}s 后重试")
            await asyncio.sleep(wait)

    logger.error(f"Qwen API 调用彻底失败: {last_exc}")
    return f"[AI 服务暂时不可用] 请稍后重试。"


async def generate_summary(text: str) -> str:
    """生成文档摘要"""
    return await _call_qwen(
        prompt=f"请为以下文档内容生成一段精炼的中文摘要（300字以内）：\n\n{text[:8000]}",
        system="你是一个专业的文档分析助手，擅长提炼文档核心内容。",
    )


async def extract_key_points(text: str) -> list[str]:
    """提取关键知识点"""
    result = await _call_qwen(
        prompt=f"请从以下文档中提取5-10个关键知识点，每个知识点一行，用数字编号：\n\n{text[:8000]}",
        system="你是一个知识提取专家，擅长从文档中提炼关键信息。",
    )
    points = []
    for line in result.strip().split("\n"):
        line = line.strip()
        if line and any(line.startswith(f"{i}") for i in range(1, 20)):
            cleaned = line.lstrip("0123456789.、)）").strip()
            if cleaned:
                points.append(cleaned)
    return points or [result[:200]]


async def generate_ppt_content(text: str, page_count: int) -> list[dict]:
    """生成 PPT 结构化内容"""
    num_slides = min(max(page_count, 5), 20)
    result = await _call_qwen(
        prompt=(
            f"请将以下文档内容整理为 {num_slides} 页 PPT 的结构化内容，"
            f"每页包含标题(title)和3-5个要点(points)。"
            f"请用 JSON 数组格式输出，格式如下：\n"
            f'[{{"slide": 1, "title": "标题", "points": ["要点1", "要点2"]}}]\n\n'
            f"{text[:8000]}"
        ),
        system="你是一个PPT内容策划专家。请只输出纯JSON格式，不要添加其他文字。",
    )
    try:
        import json
        cleaned = result.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(cleaned)
    except Exception:
        return [{"slide": 1, "title": "文档概述", "points": [result[:300]]}]


def _flatten_points(points: list) -> str:
    """将 points 安全展平为逗号分隔字符串（AI 有时返回嵌套列表）"""
    flat = []
    for p in points:
        if isinstance(p, list):
            flat.extend(str(x) for x in p)
        else:
            flat.append(str(p))
    return ", ".join(flat)


async def generate_lecture_text(slide_content: dict, page_text: str) -> str:
    """为单页生成讲解文本"""
    title = slide_content.get("title", "")
    points = slide_content.get("points", [])
    return await _call_qwen(
        prompt=(
            f"你正在为一个教学 PPT 做讲解。当前页标题是「{title}」，"
            f"要点包括：{_flatten_points(points)}。\n"
            f"原文参考：{page_text[:2000]}\n\n"
            f"请生成这一页的详细讲解文本（300-500字）。请直接开始阐述内容，不要使用“同学们好”或“大家好”之类的开场白，语气要自然。"
        ),
        system="你是一位经验丰富的老师，擅长将复杂概念用通俗易懂的方式讲解。",
    )


async def translate_text(text: str, source_lang: str = "en", target_lang: str = "zh") -> str:
    """翻译文本"""
    lang_map = {"en": "英文", "zh": "中文"}
    return await _call_qwen(
        prompt=(
            f"请将以下{lang_map.get(source_lang, source_lang)}文本翻译为"
            f"{lang_map.get(target_lang, target_lang)}，保持原文格式和专业术语准确性：\n\n{text}"
        ),
        system="你是一位专业翻译，精通中英文互译。",
    )


async def chat_with_document(
    question: str,
    doc_text: str,
    history: list[dict] | None = None,
) -> str:
    """基于文档内容进行 AI 对话"""
    system = (
        "你是一个文档助手。请基于以下文档内容回答用户问题。\n"
        "回答要求：\n"
        "1. 如果答案在文档中能找到，请在回答中用「📖 原文出处：」标注引用的原文段落\n"
        "2. 如果文档中有多处相关内容，请分别引用\n"
        "3. 如果问题与文档无关或文档中找不到答案，请坦诚告知\n"
        "4. 回答语言与用户提问语言一致\n\n"
        f"【文档内容】\n{doc_text[:6000]}"
    )
    messages_text = ""
    if history:
        for msg in history[-10:]:
            role = "用户" if msg["role"] == "user" else "助手"
            messages_text += f"\n{role}: {msg['content']}"
    prompt = f"{messages_text}\n用户: {question}" if messages_text else question
    return await _call_qwen(prompt=prompt, system=system)


async def generate_xhs_content(summary: str, key_points: list[str]) -> dict:
    """生成小红书风格图文"""
    prompt = (
        f"基于以下文档信息，生成一篇小红书风格的图文帖子。\n"
        f"摘要：{summary}\n关键点：{_flatten_points(key_points[:5])}\n\n"
        f"请输出 JSON，格式：{{'title': '标题（含 emoji）', 'content': '正文（含 emoji 和换行）', "
        f"'cover_prompt': '封面图 AI 画图提示词（英文）', "
        f"'slides': [{{'text': '幻灯片文字'}}]}}"
    )
    result = await _call_qwen(
        prompt=prompt,
        system="你是小红书内容创作专家，擅长用吸引眼球的标题和精美排版吸引读者。只输出JSON。",
    )
    try:
        cleaned = result.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
        return _json.loads(cleaned)
    except Exception:
        return {"title": "AI 知识分享", "content": result[:500], "cover_prompt": "knowledge sharing illustration", "slides": []}


async def generate_moments_content(summary: str, key_points: list[str]) -> dict:
    """生成朋友圈风格文案"""
    prompt = (
        f"基于以下文档信息，生成一条朋友圈文案。\n"
        f"摘要：{summary}\n关键点：{_flatten_points(key_points[:5])}\n\n"
        f"请输出 JSON，格式：{{'title': '标题', 'content': '文案（简洁有深度，150字以内）', "
        f"'cover_prompt': '配图 AI 画图提示词（英文）'}}"
    )
    result = await _call_qwen(
        prompt=prompt,
        system="你是社交媒体文案专家，擅长写简洁有深度的朋友圈分享。只输出JSON。",
    )
    try:
        cleaned = result.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
        return _json.loads(cleaned)
    except Exception:
        return {"title": "读书笔记", "content": result[:200], "cover_prompt": "reading illustration"}


# ──────────────────────────────────────────────
# 文档类型 → 风格基底映射
# ──────────────────────────────────────────────

_DOC_TYPE_STYLE_BASE: dict[str, str] = {
    "academic": (
        "clean educational illustration style, textbook diagram aesthetic, "
        "soft light background, precise linework, scientific visualization, "
        "infographic quality, clear and informative layout"
    ),
    "literature": (
        "literary book illustration style, atmospheric narrative scene, "
        "painterly texture with visible brushstrokes, emotional depth, "
        "muted but rich color palette, storytelling composition"
    ),
    "history": (
        "historical illustration style, classical painting aesthetic, "
        "period-accurate details, warm earth tones, documentary visual style, "
        "museum quality artwork, historically evocative atmosphere"
    ),
    "science_pop": (
        "National Geographic quality illustration, nature documentary aesthetic, "
        "photorealistic natural environment, scientifically accurate depiction, "
        "vibrant natural colors, awe-inspiring and educational visual"
    ),
    "philosophy": (
        "surrealist philosophical illustration, symbolic visual metaphor, "
        "René Magritte-inspired dreamlike realism, thought-provoking visual paradox, "
        "deep conceptual imagery, muted sophisticated palette with accent highlights"
    ),
    "tech_dev": (
        "modern tech illustration, flat design with subtle 3D depth, "
        "isometric or semi-isometric perspective, clean code-inspired aesthetics, "
        "dark navy or clean white background, professional software engineering visual"
    ),
    "known_ip": "",  # 动态填入，由 ip_info 决定
}

# 构图类型轮转序列
_COMPOSITION_ROTATION = [
    ("panoramic_scene", "Wide panoramic scene showing the overall environment and atmosphere"),
    ("focal_subject",   "Single focal subject centered, background softly blurred, conveying the key concept"),
    ("process_diagram", "Process flow or relationship diagram with arrows, nodes, and connections"),
    ("symbolic_still",  "Meaningful symbolic still-life composition with metaphorical objects"),
    ("split_comparison","Left-right split or before-after comparison layout"),
]

# 对比触发词
_COMPARISON_KEYWORDS = {"对比", "vs", "区别", "差异", "比较", "versus", "compare", "difference", "优缺点", "利弊"}


async def classify_document_type(title: str, summary: str, text_sample: str) -> dict:
    """
    调用 Qwen 一次性判断文档类型和已知IP信息。
    返回: {
        "doc_type": "academic"|"literature"|"history"|"science_pop"|"philosophy"|"tech_dev"|"known_ip",
        "ip_name": str | None,
        "ip_visual_style": str | None,
    }
    """
    prompt = f"""分析以下文档，完成两项任务并以JSON格式返回：

文档标题：《{title}》
摘要：{summary[:400]}
内容样本：{text_sample[:600]}

任务1：判断文档属于以下哪种类型（只能选一个）：
- academic：学术论文、技术报告、研究文献
- literature：文学作品、小说、诗歌、散文、戏剧
- history：历史书籍、人物传记、考古、人文社科
- science_pop：科普读物、自然百科、医学健康
- philosophy：哲学著作、社会学、心理学、思想类
- tech_dev：编程教程、技术文档、软件架构、开发指南
- known_ip：对应已知影视/游戏/书籍IP的学习材料（如对某部名著或知名作品的解读）

任务2：判断该文档是否与某个知名IP作品（影视、游戏、经典名著）直接相关。
如果是，填写IP名称和该IP的视觉风格描述（英文）；如果不是，填null。

只输出JSON，格式如下：
{{"doc_type": "类型", "ip_name": "IP名称或null", "ip_visual_style": "英文视觉风格描述或null"}}"""

    result = await _call_qwen(
        prompt,
        system="You are a document analysis expert. Output ONLY valid JSON, no explanations.",
        temperature=0.3,
        max_tokens=200,
    )
    try:
        cleaned = result.strip()
        if cleaned.startswith("```"):
            cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0]
        data = _json.loads(cleaned)
        doc_type = data.get("doc_type", "science_pop")
        if doc_type not in _DOC_TYPE_STYLE_BASE:
            doc_type = "science_pop"
        return {
            "doc_type": doc_type,
            "ip_name": data.get("ip_name"),
            "ip_visual_style": data.get("ip_visual_style"),
        }
    except Exception:
        logger.warning(f"文档类型识别解析失败，降级为 science_pop，原始响应: {result[:200]}")
        return {"doc_type": "science_pop", "ip_name": None, "ip_visual_style": None}


def determine_composition_type(slide_idx: int, lecture_text: str, is_last: bool = False) -> tuple[str, str]:
    """
    决定当前页的构图类型。
    返回 (composition_type, composition_desc)
    """
    # 结论/总结页强制用象征静物
    if is_last:
        return _COMPOSITION_ROTATION[3]

    # 包含对比词汇时强制用对比构图
    combined = lecture_text[:300].lower()
    if any(kw in combined for kw in _COMPARISON_KEYWORDS):
        return _COMPOSITION_ROTATION[4]

    # 封面页（第0页）强制全景
    if slide_idx == 0:
        return _COMPOSITION_ROTATION[0]

    return _COMPOSITION_ROTATION[slide_idx % len(_COMPOSITION_ROTATION)]


async def generate_image_prompt(
    title: str,
    summary: str,
    key_points: list[str],
    all_slide_points: list[str] = None,
    doc_type: str = "science_pop",
    ip_info: dict | None = None,
) -> str:
    """基于文档内容和类型生成封面/分享图的英文画图 prompt"""
    kp_text = "\n".join(f"- {p}" for p in _flatten_points(key_points or []).split(", ")[:8])
    slides_text = "\n".join(f"- {p}" for p in _flatten_points(all_slide_points or []).split(", ")[:15])

    style_base = _DOC_TYPE_STYLE_BASE.get(doc_type, _DOC_TYPE_STYLE_BASE["science_pop"])
    if doc_type == "known_ip" and ip_info and ip_info.get("ip_visual_style"):
        style_base = ip_info["ip_visual_style"]

    ip_block = ""
    if ip_info and ip_info.get("ip_name"):
        ip_block = f"该文档对应知名IP作品：《{ip_info['ip_name']}》，请参考该IP的视觉风格。\n"

    meta_prompt = (
        f"你是一位顶级AI绘画提示词工程师。\n\n"
        f"文档标题：《{title}》\n"
        f"文档类型：{doc_type}\n"
        f"风格基底：{style_base}\n"
        f"{ip_block}"
        f"摘要：{summary[:300]}\n"
        f"核心要点：\n{kp_text}\n"
    )
    if slides_text:
        meta_prompt += f"全文讲解要点汇总：\n{slides_text}\n"

    meta_prompt += (
        f"\n请根据以上内容，生成一段英文的AI绘画提示词(prompt)，要求：\n"
        f"1. 严格遵循风格基底（{style_base[:60]}...）\n"
        f"2. 画面内容与文档主题强相关，使用具体的视觉隐喻，不要泛泛的书本/星光\n"
        f"3. 构图采用宏观全景，适合方形封面展示，画面精致有质感\n"
        f"4. 结尾加上：masterpiece, best quality, highly detailed, professional illustration\n"
        f"5. 只输出英文prompt本身，不要任何解释和前缀，不超过150词\n"
    )

    result = await _call_qwen(
        meta_prompt,
        system="You are an expert AI art prompt engineer. Output ONLY the English prompt, nothing else.",
        temperature=0.9,
        max_tokens=300,
    )
    cleaned = result.strip().strip('"').strip("'")
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return cleaned


async def _call_wanx_image(prompt: str, save_dir: str, filename: str, url_prefix: str, size: str = "1024*576") -> str | None:
    """通用通义万象图片生成（wanx2.1-t2i-plus），流式写入磁盘，内存峰值 ≤ 5MB"""
    if not settings.DASHSCOPE_API_KEY:
        logger.warning("DASHSCOPE_API_KEY 未配置，跳过图片生成")
        return None
    try:
        import dashscope
        from dashscope import ImageSynthesis
        from pathlib import Path

        _stream_chunk = settings.STREAM_CHUNK_BYTES

        dashscope.api_key = settings.DASHSCOPE_API_KEY
        rsp = await asyncio.to_thread(
            ImageSynthesis.call,
            model="wanx2.1-t2i-plus",
            prompt=prompt,
            n=1,
            size=size,
        )
        if rsp.status_code == 200 and rsp.output and rsp.output.results:
            image_url = rsp.output.results[0].url
            save_path = Path(save_dir)
            save_path.mkdir(parents=True, exist_ok=True)
            filepath = save_path / filename
            async with httpx.AsyncClient(timeout=60) as client:
                async with client.stream("GET", image_url) as img_resp:
                    img_resp.raise_for_status()
                    with open(filepath, "wb") as f:
                        async for chunk in img_resp.aiter_bytes(_stream_chunk):
                            f.write(chunk)
            return f"{url_prefix}/{filename}"
        else:
            logger.warning(f"通义万象图片生成失败: {getattr(rsp, 'message', 'unknown')}")
            return None
    except Exception as e:
        logger.error(f"图片生成异常: {e}")
        return None


async def generate_cover_image(prompt: str, save_dir: str, filename: str) -> str | None:
    """使用通义万象生成封面图（1024×1024 方形）"""
    return await _call_wanx_image(prompt, save_dir, filename, "/covers", size="1024*1024")


# ──────────────────────────────────────────────
# 讲解场景图 v2：七类型 + 五构图轮转
# ──────────────────────────────────────────────

# 保留旧函数签名供内部兼容调用（内部直接用 v2 实现）
def classify_slide_style(title: str, points: list[str], lecture_text: str) -> str:
    """兼容旧调用：返回 doc_type 字符串（使用关键词粗分类）"""
    combined = (title + " " + _flatten_points(points) + " " + lecture_text[:300]).lower()
    tech_kws = {"算法", "公式", "定理", "机器学习", "深度学习", "神经网络", "architecture", "algorithm",
                "theorem", "transformer", "gradient", "tensor", "论文", "研究", "实验", "模型", "框架"}
    tech_score = sum(1 for kw in tech_kws if kw in combined)
    code_kws = {"代码", "编程", "函数", "数据结构", "api", "数据库", "开发", "部署"}
    code_score = sum(1 for kw in code_kws if kw in combined)
    hist_kws = {"朝代", "历史", "传记", "古代", "史料", "考古"}
    hist_score = sum(1 for kw in hist_kws if kw in combined)
    phil_kws = {"哲学", "思想", "意识", "存在", "批判", "伦理"}
    phil_score = sum(1 for kw in phil_kws if kw in combined)

    if tech_score >= 2:
        return "academic"
    if code_score >= 2:
        return "tech_dev"
    if hist_score >= 1:
        return "history"
    if phil_score >= 1:
        return "philosophy"
    return "literature"


async def generate_slide_scene_prompt_v2(
    doc_type: str,
    ip_info: dict | None,
    composition_type: str,
    composition_desc: str,
    slide_title: str,
    slide_points: list[str],
    lecture_text: str,
) -> str:
    """v2：根据文档类型 + 构图类型生成高质量场景图提示词"""
    style_base = _DOC_TYPE_STYLE_BASE.get(doc_type, _DOC_TYPE_STYLE_BASE["science_pop"])
    if doc_type == "known_ip" and ip_info and ip_info.get("ip_visual_style"):
        style_base = ip_info["ip_visual_style"]

    ip_block = ""
    if ip_info and ip_info.get("ip_name"):
        ip_block = (
            f"This content is from the known IP work: {ip_info['ip_name']}. "
            f"Visual style reference: {ip_info.get('ip_visual_style', '')}. "
        )

    points_str = _flatten_points(slide_points[:4]) if slide_points else slide_title
    text_snippet = lecture_text[:300]

    user_prompt = f"""Create an illustration prompt for an educational lecture slide.

Document type: {doc_type}
Style base: {style_base}
{ip_block}
Composition type: {composition_type} — {composition_desc}

Slide title: {slide_title}
Key points: {points_str}
Lecture context: {text_snippet}

Requirements:
1. Use the specified style base as the visual foundation
2. Visually represent the key points on this slide in a way readers can understand intuitively
3. Follow the {composition_type} composition strictly
4. Include specific visual elements directly referenced by the content (avoid generic imagery)
5. End with: masterpiece, best quality, highly detailed, professional illustration, cinematic lighting
6. Output ONLY the English prompt, max 150 words"""

    system_prompt = (
        "You are an expert AI art director for educational content. "
        "Create detailed, content-relevant English image prompts. "
        "Output ONLY the English prompt, no explanations."
    )

    result = await _call_qwen(
        user_prompt,
        system=system_prompt,
        temperature=0.85,
        max_tokens=250,
    )
    cleaned = result.strip().strip('"').strip("'")
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return cleaned


async def generate_slide_scene_image(
    doc_id: int,
    slide_idx: int,
    title: str,
    points: list[str],
    lecture_text: str,
    doc_type: str = "",
    ip_info: dict | None = None,
    total_slides: int = 0,
) -> str | None:
    """
    为单页讲解生成场景图（v2）：
    文档类型 + 构图轮转 → 生成 prompt → 调用万象 Plus → 持久化
    返回图片 URL（如 /slide_images/doc_2_slide_0.png），失败返回 None
    """
    from pathlib import Path

    filename = f"doc_{doc_id}_slide_{slide_idx}.png"
    filepath = settings.SLIDE_IMAGES_DIR / filename

    if filepath.exists() and filepath.stat().st_size > 1000:
        logger.info(f"[Doc {doc_id}] Slide {slide_idx} 场景图已存在，复用")
        return f"/slide_images/{filename}"

    # 若未传入文档类型，使用关键词粗分类兜底
    effective_doc_type = doc_type if doc_type else classify_slide_style(title, points, lecture_text)

    is_last = (total_slides > 0 and slide_idx == total_slides - 1)
    composition_type, composition_desc = determine_composition_type(slide_idx, lecture_text, is_last)

    logger.info(f"[Doc {doc_id}] Slide {slide_idx} | 类型={effective_doc_type} | 构图={composition_type}")

    img_prompt = await generate_slide_scene_prompt_v2(
        doc_type=effective_doc_type,
        ip_info=ip_info,
        composition_type=composition_type,
        composition_desc=composition_desc,
        slide_title=title,
        slide_points=points,
        lecture_text=lecture_text,
    )
    logger.info(f"[Doc {doc_id}] Slide {slide_idx} prompt: {img_prompt[:100]}...")

    url = await _call_wanx_image(
        img_prompt,
        str(settings.SLIDE_IMAGES_DIR),
        filename,
        "/slide_images",
        size="1024*576",
    )
    return url
