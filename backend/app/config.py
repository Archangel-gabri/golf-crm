from pathlib import Path
from typing import Annotated, Literal

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent.parent.parent

Env = Literal["local", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BASE_DIR / ".env", BASE_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    ENV: Env = "local"

    SECRET_KEY: str = ""
    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'golf.db'}"

    JWT_ALG: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 8

    COOKIE_NAME: str = "golf_session"
    COOKIE_SECURE: bool = False
    COOKIE_SAMESITE: Literal["lax", "strict", "none"] = "lax"

    CORS_ORIGINS: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    CLUB_NAME: str = "Крылатское"
    CLUB_TIMEZONE: str = "Europe/Moscow"
    OPENING_HOUR: int = 0
    CLOSING_HOUR: int = 24
    SLOT_MINUTES: int = 30

    DOCS_ENABLED: bool = True

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def _parse_cors(cls, v):
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @model_validator(mode="after")
    def _enforce_production(self):
        if self.ENV == "production":
            if not self.SECRET_KEY or len(self.SECRET_KEY) < 32:
                raise ValueError(
                    "SECRET_KEY must be set (>=32 chars) when ENV=production. "
                    "Generate: python -c 'import secrets; print(secrets.token_hex(64))'"
                )
            if not self.COOKIE_SECURE:
                self.COOKIE_SECURE = True
            if any("localhost" in o or "127.0.0.1" in o for o in self.CORS_ORIGINS):
                raise ValueError("CORS_ORIGINS must not contain localhost in production")
            if not self.CORS_ORIGINS:
                raise ValueError("CORS_ORIGINS must be set in production")
            self.DOCS_ENABLED = False
        elif not self.SECRET_KEY:
            import secrets
            self.SECRET_KEY = secrets.token_hex(64)
        return self

    @property
    def is_production(self) -> bool:
        return self.ENV == "production"

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")


settings = Settings()
