from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.document import Document
from app.models.social import MomentsPost, XhsPost
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedData
from app.services.ai_service import generate_moments_content, generate_xhs_content

share_router = APIRouter(tags=["分享"])
xhs_router = APIRouter(prefix="/xiaohongshu", tags=["分享"])
moments_router = APIRouter(prefix="/moments", tags=["分享"])


class PostOut(BaseModel):
    id: int
    document_id: int
    title: str
    content: str
    cover_prompt: str | None = None
    cover_url: str | None = None
    image_status: str = "pending"
    slides: dict | list | None = None
    created_at: str

    model_config = {"from_attributes": True}


async def _get_user_doc(doc_id: int, user_id: int, db: AsyncSession) -> Document:
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.user_id == user_id)
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="文档不存在")
    return doc


@share_router.post(
    "/documents/{doc_id}/share/xiaohongshu", response_model=ApiResponse[PostOut]
)
async def generate_xhs_post(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)

    summary = doc.summary or ""
    key_points = doc.key_points or []
    if not summary:
        raise HTTPException(status_code=400, detail="文档尚未生成摘要，请等待处理完成")

    result = await generate_xhs_content(summary, key_points)

    post = XhsPost(
        user_id=user.id,
        document_id=doc_id,
        title=result.get("title", "知识分享"),
        content=result.get("content", ""),
        cover_prompt=result.get("cover_prompt"),
        slides=result.get("slides"),
    )
    db.add(post)
    await db.flush()

    await db.commit()

    if post.cover_prompt:
        import asyncio
        post_id = post.id

        async def _gen_cover():
            from app.services.ai_service import generate_cover_image, generate_image_prompt
            from app.core.database import async_session_factory
            import logging
            _log = logging.getLogger(__name__)
            try:
                img_prompt = await generate_image_prompt(
                    title=doc.title or "",
                    summary=summary,
                    key_points=key_points if isinstance(key_points, list) else [],
                )
                _log.info(f"[XHS] post={post_id} 生成图片prompt: {img_prompt[:100]}...")
                url = await generate_cover_image(
                    img_prompt, str(settings.COVER_DIR), f"xhs_{post_id}.png",
                )
                if url:
                    async with async_session_factory() as s:
                        from sqlalchemy import update
                        await s.execute(
                            update(XhsPost).where(XhsPost.id == post_id).values(
                                cover_url=url, image_status="ready"
                            )
                        )
                        await s.commit()
                    _log.info(f"[XHS] post={post_id} 封面图生成成功: {url}")
            except Exception as e:
                _log.error(f"[XHS] post={post_id} 封面图生成失败: {e}")

        asyncio.create_task(_gen_cover())

    return ApiResponse.ok(
        data=PostOut(
            id=post.id,
            document_id=post.document_id,
            title=post.title,
            content=post.content,
            cover_prompt=post.cover_prompt,
            cover_url=post.cover_url,
            image_status=post.image_status,
            slides=post.slides,
            created_at=post.created_at.isoformat() if post.created_at else "",
        )
    )


@share_router.post(
    "/documents/{doc_id}/share/moments", response_model=ApiResponse[PostOut]
)
async def generate_moments_post(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = await _get_user_doc(doc_id, user.id, db)

    summary = doc.summary or ""
    key_points = doc.key_points or []
    if not summary:
        raise HTTPException(status_code=400, detail="文档尚未生成摘要，请等待处理完成")

    result = await generate_moments_content(summary, key_points)

    post = MomentsPost(
        user_id=user.id,
        document_id=doc_id,
        title=result.get("title", "读书笔记"),
        content=result.get("content", ""),
        cover_prompt=result.get("cover_prompt"),
    )
    db.add(post)
    await db.flush()

    await db.commit()

    if post.cover_prompt:
        import asyncio
        post_id = post.id

        async def _gen_cover():
            from app.services.ai_service import generate_cover_image, generate_image_prompt
            from app.core.database import async_session_factory
            import logging
            _log = logging.getLogger(__name__)
            try:
                img_prompt = await generate_image_prompt(
                    title=doc.title or "",
                    summary=summary,
                    key_points=key_points if isinstance(key_points, list) else [],
                )
                _log.info(f"[Moments] post={post_id} 生成图片prompt: {img_prompt[:100]}...")
                url = await generate_cover_image(
                    img_prompt, str(settings.COVER_DIR), f"moments_{post_id}.png",
                )
                if url:
                    async with async_session_factory() as s:
                        from sqlalchemy import update
                        await s.execute(
                            update(MomentsPost).where(MomentsPost.id == post_id).values(
                                cover_url=url, image_status="ready"
                            )
                        )
                        await s.commit()
                    _log.info(f"[Moments] post={post_id} 封面图生成成功: {url}")
            except Exception as e:
                _log.error(f"[Moments] post={post_id} 封面图生成失败: {e}")

        asyncio.create_task(_gen_cover())

    return ApiResponse.ok(
        data=PostOut(
            id=post.id,
            document_id=post.document_id,
            title=post.title,
            content=post.content,
            cover_prompt=post.cover_prompt,
            cover_url=post.cover_url,
            image_status=post.image_status,
            slides=post.slides,
            created_at=post.created_at.isoformat() if post.created_at else "",
        )
    )


@xhs_router.get("/posts", response_model=ApiResponse[PaginatedData[PostOut]])
async def list_xhs_posts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count_query = select(func.count(XhsPost.id)).where(XhsPost.user_id == user.id)
    total = (await db.execute(count_query)).scalar() or 0

    query = (
        select(XhsPost)
        .where(XhsPost.user_id == user.id)
        .order_by(XhsPost.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    posts = [
        PostOut(
            id=p.id,
            document_id=p.document_id,
            title=p.title,
            content=p.content,
            cover_prompt=p.cover_prompt,
            cover_url=p.cover_url,
            image_status=p.image_status,
            slides=p.slides,
            created_at=p.created_at.isoformat() if p.created_at else "",
        )
        for p in result.scalars().all()
    ]

    return ApiResponse.ok(
        data=PaginatedData(
            items=posts,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=ceil(total / page_size) if total else 0,
        )
    )


@moments_router.get("/posts", response_model=ApiResponse[PaginatedData[PostOut]])
async def list_moments_posts(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    count_query = select(func.count(MomentsPost.id)).where(
        MomentsPost.user_id == user.id
    )
    total = (await db.execute(count_query)).scalar() or 0

    query = (
        select(MomentsPost)
        .where(MomentsPost.user_id == user.id)
        .order_by(MomentsPost.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(query)
    posts = [
        PostOut(
            id=p.id,
            document_id=p.document_id,
            title=p.title,
            content=p.content,
            cover_prompt=p.cover_prompt,
            cover_url=p.cover_url,
            image_status=p.image_status,
            slides=p.slides,
            created_at=p.created_at.isoformat() if p.created_at else "",
        )
        for p in result.scalars().all()
    ]

    return ApiResponse.ok(
        data=PaginatedData(
            items=posts,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=ceil(total / page_size) if total else 0,
        )
    )
