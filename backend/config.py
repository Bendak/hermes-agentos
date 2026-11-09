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


def _dotenv_value(name: str) -> str:
    """Read a setting from AGENTOS_DATA_DIR/.env when the process env lacks it."""
    bases = [os.environ.get("AGENTOS_DATA_DIR"), _default_data_dir(), "/opt/data"]
    seen: set[str] = set()
    for base in bases:
        if not base or base in seen:
            continue
        seen.add(base)
        path = os.path.join(base, ".env")
        try:
            with open(path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line.startswith("export "):
                        line = line[7:].lstrip()
                    if line.startswith(name + "="):
                        return line.split("=", 1)[1].strip().strip('"').strip("'")
        except OSError:
            pass
    return ""


class Settings(BaseSettings):
    AGENTOS_DATA_DIR: str = _default_data_dir()
    AGENTOS_DB_PATH: str = ""
    HERMES_API_URL: str = "http://localhost:8642"
    HERMES_API_KEY: str | None = None
    AGENTOS_PORT: int = 9120
    AGENTOS_HOST: str = "0.0.0.0"
    # Comma-separated profiles that must not be picked as a kanban assignee or
    # a chat profile in the UI (they answer their own user only). Deployment
    # specific: keep the real names in the untracked local .env, never here.
    HIDDEN_PROFILES: str = ""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        if not self.AGENTOS_DB_PATH:
            self.AGENTOS_DB_PATH = os.path.join(self.AGENTOS_DATA_DIR, "agentos.db")


settings = Settings()


def hidden_profiles() -> set[str]:
    """Profiles that must not be picked/read by non-admins.

    The list is deployment configuration: process env wins, then the untracked
    ``$AGENTOS_DATA_DIR/.env``. There is no hardcoded family/profile list in the
    public repo.
    """
    raw = (settings.HIDDEN_PROFILES or "").strip() or _dotenv_value("HIDDEN_PROFILES")
    return {p.strip().lower() for p in raw.split(",") if p.strip()}


def is_hidden(profile_id: str | None) -> bool:
    return bool(profile_id) and profile_id.strip().lower() in hidden_profiles()
