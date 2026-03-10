from datetime import datetime

from sqlalchemy import JSON, BigInteger, DateTime, Float, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("document_groups.id", ondelete="SET NULL"), nullable=True
    )

    title: Mapped[str] = mapped_column(String(512))
    filename: Mapped[str] = mapped_column(String(512))
    file_path: Mapped[str] = mapped_column(String(1024))
    file_size: Mapped[int] = mapped_column(BigInteger, default=0)
    file_type: Mapped[str] = mapped_column(String(20), default="pdf")
    source_type: Mapped[str] = mapped_column(String(20), default="upload")
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    isbn: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    author: Mapped[str | None] = mapped_column(String(512), nullable=True)
    publisher: Mapped[str | None] = mapped_column(String(256), nullable=True)
    publish_year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    language: Mapped[str | None] = mapped_column(String(20), nullable=True)

    page_count: Mapped[int] = mapped_column(Integer, default=0)
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    key_points: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    ppt_content: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    lecture_slides: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    processing_step: Mapped[str | None] = mapped_column(String(50), nullable=True)
    audio_ready_pages: Mapped[dict | None] = mapped_column(JSON, nullable=True)

    # 结构化阅读内容
    chapters: Mapped[dict | None] = mapped_column(JSON, nullable=True)          # [{id, title, start_para, level}]
    parsed_content: Mapped[dict | None] = mapped_column(JSON, nullable=True)    # [{id, chapter_id, type, text}]

    # 翻译
    translation_status: Mapped[str | None] = mapped_column(String(20), nullable=True)   # null|translating|done|failed
    translation_lang: Mapped[str | None] = mapped_column(String(10), nullable=True)     # zh|en
    translated_content: Mapped[dict | None] = mapped_column(JSON, nullable=True)        # [{chapter_id, paragraphs:[{id,text}]}]

    cover_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    lecture_visibility: Mapped[str] = mapped_column(String(10), default="private")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    play_count: Mapped[int] = mapped_column(Integer, default=0)
    like_count: Mapped[int] = mapped_column(Integer, default=0)
    comment_count: Mapped[int] = mapped_column(Integer, default=0)
    tags: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner = relationship("User", back_populates="documents")
    group = relationship("DocumentGroup", back_populates="documents")
    lecture_notes = relationship("LectureNote", back_populates="document", cascade="all, delete-orphan")
    document_notes = relationship("DocumentNote", back_populates="document", cascade="all, delete-orphan")
    comments = relationship("CommunityComment", back_populates="document", cascade="all, delete-orphan")


class DocumentGroup(Base):
    __tablename__ = "document_groups"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    doc_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    owner = relationship("User", back_populates="groups")
    documents = relationship("Document", back_populates="group")
