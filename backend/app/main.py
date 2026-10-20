"""Fridge Temperature Monitor backend — FastAPI application entrypoint.

`/health` checks database connectivity. Phase 3 adds the weekly retrospective
read API and the historical / weekly upload endpoints under `/api/*`.
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
