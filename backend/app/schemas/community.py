from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.auth import UserProfile


class CommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=500)
    parent_id: int | None = None


class CommentOut(BaseModel):
    id: int
    document_id: int
    content: str
    like_count: int
    is_deleted: bool
    created_at: datetime
    author: UserProfile | None = None
    reply_to_user: UserProfile | None = None
    parent_id: int | None = None
    replies: list["CommentOut"] = []

    model_config = {"from_attributes": True}


class NotificationOut(BaseModel):
    id: int
    type: str
    target_type: str
    target_id: int
    document_id: int | None = None
    content_preview: str | None = None
    is_read: bool
    created_at: datetime
    sender: UserProfile | None = None

    model_config = {"from_attributes": True}
