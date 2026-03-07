from math import ceil

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document import Document, DocumentGroup
from app.models.user import User
from app.schemas.common import ApiResponse
from app.schemas.document import DocumentGroupOut, GroupCreateRequest, GroupUpdateRequest

router = APIRouter(prefix="/bookshelf/groups", tags=["分组"])


@router.get("", response_model=ApiResponse[list[DocumentGroupOut]])
async def list_groups(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(DocumentGroup)
        .where(DocumentGroup.user_id == user.id)
        .order_by(DocumentGroup.sort_order)
    )
    groups = [DocumentGroupOut.model_validate(g) for g in result.scalars().all()]
    return ApiResponse.ok(data=groups)


@router.post("", response_model=ApiResponse[DocumentGroupOut])
async def create_group(
    req: GroupCreateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    max_order = await db.execute(
        select(func.coalesce(func.max(DocumentGroup.sort_order), 0)).where(
            DocumentGroup.user_id == user.id
        )
    )
    grp = DocumentGroup(
        user_id=user.id,
        name=req.name,
        sort_order=(max_order.scalar() or 0) + 1,
    )
    db.add(grp)
    await db.flush()
    return ApiResponse.ok(data=DocumentGroupOut.model_validate(grp))


@router.put("/{group_id}", response_model=ApiResponse[DocumentGroupOut])
async def update_group(
    group_id: int,
    req: GroupUpdateRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    grp = await _get_user_group(group_id, user.id, db)
    if req.name is not None:
        grp.name = req.name
    if req.sort_order is not None:
        grp.sort_order = req.sort_order
    return ApiResponse.ok(data=DocumentGroupOut.model_validate(grp))


@router.delete("/{group_id}", response_model=ApiResponse)
async def delete_group(
    group_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    grp = await _get_user_group(group_id, user.id, db)
    # unlink documents rather than deleting them
    await db.execute(
        select(Document)
        .where(Document.group_id == group_id)
        .execution_options(synchronize_session="fetch")
    )
    docs = (
        await db.execute(select(Document).where(Document.group_id == group_id))
    ).scalars().all()
    for d in docs:
        d.group_id = None
    await db.delete(grp)
    return ApiResponse.ok(msg="分组已删除")


async def _get_user_group(group_id: int, user_id: int, db: AsyncSession) -> DocumentGroup:
    result = await db.execute(
        select(DocumentGroup).where(
            DocumentGroup.id == group_id, DocumentGroup.user_id == user_id
        )
    )
    grp = result.scalar_one_or_none()
    if not grp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="分组不存在")
    return grp
