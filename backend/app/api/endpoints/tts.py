import asyncio
import hashlib
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import async_session_factory, get_db
from app.core.deps import get_current_user
from app.models.document import Document
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services.doc_processor import extract_text

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tts", tags=["语音合成"])

COSYVOICE_VOICES = [
    {"id": "longxiaochun", "name": "龙小淳", "gender": "女", "preview_url": "/audio/preview/longxiaochun.mp3"},
    {"id": "longxiaoxia", "name": "龙小夏", "gender": "女", "preview_url": "/audio/preview/longxiaoxia.mp3"},
    {"id": "longxiaobai", "name": "龙小白", "gender": "男", "preview_url": "/audio/preview/longxiaobai.mp3"},
    {"id": "longlaotie", "name": "龙老铁", "gender": "男", "preview_url": "/audio/preview/longlaotie.mp3"},
    {"id": "longshu", "name": "龙叔", "gender": "男", "preview_url": "/audio/preview/longshu.mp3"},
    {"id": "longxiaofei", "name": "龙小飞", "gender": "男", "preview_url": "/audio/preview/longxiaofei.mp3"},
    {"id": "longyue", "name": "龙悦", "gender": "女", "preview_url": "/audio/preview/longyue.mp3"},
    {"id": "longwan", "name": "龙婉", "gender": "女", "preview_url": "/audio/preview/longwan.mp3"},
]


class SynthesizeRequest(BaseModel):
    text: str
    voice: str = "longxiaochun"
    doc_id: int | None = None
    page: int | None = None


class PreloadRequest(BaseModel):
    doc_id: int
    pages: list[int]


class SynthesizeResponse(BaseModel):
    url: str


class AudioStatusResponse(BaseModel):
    ready_pages: list[int]
    total_pages: int


class TriggerAudioResponse(BaseModel):
    message: str
    page: int


class PreloadResponse(BaseModel):
    message: str
    triggered_pages: list[int]
    already_ready_pages: list[int]


async def _get_user_doc(doc_id: int, user_id: int, db: AsyncSession) -> Document:
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return doc


def _synthesize_audio_sync(text: str, voice: str, file_path: str) -> None:
    """同步调用 DashScope CosyVoice SDK 合成音频"""
    import dashscope
    from dashscope.audio.tts_v2 import SpeechSynthesizer

    dashscope.api_key = settings.DASHSCOPE_API_KEY
    synthesizer = SpeechSynthesizer(model="cosyvoice-v1", voice=voice)
    audio = synthesizer.call(text)
    with open(file_path, "wb") as f:
        f.write(audio)


_audio_hash_cache: dict[str, str] = {}


def _text_hash(text: str, voice: str) -> str:
    return hashlib.md5(f"{voice}:{text}".encode()).hexdigest()


async def _synthesize_audio(text: str, voice: str) -> str:
    """合成音频并保存文件，返回文件名。相同文本+语音复用已有音频。"""
    h = _text_hash(text, voice)

    if h in _audio_hash_cache:
        cached = _audio_hash_cache[h]
        if (settings.AUDIO_DIR / cached).exists():
            logger.info(f"TTS 命中 hash 缓存: {cached}")
            return cached

    filename = f"{h}.mp3"
    file_path = settings.AUDIO_DIR / filename

    if file_path.exists() and file_path.stat().st_size > 0:
        _audio_hash_cache[h] = filename
        logger.info(f"TTS 命中文件缓存: {filename}")
        return filename

    if not settings.DASHSCOPE_API_KEY:
        logger.warning("DASHSCOPE_API_KEY 未配置，生成空白音频文件")
        file_path.write_bytes(b"")
        _audio_hash_cache[h] = filename
        return filename

    try:
        await asyncio.to_thread(_synthesize_audio_sync, text, voice, str(file_path))
    except Exception as e:
        logger.error(f"TTS 合成失败: {e}")
        raise HTTPException(status_code=502, detail="语音合成服务暂不可用")

    _audio_hash_cache[h] = filename
    return filename


async def _background_synthesize_page(doc_id: int, page: int, user_id: int) -> None:
    """后台任务：为指定 slide 页合成音频（带 user_id 权限校验版本）"""
    async with async_session_factory() as db:
        try:
            result = await db.execute(
                select(Document).where(Document.id == doc_id, Document.user_id == user_id)
            )
            doc = result.scalar_one_or_none()
            if not doc:
                return
            await _do_synthesize_page(doc, doc_id, page, db)
        except Exception as e:
            logger.error(f"[Doc {doc_id}] 第 {page} 页音频合成失败: {e}")


async def _background_synthesize_page_by_doc(doc_id: int, page: int) -> None:
    """后台任务：为指定 slide 页合成音频（不依赖 user_id，预生成专用）"""
    async with async_session_factory() as db:
        try:
            result = await db.execute(
                select(Document).where(Document.id == doc_id)
            )
            doc = result.scalar_one_or_none()
            if not doc:
                return
            await _do_synthesize_page(doc, doc_id, page, db)
        except Exception as e:
            logger.error(f"[Doc {doc_id}] 第 {page} 页音频预合成失败: {e}")


async def _do_synthesize_page(doc: Document, doc_id: int, page: int, db: AsyncSession) -> None:
    """实际执行单页音频合成的核心逻辑"""
    ready = doc.audio_ready_pages or {}
    if str(page) in ready:
        logger.info(f"[Doc {doc_id}] 第 {page} 页音频已存在，跳过")
        return

    tts_text = ""
    slides = doc.lecture_slides or []
    if page < len(slides) and slides[page].get("lecture_text"):
        tts_text = slides[page]["lecture_text"]

    if not tts_text.strip():
        _, _, page_texts = await asyncio.to_thread(
            extract_text, doc.file_path, doc.file_type
        )
        if page < len(page_texts):
            tts_text = page_texts[page]

    if not tts_text.strip():
        return

    filename = await _synthesize_audio(tts_text, "longxiaochun")

    ready = doc.audio_ready_pages or {}
    ready[str(page)] = f"/audio/{filename}"
    doc.audio_ready_pages = ready
    await db.commit()

    logger.info(f"[Doc {doc_id}] 第 {page} 页音频合成完成")


@router.get("/voices", response_model=ApiResponse[list[dict]])
async def list_voices():
    return ApiResponse.ok(data=COSYVOICE_VOICES)


@router.post("/synthesize", response_model=ApiResponse[SynthesizeResponse])
async def synthesize(
    req: SynthesizeRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="合成文本不能为空")

    if len(req.text) > 5000:
        raise HTTPException(status_code=400, detail="文本长度不能超过5000字")

    if req.doc_id is not None and req.page is not None:
        doc = await db.get(Document, req.doc_id)
        if doc and doc.audio_ready_pages:
            cached_url = doc.audio_ready_pages.get(str(req.page))
            if cached_url:
                return ApiResponse.ok(data=SynthesizeResponse(url=cached_url))

    filename = await _synthesize_audio(req.text, req.voice)
    url = f"/audio/{filename}"

    if req.doc_id is not None and req.page is not None:
        doc = await db.get(Document, req.doc_id)
        if doc:
            ready = doc.audio_ready_pages or {}
            ready[str(req.page)] = url
            doc.audio_ready_pages = ready
            await db.commit()

    return ApiResponse.ok(data=SynthesizeResponse(url=url))


@router.get("/documents/{doc_id}/audio-status", response_model=ApiResponse[AudioStatusResponse])
async def get_audio_status(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)
    ready_pages_map = doc.audio_ready_pages or {}
    ready_pages = [int(p) for p in ready_pages_map.keys()]
    return ApiResponse.ok(
        data=AudioStatusResponse(
            ready_pages=sorted(ready_pages),
            total_pages=doc.page_count,
        )
    )


@router.post("/documents/{doc_id}/trigger-audio/{page}", response_model=ApiResponse[TriggerAudioResponse])
async def trigger_audio_generation(
    doc_id: int,
    page: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)

    if page < 0 or page >= doc.page_count:
        raise HTTPException(status_code=400, detail="页码超出范围")

    ready = doc.audio_ready_pages or {}
    if str(page) in ready:
        return ApiResponse.ok(
            data=TriggerAudioResponse(message="该页音频已就绪", page=page)
        )

    asyncio.create_task(_background_synthesize_page(doc_id, page, user.id))

    return ApiResponse.ok(
        data=TriggerAudioResponse(message="音频合成已启动", page=page)
    )


@router.post("/preload", response_model=ApiResponse[PreloadResponse])
async def preload_audio(
    req: PreloadRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """批量预加载音频：检查哪些页还没有音频，后台异步触发生成"""
    doc = await _get_user_doc(req.doc_id, user.id, db)

    ready = doc.audio_ready_pages or {}
    already_ready: list[int] = []
    to_trigger: list[int] = []

    for page in req.pages:
        if page < 0 or page >= doc.page_count:
            continue
        if str(page) in ready:
            already_ready.append(page)
        else:
            to_trigger.append(page)

    for page in to_trigger:
        asyncio.create_task(_background_synthesize_page_by_doc(req.doc_id, page))

    return ApiResponse.ok(
        data=PreloadResponse(
            message=f"已触发 {len(to_trigger)} 页音频生成，{len(already_ready)} 页已就绪",
            triggered_pages=to_trigger,
            already_ready_pages=already_ready,
        )
    )
