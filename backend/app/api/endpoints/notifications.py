from math import ceil

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.community import Notification
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedData
from app.schemas.community import NotificationOut

router = APIRouter(prefix="/notifications", tags=["通知"])


@router.get("", response_model=ApiResponse[PaginatedData[NotificationOut]])
async def list_notifications(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    unread_only: bool = False,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    base = (
        select(Notification)
        .where(Notification.user_id == user.id)
        .options(selectinload(Notification.sender))
    )
    count_q = select(func.count(Notification.id)).where(Notification.user_id == user.id)

    if unread_only:
        base = base.where(Notification.is_read.is_(False))
        count_q = count_q.where(Notification.is_read.is_(False))

    total = (await db.execute(count_q)).scalar() or 0
    base = base.order_by(Notification.created_at.desc())
    base = base.offset((page - 1) * page_size).limit(page_size)

    items = [NotificationOut.model_validate(n) for n in (await db.execute(base)).scalars().all()]
    return ApiResponse.ok(
        data=PaginatedData(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=ceil(total / page_size) if total else 0,
        )
    )


@router.get("/unread-count", response_model=ApiResponse[int])
async def unread_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    cnt = (
        await db.execute(
            select(func.count(Notification.id)).where(
                Notification.user_id == user.id, Notification.is_read.is_(False)
            )
        )
    ).scalar() or 0
    return ApiResponse.ok(data=cnt)


@router.put("/{notification_id}/read", response_model=ApiResponse)
async def mark_read(
    notification_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(Notification.id == notification_id, Notification.user_id == user.id)
        .values(is_read=True)
    )
    return ApiResponse.ok(msg="已读")


@router.put("/read-all", response_model=ApiResponse)
async def mark_all_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read.is_(False))
        .values(is_read=True)
    )
    return ApiResponse.ok(msg="全部已读")
