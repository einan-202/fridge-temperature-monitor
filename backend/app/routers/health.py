"""Health check endpoint.

Checks both that the FastAPI process is up and that the database is
reachable. Returns HTTP 503 when the database check fails, so the
Docker/Compose healthcheck (and any other caller) can tell the two
states apart.
"""

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.database import check_connection

router = APIRouter()


@router.get("/health")
def get_health():
    """Return app + database health.

    - 200 ``{"status": "ok", "database": "connected"}`` when the DB is reachable.
    - 503 ``{"status": "error", "database": "unreachable"}`` when it is not.
    """
    if check_connection():
        return {"status": "ok", "database": "connected"}
    return JSONResponse(
        status_code=503,
        content={"status": "error", "database": "unreachable"},
    )
