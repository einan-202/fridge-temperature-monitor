"""Fridge Temperature Monitor backend — FastAPI application entrypoint.

Phase 1 scaffold: app-level health check only. Database connectivity,
`/api/*` business endpoints, and automated tests are intentionally
deferred to later steps (see NOTES.md).
"""

from fastapi import FastAPI

from app.routers import health

app = FastAPI(title="Fridge Temperature Monitor API")

app.include_router(health.router)


@app.get("/")
def read_root() -> dict:
    """Trivial welcome route."""
    return {"message": "Welcome to the Fridge Temperature Monitor API"}
