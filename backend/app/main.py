"""Fridge Temperature Monitor backend — FastAPI application entrypoint.

`/health` checks database connectivity. Phase 3.1 adds the read-only
weekly retrospective API under `/api/*`. Uploads are not implemented yet.
"""

from fastapi import FastAPI

from app.routers import api, health

app = FastAPI(title="Fridge Temperature Monitor API")

app.include_router(health.router)
app.include_router(api.router)


@app.get("/")
def read_root() -> dict:
    """Trivial welcome route."""
    return {"message": "Welcome to the Fridge Temperature Monitor API"}
