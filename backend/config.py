from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./openinvoice.db"
    UPLOADS_DIR: str = "./uploads"
    CLERK_SECRET_KEY: str = ""
    CLERK_JWKS_URL: str = ""
    MINIMAX_API_KEY: str = ""
    CORS_ORIGINS: str = "http://localhost:3023,https://openinvoice.angelstreet.io"
    WEBHOOK_KEY: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
