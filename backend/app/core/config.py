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

    MAX_UPLOAD_SIZE_MB: int = 100
    ALLOWED_EXTENSIONS: set[str] = {"pdf", "docx", "txt", "md"}

    ROOT_PATH: str = ""
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://localhost:3000", "http://42.121.164.11"]

    # Z-Library credentials (stored encrypted at runtime, never logged)
    ZLIB_EMAIL: str = ""
    ZLIB_PASSWORD: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    def ensure_dirs(self) -> None:
        for d in (self.UPLOAD_DIR, self.AUDIO_DIR, self.COVER_DIR):
            d.mkdir(parents=True, exist_ok=True)


settings = Settings()
settings.ensure_dirs()
