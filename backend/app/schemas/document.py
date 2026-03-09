from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field

from app.schemas.auth import UserProfile


class OwnerBrief(BaseModel):
    id: int
    username: str
    avatar_url: str | None = None

    model_config = {"from_attributes": True}


class DocumentOut(BaseModel):
    id: int
    user_id: int
    title: str
    filename: str
    file_size: int
    file_type: str
    source_type: str
    source_url: str | None = None
    page_count: int
    word_count: int
    summary: str | None = None
    key_points: Any = None
    ppt_content: Any = None
    lecture_slides: Any = None
    status: str
    progress: float
    processing_step: str | None = None
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
    published_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    owner: OwnerBrief | None = None

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


class BatchOperationRequest(BaseModel):
    doc_ids: list[int]
    action: str  # delete | move_group
    group_id: int | None = None


class ImportUrlRequest(BaseModel):
    url: str = Field(min_length=1)
    title: str | None = None


class BookSearchRequest(BaseModel):
    query: str = Field(min_length=1)
    language: str | None = None
    format: str | None = None
    page: int = 1


class BookImportRequest(BaseModel):
    title: str
    author: str | None = None
    isbn: str | None = None
    md5: str | None = None
    download_url: str | None = None
    cover_url: str | None = None
    file_size: str | int = 0
    publisher: str | None = None
    publish_year: int | None = None
    language: str | None = None
    source: str | None = None
