from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.social import UserSettings
from app.models.user import User
from app.schemas.common import ApiResponse

router = APIRouter(prefix="/settings", tags=["设置"])


class SettingsUpdateRequest(BaseModel):
    tts_voice: str | None = None
    tts_speed: float | None = None
    theme: str | None = None
    auto_play_next: bool | None = None
    show_translation: bool | None = None


class SettingsOut(BaseModel):
    id: int
    tts_voice: str
    tts_speed: float
    theme: str
    auto_play_next: bool
    show_translation: bool
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


@router.get("", response_model=ApiResponse[SettingsOut])
async def get_settings(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user.id)
    )
    settings = result.scalar_one_or_none()

    if not settings:
        settings = UserSettings(user_id=user.id)
        db.add(settings)
        await db.flush()

    return ApiResponse.ok(
        data=SettingsOut(
            id=settings.id,
            tts_voice=settings.tts_voice,
            tts_speed=settings.tts_speed,
            theme=settings.theme,
            auto_play_next=settings.auto_play_next,
            show_translation=settings.show_translation,
            created_at=settings.created_at.isoformat() if settings.created_at else "",
            updated_at=settings.updated_at.isoformat() if settings.updated_at else "",
        )
    )


@router.put("", response_model=ApiResponse[SettingsOut])
async def update_settings(
    req: SettingsUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(UserSettings).where(UserSettings.user_id == user.id)
    )
    settings = result.scalar_one_or_none()

    if not settings:
        settings = UserSettings(user_id=user.id)
        db.add(settings)
        await db.flush()

    if req.tts_voice is not None:
        settings.tts_voice = req.tts_voice
    if req.tts_speed is not None:
        settings.tts_speed = req.tts_speed
    if req.theme is not None:
        settings.theme = req.theme
    if req.auto_play_next is not None:
        settings.auto_play_next = req.auto_play_next
    if req.show_translation is not None:
        settings.show_translation = req.show_translation

    await db.flush()

    return ApiResponse.ok(
        data=SettingsOut(
            id=settings.id,
            tts_voice=settings.tts_voice,
            tts_speed=settings.tts_speed,
            theme=settings.theme,
            auto_play_next=settings.auto_play_next,
            show_translation=settings.show_translation,
            created_at=settings.created_at.isoformat() if settings.created_at else "",
            updated_at=settings.updated_at.isoformat() if settings.updated_at else "",
        )
    )
