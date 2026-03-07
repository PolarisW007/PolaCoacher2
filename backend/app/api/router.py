from fastapi import APIRouter

from app.api.endpoints import auth, community, documents, groups, lecture_notes, notifications

api_router = APIRouter(prefix="/api")

api_router.include_router(auth.router)
api_router.include_router(documents.router)
api_router.include_router(groups.router)
api_router.include_router(lecture_notes.router)
api_router.include_router(community.router)
api_router.include_router(notifications.router)
