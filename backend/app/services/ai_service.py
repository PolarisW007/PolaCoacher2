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
            f"请生成这一页的详细讲解文本（300-500字），语气自然，就像老师在课堂上讲解一样。"
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


async def generate_cover_image(prompt: str, save_dir: str, filename: str) -> str | None:
    """使用通义万象生成封面图"""
    if not settings.DASHSCOPE_API_KEY:
        logger.warning("DASHSCOPE_API_KEY 未配置，跳过封面图生成")
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
            size="1024*1024",
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

            return f"/covers/{filename}"
        else:
            logger.warning(f"通义万象图片生成失败: {rsp.message if hasattr(rsp, 'message') else 'unknown'}")
            return None
    except Exception as e:
        logger.error(f"封面图生成异常: {e}")
        return None
