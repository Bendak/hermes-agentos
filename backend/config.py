import os

from pydantic_settings import BaseSettings


def _default_data_dir() -> str:
    """Auto-detect Hermes data directory across platforms.

    Priority:
    1. AGENTOS_DATA_DIR env var (explicit override)
    2. HERMES_DATA_DIR env var (set by Hermes on pip installs)
    3. Platform defaults:
       - Docker container: /opt/data
       - Linux/macOS: ~/.hermes
       - Windows: %USERPROFILE%\\.hermes
    """
    explicit = os.environ.get("AGENTOS_DATA_DIR")
    if explicit:
        return explicit

    hermes_dir = os.environ.get("HERMES_DATA_DIR")
    if hermes_dir:
        return hermes_dir

    # Docker container marker
    if os.path.exists("/opt/data/.hermes"):
        return "/opt/data"

    # Platform default
    home = os.path.expanduser("~")
    return os.path.join(home, ".hermes")


class Settings(BaseSettings):
    AGENTOS_DATA_DIR: str = _default_data_dir()
    AGENTOS_DB_PATH: str = ""
    HERMES_API_URL: str = "http://localhost:8642"
    HERMES_API_KEY: str | None = None
    AGENTOS_PORT: int = 9120
    AGENTOS_HOST: str = "0.0.0.0"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.AGENTOS_DB_PATH:
            self.AGENTOS_DB_PATH = os.path.join(self.AGENTOS_DATA_DIR, "agentos.db")


settings = Settings()
