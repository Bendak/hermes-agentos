"""ASGI entrypoint shim: `uvicorn main:app` works alongside the canonical
`uvicorn backend.main:app`."""
from backend.main import app  # noqa: F401
