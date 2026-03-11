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


async def generate_lecture_text(slide_content: dict, page_text: str) -> str:
    """为单页生成讲解文本"""
    title = slide_content.get("title", "")
    points = slide_content.get("points", [])
    return await _call_qwen(
        prompt=(
            f"你正在为一个教学 PPT 做讲解。当前页标题是「{title}」，"
            f"要点包括：{', '.join(points)}。\n"
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
        f"摘要：{summary}\n关键点：{', '.join(key_points[:5])}\n\n"
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
        f"摘要：{summary}\n关键点：{', '.join(key_points[:5])}\n\n"
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


async def generate_image_prompt(title: str, summary: str, key_points: list[str], all_slide_points: list[str] = None) -> str:
    """基于文档内容生成适合小红书传播的、有科技感和未来感的图片 prompt"""
    kp_text = "\n".join(f"- {p}" for p in (key_points or [])[:8])
    slides_text = "\n".join(f"- {p}" for p in (all_slide_points or [])[:15])

    meta_prompt = (
        f"你是一位顶级AI绘画提示词工程师，擅长创作在小红书上高传播力的视觉内容。\n\n"
        f"书名/标题：《{title}》\n"
        f"摘要：{summary[:300]}\n"
        f"核心要点：\n{kp_text}\n"
    )
    if slides_text:
        meta_prompt += f"全文讲解要点汇总：\n{slides_text}\n"

    meta_prompt += (
        f"\n请根据以上内容，生成一段英文的AI绘画提示词(prompt)，要求：\n"
        f"1. 科技感、未来感强烈，色调以深蓝、青色、金色为主\n"
        f"2. 融入与文档主题直接相关的视觉隐喻和场景互动（不要泛泛的书本/星光）\n"
        f"3. 风格参考：赛博朋克数据流、全息投影、神经网络可视化、未来实验室等\n"
        f"4. 构图有层次感，前景有具象元素，中景有科技场景，背景有氛围光效\n"
        f"5. 适合小红书方形卡片展示，画面精致有质感\n"
        f"6. 只输出英文prompt本身，不要任何解释和前缀，不超过150词\n"
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
    """通用通义万象图片生成，返回持久化 URL 路径"""
    if not settings.DASHSCOPE_API_KEY:
        logger.warning("DASHSCOPE_API_KEY 未配置，跳过图片生成")
        return None
    try:
        import dashscope
        from dashscope import ImageSynthesis
        from pathlib import Path

        dashscope.api_key = settings.DASHSCOPE_API_KEY
        rsp = await asyncio.to_thread(
            ImageSynthesis.call,
            model="wanx2.1-t2i-turbo",
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
                img_resp = await client.get(image_url)
                img_resp.raise_for_status()
                filepath.write_bytes(img_resp.content)
            return f"{url_prefix}/{filename}"
        else:
            logger.warning(f"通义万象图片生成失败: {getattr(rsp, 'message', 'unknown')}")
            return None
    except Exception as e:
        logger.error(f"图片生成异常: {e}")
        return None


async def generate_cover_image(prompt: str, save_dir: str, filename: str) -> str | None:
    """使用通义万象生成封面图"""
    return await _call_wanx_image(prompt, save_dir, filename, "/covers", size="1024*1024")


# ──────────────────────────────────────────────
# 讲解场景图：分类 → 生成 prompt → 生成图片
# ──────────────────────────────────────────────

# 学术/理工判断关键词
_ACADEMIC_KEYWORDS = {
    "算法", "数学", "物理", "化学", "公式", "定理", "逻辑",
    "机器学习", "深度学习", "神经网络", "矩阵", "向量", "微积分",
    "函数", "统计", "概率", "数据结构", "计算机", "编程", "代码",
    "architecture", "algorithm", "theorem", "formula", "network",
    "transformer", "gradient", "tensor", "graph", "complexity",
    "论文", "研究", "实验", "模型", "框架", "优化", "训练",
}


def classify_slide_style(title: str, points: list[str], lecture_text: str) -> str:
    """判断页面风格：'academic'（赛博朋克结构图）或 'narrative'（3D吉卜力风）"""
    combined = (title + " " + " ".join(points) + " " + lecture_text[:300]).lower()
    score = sum(1 for kw in _ACADEMIC_KEYWORDS if kw.lower() in combined)
    return "academic" if score >= 2 else "narrative"


async def generate_slide_scene_prompt(
    title: str,
    points: list[str],
    lecture_text: str,
    style: str,
) -> str:
    """根据风格生成场景图的英文绘画提示词"""
    points_str = "、".join(points[:4]) if points else title
    text_snippet = lecture_text[:400]

    if style == "academic":
        system_prompt = (
            "You are a cyberpunk technical illustration prompt engineer. "
            "Create vivid, detailed English prompts for structure diagrams in cyberpunk style. "
            "Output ONLY the English prompt, no explanations, max 120 words."
        )
        user_prompt = (
            f"Create a cyberpunk-style structural diagram illustration prompt for the concept:\n"
            f"Title: {title}\nKey points: {points_str}\nContext: {text_snippet[:200]}\n\n"
            f"Requirements: neon glowing circuit diagrams, holographic data flows, dark background with electric blue/purple/cyan accents, "
            f"geometric nodes and connections representing the concept, floating mathematical symbols, futuristic lab aesthetic. "
            f"The image should visually explain the structure or process described."
        )
    else:
        system_prompt = (
            "You are a Studio Ghibli 3D animation scene prompt engineer. "
            "Create warm, detailed English prompts for narrative scenes in Ghibli 3D style. "
            "Output ONLY the English prompt, no explanations, max 120 words."
        )
        user_prompt = (
            f"Create a Studio Ghibli 3D style scene illustration prompt for this narrative content:\n"
            f"Title: {title}\nKey points: {points_str}\nContext: {text_snippet[:200]}\n\n"
            f"Requirements: warm sunlight, lush natural environments, whimsical magical details, "
            f"3D rendered in Ghibli aesthetic (like Howl's Moving Castle / Spirited Away style), "
            f"soft color palette, intricate background details, characters or symbolic objects that represent the story/concept. "
            f"Cinematic wide shot, high quality 3D render."
        )

    result = await _call_qwen(
        user_prompt,
        system=system_prompt,
        temperature=0.85,
        max_tokens=200,
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
) -> str | None:
    """
    为单页讲解生成场景图：自动分类风格 → 生成 prompt → 调用万象 API → 持久化
    返回图片 URL（如 /slide_images/doc_2_slide_0.png），失败返回 None
    """
    from pathlib import Path

    filename = f"doc_{doc_id}_slide_{slide_idx}.png"
    filepath = settings.SLIDE_IMAGES_DIR / filename

    # 已有则直接返回
    if filepath.exists() and filepath.stat().st_size > 1000:
        logger.info(f"[Doc {doc_id}] Slide {slide_idx} 场景图已存在，复用")
        return f"/slide_images/{filename}"

    style = classify_slide_style(title, points, lecture_text)
    logger.info(f"[Doc {doc_id}] Slide {slide_idx} 场景图风格: {style}")

    img_prompt = await generate_slide_scene_prompt(title, points, lecture_text, style)
    logger.info(f"[Doc {doc_id}] Slide {slide_idx} prompt: {img_prompt[:80]}...")

    url = await _call_wanx_image(
        img_prompt,
        str(settings.SLIDE_IMAGES_DIR),
        filename,
        "/slide_images",
        size="1024*576",  # 16:9 横幅场景图
    )
    return url
