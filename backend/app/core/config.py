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

# Fail-fast in production: never run with the default dev secret outside dev,
# and never with a short secret (HMAC-SHA256 needs >= 32 bytes, RFC 7518 §3.2).
# Dev/test (ENV unset) are unaffected.
_ENV = os.getenv("ENV", os.getenv("APP_ENV", "dev")).lower()
_DEFAULT_SECRETS = {"change-me-in-env", "change-me", "dev-secret-change-me",
                    "dev-only-override-me-in-production-32plus"}
if _ENV in ("prod", "production", "staging"):
    if settings.jwt_secret in _DEFAULT_SECRETS:
        raise RuntimeError("JWT_SECRET must be set to a strong value in production (ENV=prod)")
    if len(settings.jwt_secret.encode()) < 32:
        raise RuntimeError("JWT_SECRET must be at least 32 bytes in production (ENV=prod)")
