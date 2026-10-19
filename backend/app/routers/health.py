"""App-level health check.

This endpoint deliberately does NOT check database connectivity yet.
Database connectivity checks are a later Phase 1 step (see NOTES.md).
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def get_health() -> dict:
    """Return a simple app-level health signal.

    No database query happens here — this only confirms the FastAPI
    process is up and serving requests.
    """
    return {"status": "ok"}
