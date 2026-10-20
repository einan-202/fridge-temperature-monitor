"""Read-only weekly retrospective API (Phase 3.1).

Endpoints:
- GET /api/lookups
- GET /api/overview?week=YYYY-MM-DD
- GET /api/series/{logger_id}/{fridge_id}?week=YYYY-MM-DD

No uploads, no schema changes, no real-time / freshness status.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.deps import get_db
from app.weekly_report import (
    build_lookups,
    build_overview,
    build_series_detail,
    parse_week_param,
)

router = APIRouter(prefix="/api")


@router.get("/lookups")
def get_lookups(session: Session = Depends(get_db)) -> dict:
    return build_lookups(session)


@router.get("/overview")
def get_overview(
    week: str | None = Query(default=None, description="Any date in YYYY-MM-DD; selects its Monday-based week"),
    session: Session = Depends(get_db),
) -> dict:
    try:
        week_date = parse_week_param(week)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid week: {exc}") from None
    return build_overview(session, week_date)


@router.get("/series/{logger_id}/{fridge_id}")
def get_series(
    logger_id: int,
    fridge_id: int,
    week: str | None = Query(default=None, description="Any date in YYYY-MM-DD; selects its Monday-based week"),
    session: Session = Depends(get_db),
) -> dict:
    try:
        week_date = parse_week_param(week)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"invalid week: {exc}") from None
    detail = build_series_detail(session, logger_id, fridge_id, week_date)
    if detail is None:
        raise HTTPException(status_code=404, detail="logger or fridge not found")
    return detail
