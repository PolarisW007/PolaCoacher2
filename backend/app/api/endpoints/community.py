from math import ceil

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user, get_optional_user
from app.models.community import CommunityComment, CommunityFavorite, CommunityLike, Notification
from app.models.document import Document
from app.models.user import User
from app.schemas.common import ApiResponse, PaginatedData
from app.schemas.community import CommentCreate, CommentOut
from app.schemas.document import DocumentOut

router = APIRouter(prefix="/community", tags=["社区"])


@router.get("/lectures", response_model=ApiResponse[PaginatedData[DocumentOut]])
async def list_community_lectures(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    sort: str = Query("latest", pattern="^(latest|hot)$"),
    search: str | None = None,
    tag: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    base = select(Document).where(Document.lecture_visibility == "public")
    count_q = select(func.count(Document.id)).where(Document.lecture_visibility == "public")

    if search:
        base = base.where(Document.title.ilike(f"%{search}%"))
        count_q = count_q.where(Document.title.ilike(f"%{search}%"))
    if tag:
        tag_filter = Document.tags.like(f'%"{tag}"%')
        base = base.where(tag_filter)
        count_q = count_q.where(tag_filter)

    total = (await db.execute(count_q)).scalar() or 0

    if sort == "hot":
        base = base.order_by((Document.like_count + Document.play_count).desc())
    else:
        base = base.order_by(Document.published_at.desc())

    base = base.offset((page - 1) * page_size).limit(page_size)
    docs = [DocumentOut.model_validate(d) for d in (await db.execute(base)).scalars().all()]

    return ApiResponse.ok(
        data=PaginatedData(
            items=docs,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=ceil(total / page_size) if total else 0,
        )
    )


@router.get("/lectures/{doc_id}", response_model=ApiResponse[DocumentOut])
async def get_community_lecture(doc_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Document).where(Document.id == doc_id, Document.lecture_visibility == "public")
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="讲解不存在或未公开")
    doc.play_count += 1
    return ApiResponse.ok(data=DocumentOut.model_validate(doc))


@router.post("/lectures/{doc_id}/like", response_model=ApiResponse)
async def like_lecture(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(CommunityLike).where(
            CommunityLike.user_id == user.id,
            CommunityLike.target_type == "lecture",
            CommunityLike.target_id == doc_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="已点赞")

    db.add(CommunityLike(user_id=user.id, target_type="lecture", target_id=doc_id))
    doc = (await db.execute(select(Document).where(Document.id == doc_id))).scalar_one_or_none()
    if doc:
        doc.like_count += 1
        if doc.user_id != user.id:
            db.add(
                Notification(
                    user_id=doc.user_id,
                    sender_id=user.id,
                    type="like",
                    target_type="lecture",
                    target_id=doc_id,
                    document_id=doc_id,
                    content_preview=f"赞了你的讲解「{doc.title[:50]}」",
                )
            )
    return ApiResponse.ok(msg="点赞成功")


@router.delete("/lectures/{doc_id}/like", response_model=ApiResponse)
async def unlike_lecture(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommunityLike).where(
            CommunityLike.user_id == user.id,
            CommunityLike.target_type == "lecture",
            CommunityLike.target_id == doc_id,
        )
    )
    like = result.scalar_one_or_none()
    if not like:
        raise HTTPException(status_code=400, detail="未点赞")
    await db.delete(like)
    doc = (await db.execute(select(Document).where(Document.id == doc_id))).scalar_one_or_none()
    if doc and doc.like_count > 0:
        doc.like_count -= 1
    return ApiResponse.ok(msg="已取消点赞")


@router.post("/lectures/{doc_id}/favorite", response_model=ApiResponse)
async def favorite_lecture(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.execute(
        select(CommunityFavorite).where(
            CommunityFavorite.user_id == user.id,
            CommunityFavorite.document_id == doc_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="已收藏")
    db.add(CommunityFavorite(user_id=user.id, document_id=doc_id))
    return ApiResponse.ok(msg="收藏成功")


@router.delete("/lectures/{doc_id}/favorite", response_model=ApiResponse)
async def unfavorite_lecture(
    doc_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(CommunityFavorite).where(
            CommunityFavorite.user_id == user.id,
            CommunityFavorite.document_id == doc_id,
        )
    )
    fav = result.scalar_one_or_none()
    if not fav:
        raise HTTPException(status_code=400, detail="未收藏")
    await db.delete(fav)
    return ApiResponse.ok(msg="已取消收藏")


# ---- Comments ----

@router.get("/lectures/{doc_id}/comments", response_model=ApiResponse[PaginatedData[CommentOut]])
async def list_comments(
    doc_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
):
    _reply_load = selectinload(CommunityComment.replies)
    base = (
        select(CommunityComment)
        .where(
            CommunityComment.document_id == doc_id,
            CommunityComment.parent_id.is_(None),
            CommunityComment.is_deleted.is_(False),
        )
        .options(
            selectinload(CommunityComment.author),
            selectinload(CommunityComment.reply_to_user),
            _reply_load.selectinload(CommunityComment.author),
            _reply_load.selectinload(CommunityComment.reply_to_user),
            _reply_load.selectinload(CommunityComment.replies)
            .selectinload(CommunityComment.author),
            _reply_load.selectinload(CommunityComment.replies)
            .selectinload(CommunityComment.reply_to_user),
        )
    )
    total = (
        await db.execute(
            select(func.count(CommunityComment.id)).where(
                CommunityComment.document_id == doc_id,
                CommunityComment.parent_id.is_(None),
                CommunityComment.is_deleted.is_(False),
            )
        )
    ).scalar() or 0

    base = base.order_by(CommunityComment.created_at.desc())
    base = base.offset((page - 1) * page_size).limit(page_size)
    comments = [CommentOut.model_validate(c) for c in (await db.execute(base)).scalars().all()]

    return ApiResponse.ok(
        data=PaginatedData(
            items=comments,
            total=total,
            page=page,
            page_size=page_size,
            total_pages=ceil(total / page_size) if total else 0,
        )
    )


@router.post("/lectures/{doc_id}/comments", response_model=ApiResponse[CommentOut])
async def create_comment(
    doc_id: int,
    req: CommentCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    doc = (
        await db.execute(
            select(Document).where(Document.id == doc_id, Document.lecture_visibility == "public")
        )
    ).scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="讲解不存在或未公开")

    reply_to_user_id = None
    if req.parent_id:
        parent = (
            await db.execute(select(CommunityComment).where(CommunityComment.id == req.parent_id))
        ).scalar_one_or_none()
        if not parent or parent.document_id != doc_id:
            raise HTTPException(status_code=400, detail="父评论不存在")
        reply_to_user_id = parent.user_id

    comment = CommunityComment(
        document_id=doc_id,
        user_id=user.id,
        parent_id=req.parent_id,
        reply_to_user_id=reply_to_user_id,
        content=req.content,
    )
    db.add(comment)
    doc.comment_count += 1

    # notification to lecture author
    if doc.user_id != user.id:
        db.add(
            Notification(
                user_id=doc.user_id,
                sender_id=user.id,
                type="comment",
                target_type="lecture",
                target_id=doc_id,
                document_id=doc_id,
                content_preview=req.content[:100],
            )
        )
    # notification to parent comment author
    if reply_to_user_id and reply_to_user_id != user.id:
        db.add(
            Notification(
                user_id=reply_to_user_id,
                sender_id=user.id,
                type="reply",
                target_type="comment",
                target_id=req.parent_id,
                document_id=doc_id,
                content_preview=req.content[:100],
            )
        )

    await db.flush()
    result = await db.execute(
        select(CommunityComment)
        .where(CommunityComment.id == comment.id)
        .options(
            selectinload(CommunityComment.author),
            selectinload(CommunityComment.reply_to_user),
            selectinload(CommunityComment.replies),
        )
    )
    comment = result.scalar_one()
    return ApiResponse.ok(data=CommentOut.model_validate(comment))


@router.delete("/comments/{comment_id}", response_model=ApiResponse)
async def delete_comment(
    comment_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(CommunityComment).where(CommunityComment.id == comment_id))
    comment = result.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=404, detail="评论不存在")

    doc = (await db.execute(select(Document).where(Document.id == comment.document_id))).scalar_one_or_none()
    if comment.user_id != user.id and (not doc or doc.user_id != user.id):
        raise HTTPException(status_code=403, detail="无权删除")

    comment.is_deleted = True
    comment.content = "[评论已删除]"
    if doc and doc.comment_count > 0:
        doc.comment_count -= 1
    return ApiResponse.ok(msg="评论已删除")
