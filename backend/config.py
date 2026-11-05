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
    # Profiles that exist but must not be picked as a kanban assignee or a chat
    # profile in the UI (they answer their own user only).
    HIDDEN_PROFILES: str = "familia_simone,familia_anna"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.AGENTOS_DB_PATH:
            self.AGENTOS_DB_PATH = os.path.join(self.AGENTOS_DATA_DIR, "agentos.db")


settings = Settings()


_DEFAULT_HIDDEN = "familia_simone,familia_anna"


def hidden_profiles() -> set[str]:
    """Profiles that must not be picked/read by non-admins.

    Empty/whitespace config falls back to the default list: a blank env must
    never silently disable the guard (fail-closed).
    """
    raw = (settings.HIDDEN_PROFILES or "").strip() or _DEFAULT_HIDDEN
    return {p.strip().lower() for p in raw.split(",") if p.strip()}
