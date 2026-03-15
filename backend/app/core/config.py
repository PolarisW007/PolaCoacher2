from pathlib import Path
from pydantic_settings import BaseSettings

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    APP_NAME: str = "AICoacher 2.0"
    APP_VERSION: str = "2.0.0"
    DEBUG: bool = False

    DATABASE_URL: str = "sqlite+aiosqlite:///./data/aicoacher.db"
    SECRET_KEY: str = "dev-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days

    DASHSCOPE_API_KEY: str = ""
    REDIS_URL: str = "redis://localhost:6379/0"

    WECHAT_APP_ID: str = ""
    WECHAT_APP_SECRET: str = ""
    WECHAT_REDIRECT_URI: str = ""

    ALIPAY_APP_ID: str = ""
    ALIPAY_REDIRECT_URI: str = ""

    BASE_DIR: Path = _PROJECT_ROOT
    UPLOAD_DIR: Path = _PROJECT_ROOT / "data" / "uploads"
    AUDIO_DIR: Path = _PROJECT_ROOT / "data" / "audio"
    COVER_DIR: Path = _PROJECT_ROOT / "data" / "covers"
    DOC_IMAGES_DIR: Path = _PROJECT_ROOT / "data" / "doc_images"
    SLIDE_IMAGES_DIR: Path = _PROJECT_ROOT / "data" / "slide_images"

    MAX_UPLOAD_SIZE_MB: int = 200          # 单文件最大 200 MB
    CHUNK_SIZE_MB: int = 50                # 流式接收时每块大小 50 MB
    ALLOWED_EXTENSIONS: set[str] = {"pdf", "docx", "txt", "md"}

    # ── 分批处理配置（防止大 PDF 把服务器 IO/内存打满）──
    STREAM_CHUNK_BYTES: int = 5 * 1024 * 1024       # 下载/读取流式分块：5MB
    MAX_DOWNLOAD_SIZE_MB: int = 200                  # 单文件下载上限
    PROCESS_CONCURRENCY: int = 2                     # 全局同时处理文档数
    DOWNLOAD_CONCURRENCY: int = 2                    # 全局同时下载数
    SLIDE_BATCH_SIZE: int = 5                        # 讲解生成每批 slide 数
    MAX_IMAGE_SIZE_BYTES: int = 5 * 1024 * 1024      # 单张图片上限 5MB
    MAX_IMAGES_PER_DOC: int = 50                     # 全文档图片上限
    MAX_IMAGE_TOTAL_BYTES: int = 50 * 1024 * 1024    # 全文档图片总量上限 50MB
    PLAIN_READ_MAX_BYTES: int = 2 * 1024 * 1024      # 纯文本 f.read() 上限 2MB

    # ── 搜索/代理稳定性配置 ──
    SEARCH_TIMEOUT: int = 30                         # 搜索 HTML 抓取超时(秒)
    PROXY_MAX_RETRIES: int = 2                       # 每个代理最多重试次数
    PROXY_RETRY_BACKOFF: list[float] = [1.0, 3.0]   # 代理重试退避秒数

    ROOT_PATH: str = ""
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://42.121.164.11"]

    # Z-Library credentials (stored encrypted at runtime, never logged)
    ZLIB_EMAIL: str = ""
    ZLIB_PASSWORD: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    def ensure_dirs(self) -> None:
        for d in (self.UPLOAD_DIR, self.AUDIO_DIR, self.COVER_DIR, self.DOC_IMAGES_DIR, self.SLIDE_IMAGES_DIR):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
