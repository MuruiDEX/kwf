from pydantic_settings import BaseSettings, SettingsConfigDict
import os


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_name: str = "KWF Tournament Platform"
    database_url: str = "sqlite:///./kwf.db"
    jwt_secret: str = "change-me-in-env"
    jwt_algorithm: str = "HS256"
    access_token_expire_min: int = 60 * 12
    cookie_secure: bool = False
    cors_origins: str = "http://localhost:5173"

settings = Settings()

# Fail-fast in production: never run with the default dev secret outside dev.
_ENV = os.getenv("ENV", os.getenv("APP_ENV", "dev")).lower()
_DEFAULT_SECRETS = {"change-me-in-env", "change-me", "dev-secret-change-me",
                    "dev-only-override-me-in-production-32plus"}
if _ENV in ("prod", "production", "staging") and settings.jwt_secret in _DEFAULT_SECRETS:
    raise RuntimeError("JWT_SECRET must be set to a strong value in production (ENV=prod)")
