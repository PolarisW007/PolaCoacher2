import asyncio
import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import settings
from app.core.database import engine, Base
from app.models import *  # noqa: F401,F403 – ensure all models are registered

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)


def _add_missing_columns(conn):
    """Add any new columns that create_all won't handle for existing tables."""
    from sqlalchemy import inspect, text
    inspector = inspect(conn)

    _migrations = {
        "documents": {
            "processing_step": "VARCHAR(50)",
            "audio_ready_pages": "TEXT",
            "cover_url": "VARCHAR(1024)",
            "lecture_visibility": "VARCHAR(10) DEFAULT 'private'",
            "published_at": "TIMESTAMP",
            "play_count": "INTEGER DEFAULT 0",
            "like_count": "INTEGER DEFAULT 0",
            "comment_count": "INTEGER DEFAULT 0",
            "tags": "TEXT",
            "description": "TEXT",
            "isbn": "VARCHAR(20)",
            "author": "VARCHAR(512)",
            "publisher": "VARCHAR(256)",
            "publish_year": "INTEGER",
            "language": "VARCHAR(20)",
            "group_id": "INTEGER",
            "chapters": "TEXT",
            "parsed_content": "TEXT",
            "translation_status": "VARCHAR(20)",
            "translation_lang": "VARCHAR(10)",
            "translated_content": "TEXT",
        },
        "users": {
            "wechat_openid": "VARCHAR(128)",
            "alipay_openid": "VARCHAR(128)",
            "avatar_url": "VARCHAR(512)",
            "phone": "VARCHAR(20)",
        },
    }

    for table_name, cols in _migrations.items():
        if not inspector.has_table(table_name):
            continue
        existing = {c["name"] for c in inspector.get_columns(table_name)}
        for col_name, col_type in cols.items():
            if col_name not in existing:
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {col_name} {col_type}"))
                logging.info(f"Added column {table_name}.{col_name}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_add_missing_columns)

    async def _audio_cleanup_loop():
        while True:
            await asyncio.sleep(86400)  # 每24小时执行一次
            try:
                audio_dir = Path(str(settings.AUDIO_DIR))
                if audio_dir.exists():
                    now = time.time()
                    max_age = 30 * 86400  # 30天
                    for f in audio_dir.rglob("*.mp3"):
                        if now - f.stat().st_mtime > max_age:
                            f.unlink(missing_ok=True)
                            logging.info(f"已清理过期音频: {f.name}")
            except Exception as e:
                logging.error(f"音频清理异常: {e}")

    # 初始化 Z-Library 凭据（加密存储于内存）
    from app.services.zlib_service import init_zlib_credentials
    init_zlib_credentials(
        email=settings.ZLIB_EMAIL,
        password=settings.ZLIB_PASSWORD,
        secret_key=settings.SECRET_KEY,
    )

    _cleanup_task = asyncio.create_task(_audio_cleanup_loop())
    yield
    _cleanup_task.cancel()
    try:
        await _cleanup_task
    except asyncio.CancelledError:
        pass
    await engine.dispose()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    lifespan=lifespan,
    root_path=settings.ROOT_PATH,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

_base = Path(__file__).resolve().parent.parent
_upload_dir = _base / "data" / "uploads"
_audio_dir = _base / "data" / "audio"
_cover_dir = _base / "data" / "covers"
_doc_images_dir = _base / "data" / "doc_images"
_slide_images_dir = _base / "data" / "slide_images"
for _d in (_upload_dir, _audio_dir, _cover_dir, _doc_images_dir, _slide_images_dir):
    _d.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(_upload_dir)), name="uploads")
app.mount("/audio", StaticFiles(directory=str(_audio_dir)), name="audio")
app.mount("/covers", StaticFiles(directory=str(_cover_dir)), name="covers")
app.mount("/doc_images", StaticFiles(directory=str(_doc_images_dir)), name="doc_images")
app.mount("/slide_images", StaticFiles(directory=str(_slide_images_dir)), name="slide_images")
