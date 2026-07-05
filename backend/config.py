from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    AGENTOS_DATA_DIR: str = "/opt/data"
    AGENTOS_DB_PATH: str = "/opt/data/agentos.db"
    HERMES_API_URL: str = "http://localhost:8642"
    HERMES_API_KEY: str | None = None
    AGENTOS_PORT: int = 9120
    AGENTOS_HOST: str = "0.0.0.0"


settings = Settings()
