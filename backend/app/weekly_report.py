"""Build weekly retrospective reports from stored readings.

Thin orchestration over `app.analysis` and the ORM. No schema changes.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.analysis import (
    MIN_COVERAGE,
    WEEK_START_DAY,
    Coverage,
    FridgeWeekResult,
    Reading,
    SeriesAnalysis,
    analyze_series,
    fridge_week_result,
    week_bounds,
    week_monday,
)
from app.models import Fridge, Logger, TemperatureReading


def _dec(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value, "f")


def _dt(value: datetime | None) -> str | None:
    return value.isoformat(sep=" ") if value is not None else None


def list_weeks_with_readings(session: Session) -> list[date]:
    """Mondays of weeks that contain at least one reading, newest first."""
    times = session.scalars(select(TemperatureReading.measured_at)).all()
    mondays = {week_monday(t) for t in times}
    return sorted(mondays, reverse=True)


def resolve_week(
    session: Session, week: date | datetime | None
) -> tuple[datetime, datetime, list[date]]:
    """Return (week_start, week_end, available_weeks).

    If `week` is None, use the latest week containing readings. If there are
    no readings, return a zero-length window and an empty week list.
    """
    weeks = list_weeks_with_readings(session)
    if not weeks:
        # No data: empty report. Arbitrary empty window; callers check weeks.
        empty = datetime(1970, 1, 1)
        return empty, empty, []
    if week is None:
        selected = weeks[0]
    else:
        selected = week_monday(week)
    start, end = week_bounds(selected)
    return start, end, weeks


def _readings_for_series(
    session: Session,
    logger_id: int,
    fridge_id: int,
    week_start_at: datetime,
    week_end_at: datetime,
) -> tuple[list[Reading], bool]:
    rows = session.scalars(
        select(TemperatureReading)
        .where(
            TemperatureReading.logger_id == logger_id,
            TemperatureReading.fridge_id == fridge_id,
            TemperatureReading.measured_at >= week_start_at,
            TemperatureReading.measured_at < week_end_at,
        )
        .order_by(TemperatureReading.measured_at)
    ).all()
    readings = [
        Reading(r.measured_at, r.temperature_c, r.raw_value) for r in rows
    ]
    later = session.scalar(
        select(func.count())
        .select_from(TemperatureReading)
        .where(
            TemperatureReading.logger_id == logger_id,
            TemperatureReading.fridge_id == fridge_id,
            TemperatureReading.measured_at >= week_end_at,
        )
    )
    return readings, bool(later and later > 0)


def analyze_series_in_week(
    session: Session,
    logger_id: int,
    fridge_id: int,
    week_start_at: datetime,
    week_end_at: datetime,
) -> tuple[SeriesAnalysis, list[TemperatureReading]]:
    readings, has_later = _readings_for_series(
        session, logger_id, fridge_id, week_start_at, week_end_at
    )
    analysis = analyze_series(
        readings,
        week_start_at=week_start_at,
        week_end_at=week_end_at,
        has_later_reading=has_later,
    )
    rows = session.scalars(
        select(TemperatureReading)
        .where(
            TemperatureReading.logger_id == logger_id,
            TemperatureReading.fridge_id == fridge_id,
            TemperatureReading.measured_at >= week_start_at,
            TemperatureReading.measured_at < week_end_at,
        )
        .order_by(TemperatureReading.measured_at)
    ).all()
    return analysis, list(rows)


def build_overview(session: Session, week: date | datetime | None = None) -> dict:
    week_start_at, week_end_at, weeks = resolve_week(session, week)
    if not weeks:
        return {
            "weeks": [],
            "week": None,
            "fridges": [],
            "constants": _constants_payload(),
            "notes": {
                "coverage_is_estimate": True,
                "unobserved_never_safe": True,
            },
        }

    # Series present in the week: distinct (logger_id, fridge_id).
    pairs = session.execute(
        select(
            TemperatureReading.logger_id,
            TemperatureReading.fridge_id,
        )
        .where(
            TemperatureReading.measured_at >= week_start_at,
            TemperatureReading.measured_at < week_end_at,
        )
        .distinct()
    ).all()

    # Also include fridges that exist but have no readings this week? Plan says:
    # "A fridge with no valid readings that week is insufficient_data."
    # and "Fridges with no readings" — list all fridges that either have readings
    # in the week OR exist. Looking at plan: "one entry per fridge" and
    # "A fridge with no valid readings that week is `insufficient_data`."
    # I'll include every fridge that has any readings in the selected week
    # (via a series). Fridges with zero readings that week won't appear unless
    # they have a series with only invalid readings — those still appear via pairs.
    # Fridges with no readings at all in the week are omitted from the week report
    # (they're not in `pairs`). Plan also: "a week with no readings for a fridge
    # is insufficient_data" in tests — that suggests listing fridges that exist
    # but have no data that week. Re-read:
    # "a week with no readings for a fridge is `insufficient_data`"
    # So we should list all fridges. Let me include all fridges from the table.

    all_fridges = session.scalars(select(Fridge).order_by(Fridge.id)).all()
    loggers_by_id = {
        logger.id: logger for logger in session.scalars(select(Logger)).all()
    }

    # Group pairs by fridge.
    pairs_by_fridge: dict[int, list[int]] = {}
    for logger_id, fridge_id in pairs:
        pairs_by_fridge.setdefault(fridge_id, []).append(logger_id)

    fridge_entries = []
    for fridge in all_fridges:
        logger_ids = sorted(pairs_by_fridge.get(fridge.id, []))
        analyses: list[SeriesAnalysis] = []
        meta: list[dict] = []
        for logger_id in logger_ids:
            analysis, _ = analyze_series_in_week(
                session, logger_id, fridge.id, week_start_at, week_end_at
            )
            analyses.append(analysis)
            logger = loggers_by_id[logger_id]
            meta.append({"logger_id": logger_id, "code": logger.code})

        if not analyses:
            # Fridge exists but has no readings in this week.
            result = FridgeWeekResult(
                result="insufficient_data",
                coverage=Coverage(
                    observed_minutes=0,
                    week_minutes=7 * 24 * 60,
                    share=Decimal("0"),
                    unobserved_periods=[],
                ),
                max_temperature_c=None,
                max_temperature_at=None,
                max_temperature_logger_id=None,
                excursion_count=0,
                sustained_count=0,
                isolated_spike_count=0,
                unconfirmed_count=0,
                warming_count=0,
                gap_count=0,
                invalid_count=0,
                series=[],
            )
        else:
            result = fridge_week_result(
                analyses,
                week_start_at=week_start_at,
                week_end_at=week_end_at,
                min_coverage=MIN_COVERAGE,
                series_meta=meta,
            )

        fridge_entries.append(_fridge_entry(fridge, result, loggers_by_id))

    # Sort: excursions first, then warming, then insufficient, then no_excursion.
    order = {
        "excursion_observed": 0,
        "warming_observed": 1,
        "insufficient_data": 2,
        "no_excursion_observed": 3,
    }
    fridge_entries.sort(key=lambda e: (order.get(e["result"], 9), e["branch"], e["name"]))

    return {
        "weeks": [w.isoformat() for w in weeks],
        "week": {
            "start": _dt(week_start_at),
            "end": _dt(week_end_at),
            "monday": week_start_at.date().isoformat(),
        },
        "fridges": fridge_entries,
        "constants": _constants_payload(),
        "notes": {
            "coverage_is_estimate": True,
            "unobserved_never_safe": True,
        },
    }


def _fridge_entry(fridge: Fridge, result, loggers_by_id: dict) -> dict:
    cov = result.coverage
    max_logger_code = None
    if result.max_temperature_logger_id is not None:
        logger = loggers_by_id.get(result.max_temperature_logger_id)
        if logger is not None:
            max_logger_code = logger.code

    series_out = []
    for item in result.series:
        series_out.append(
            {
                "logger_id": item["logger_id"],
                "code": item["code"],
                "observed_minutes": item["observed_minutes"],
                "max_temperature_c": _dec(item["max_temperature_c"]),
                "max_temperature_at": _dt(item["max_temperature_at"]),
                "excursion_count": item["excursion_count"],
                "sustained_count": item["sustained_count"],
                "isolated_spike_count": item["isolated_spike_count"],
                "unconfirmed_count": item["unconfirmed_count"],
                "warming_count": item["warming_count"],
                "gap_count": item["gap_count"],
                "invalid_count": item["invalid_count"],
                "single_valid_reading": item["single_valid_reading"],
            }
        )

    return {
        "fridge_id": fridge.id,
        "branch": fridge.branch_name,
        "name": fridge.name,
        "result": result.result,
        "max_temperature_c": _dec(result.max_temperature_c),
        "max_temperature_at": _dt(result.max_temperature_at),
        "max_temperature_logger": max_logger_code,
        "coverage": {
            "observed_minutes": cov.observed_minutes,
            "week_minutes": cov.week_minutes,
            "share": _dec(cov.share),
            "is_estimate": True,
            "unobserved_periods": [
                {"start": _dt(p.start), "end": _dt(p.end), "minutes": p.minutes}
                for p in cov.unobserved_periods
            ],
        },
        "excursion_count": result.excursion_count,
        "sustained_count": result.sustained_count,
        "isolated_spike_count": result.isolated_spike_count,
        "unconfirmed_count": result.unconfirmed_count,
        "warming_count": result.warming_count,
        "gap_count": result.gap_count,
        "invalid_count": result.invalid_count,
        "series": series_out,
    }


def build_series_detail(
    session: Session,
    logger_id: int,
    fridge_id: int,
    week: date | datetime | None = None,
) -> dict | None:
    logger = session.get(Logger, logger_id)
    fridge = session.get(Fridge, fridge_id)
    if logger is None or fridge is None:
        return None

    week_start_at, week_end_at, weeks = resolve_week(session, week)
    if not weeks and week is None:
        return {
            "logger_id": logger_id,
            "logger_code": logger.code,
            "fridge_id": fridge_id,
            "branch": fridge.branch_name,
            "fridge_name": fridge.name,
            "weeks": [],
            "week": None,
            "readings": [],
            "excursions": [],
            "warming_runs": [],
            "gaps": [],
            "invalid_readings": [],
            "max_temperature_c": None,
            "max_temperature_at": None,
            "observed_minutes": 0,
            "unobserved_periods": [],
            "single_valid_reading": False,
            "notes": {
                "coverage_is_estimate": True,
                "unobserved_never_safe": True,
            },
        }

    # If a week was requested explicitly even with no data weeks, still analyse.
    if week is not None:
        week_start_at, week_end_at = week_bounds(week)

    analysis, rows = analyze_series_in_week(
        session, logger_id, fridge_id, week_start_at, week_end_at
    )

    from app.analysis import duration_label  # local import keeps payload helpers together

    return {
        "logger_id": logger_id,
        "logger_code": logger.code,
        "fridge_id": fridge_id,
        "branch": fridge.branch_name,
        "fridge_name": fridge.name,
        "weeks": [w.isoformat() for w in weeks],
        "week": {
            "start": _dt(week_start_at),
            "end": _dt(week_end_at),
            "monday": week_start_at.date().isoformat(),
        },
        "readings": [
            {
                "measured_at": _dt(r.measured_at),
                "temperature_c": _dec(r.temperature_c),
                "raw_value": r.raw_value,
                "raw_timestamp": r.raw_timestamp,
                "source_file": r.source_file,
                "source_row": r.source_row,
            }
            for r in rows
        ],
        "excursions": [
            {
                "start": _dt(e.start),
                "end": _dt(e.end),
                "peak_c": _dec(e.peak_c),
                "reading_count": e.reading_count,
                "duration_minutes": e.duration_minutes,
                "duration_label": duration_label(e),
                "ended_by": e.ended_by,
                "kind": e.kind,
            }
            for e in analysis.excursions
        ],
        "warming_runs": [
            {
                "start": _dt(w.start),
                "end": _dt(w.end),
                "rise_c": _dec(w.rise_c),
                "reading_count": w.reading_count,
            }
            for w in analysis.warming_runs
        ],
        "gaps": [
            {
                "start": _dt(g.start),
                "end": _dt(g.end),
                "minutes": g.minutes,
            }
            for g in analysis.gaps
        ],
        "invalid_readings": [
            {
                "measured_at": _dt(i.measured_at),
                "raw_value": i.raw_value,
            }
            for i in analysis.invalid_readings
        ],
        "max_temperature_c": _dec(analysis.max_temperature_c),
        "max_temperature_at": _dt(analysis.max_temperature_at),
        "observed_minutes": analysis.observed_minutes,
        "unobserved_periods": [
            {"start": _dt(p.start), "end": _dt(p.end), "minutes": p.minutes}
            for p in analysis.unobserved_periods
        ],
        "single_valid_reading": analysis.single_valid_reading,
        "notes": {
            "coverage_is_estimate": True,
            "unobserved_never_safe": True,
        },
    }


def build_lookups(session: Session) -> dict:
    loggers = session.scalars(select(Logger).order_by(Logger.code)).all()
    fridges = session.scalars(
        select(Fridge).order_by(Fridge.branch_name, Fridge.name)
    ).all()
    return {
        "loggers": [
            {"id": logger.id, "code": logger.code, "unit": logger.unit}
            for logger in loggers
        ],
        "fridges": [
            {
                "id": fridge.id,
                "branch": fridge.branch_name,
                "name": fridge.name,
            }
            for fridge in fridges
        ],
    }


def _constants_payload() -> dict:
    from app.analysis import (
        GAP_MIN,
        THRESHOLD_C,
        WARMING_MAX_STEP_SHARE,
        WARMING_MIN_READINGS,
        WARMING_MIN_RISE_C,
    )

    return {
        "THRESHOLD_C": _dec(THRESHOLD_C),
        "GAP_MIN": GAP_MIN,
        "WARMING_MIN_READINGS": WARMING_MIN_READINGS,
        "WARMING_MIN_RISE_C": _dec(WARMING_MIN_RISE_C),
        "WARMING_MAX_STEP_SHARE": _dec(WARMING_MAX_STEP_SHARE),
        "WEEK_START_DAY": WEEK_START_DAY,
        "MIN_COVERAGE": _dec(MIN_COVERAGE),
    }


def parse_week_param(value: str | None) -> date | None:
    """Parse `YYYY-MM-DD` or return None. Raises ValueError on bad input."""
    if value is None or value == "":
        return None
    return date.fromisoformat(value)
