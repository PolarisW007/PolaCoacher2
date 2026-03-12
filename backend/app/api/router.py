from fastapi import APIRouter

from app.api.endpoints import (
    analysis,
    auth,
    bookshelf,
    chat,
    community,
    documents,
    groups,
    history,
    lecture_notes,
    notifications,
    reader,
    share,
    tts,
    user_settings,
)
from app.api.endpoints.notes import doc_notes_router, notes_router

api_router = APIRouter(prefix="/api")

api_router.include_router(auth.router)
# 静态文档路由优先挂载，避免 /documents/book-search、/documents/list 被 /documents/{doc_id} 匹配
api_router.include_router(documents.documents_static_router, prefix="/documents")
api_router.include_router(documents.router)
api_router.include_router(groups.router)
api_router.include_router(lecture_notes.router)
api_router.include_router(community.router)
api_router.include_router(notifications.router)
api_router.include_router(chat.router)
api_router.include_router(doc_notes_router)
api_router.include_router(notes_router)
api_router.include_router(tts.router)
api_router.include_router(share.share_router)
api_router.include_router(share.xhs_router)
api_router.include_router(share.moments_router)
api_router.include_router(bookshelf.router)
api_router.include_router(history.router)
api_router.include_router(user_settings.router)
api_router.include_router(analysis.router)
api_router.include_router(reader.router)
