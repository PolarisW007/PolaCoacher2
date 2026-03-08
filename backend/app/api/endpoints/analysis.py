from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.deps import get_current_user
from app.models.user import User
from app.schemas.common import ApiResponse
from app.services.ai_service import translate_text

router = APIRouter(prefix="/analysis", tags=["分析"])


class TranslateRequest(BaseModel):
    text: str
    source_lang: str = "en"
    target_lang: str = "zh"


class TranslateResponse(BaseModel):
    translated_text: str
    source_lang: str
    target_lang: str


@router.post("/translate", response_model=ApiResponse[TranslateResponse])
async def translate(
    req: TranslateRequest,
    user: User = Depends(get_current_user),
):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="翻译文本不能为空")

    if len(req.text) > 10000:
        raise HTTPException(status_code=400, detail="文本长度不能超过10000字")

    result = await translate_text(
        text=req.text,
        source_lang=req.source_lang,
        target_lang=req.target_lang,
    )

    return ApiResponse.ok(
        data=TranslateResponse(
            translated_text=result,
            source_lang=req.source_lang,
            target_lang=req.target_lang,
        )
    )
