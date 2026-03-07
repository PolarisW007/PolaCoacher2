"""
AI 服务 — 封装阿里云 DashScope (通义千问 Qwen) 调用
"""
import asyncio
import logging

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

QWEN_API_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions"


async def _call_qwen(prompt: str, system: str = "", model: str = "qwen-plus") -> str:
    """调用通义千问模型"""
    if not settings.DASHSCOPE_API_KEY:
        logger.warning("DASHSCOPE_API_KEY 未配置，返回模拟数据")
        return f"[模拟 AI 响应] 基于提示生成的内容（API Key 未配置）\n提示摘要: {prompt[:100]}..."

    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

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
                "temperature": 0.7,
                "max_tokens": 4096,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        return data["choices"][0]["message"]["content"]


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
