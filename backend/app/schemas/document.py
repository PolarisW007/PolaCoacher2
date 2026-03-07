from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class DocumentOut(BaseModel):
    id: int
    user_id: int
    title: str
    filename: str
    file_size: int
    file_type: str
    source_type: str
    page_count: int
    word_count: int
    summary: str | None = None
    key_points: Any = None
    ppt_content: Any = None
    lecture_slides: Any = None
    status: str
    progress: float
    cover_url: str | None = None
    lecture_visibility: str = "private"
    play_count: int = 0
    like_count: int = 0
    comment_count: int = 0
    tags: list[str] | None = None
    description: str | None = None
    isbn: str | None = None
    author: str | None = None
    publisher: str | None = None
    publish_year: int | None = None
    language: str | None = None
    group_id: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentGroupOut(BaseModel):
    id: int
    name: str
    sort_order: int
    doc_count: int
    created_at: datetime

    model_config = {"from_attributes": True}


class GroupCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)


class GroupUpdateRequest(BaseModel):
    name: str | None = None
    sort_order: int | None = None


class DocumentMoveRequest(BaseModel):
    group_id: int | None = None


class PublishRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    tags: list[str] | None = None
