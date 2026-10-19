"""Fridge Temperature Monitor backend — FastAPI application entrypoint.

Phase 1: `/health` now checks database connectivity (see
app/database.py). `/api/*` business endpoints and business models/tables
are intentionally deferred to later steps.
"""

from fastapi import FastAPI

from app.routers import health

app = FastAPI(title="Fridge Temperature Monitor API")

app.include_router(health.router)


@app.get("/")
def read_root() -> dict:
    """Trivial welcome route."""
    return {"message": "Welcome to the Fridge Temperature Monitor API"}
