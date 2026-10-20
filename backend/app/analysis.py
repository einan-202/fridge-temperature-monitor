"""Deterministic weekly retrospective temperature analysis.

Pure functions over time-ordered readings. Constants live here, are passed
explicitly where tests need to override them, and are documented in NOTES.md.

This is retrospective monitoring of a reporting week — not real-time status.
There is no freshness clock and no `now` input.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Iterable, Sequence

# ---------------------------------------------------------------------------
# Constants (provisional business assumptions where noted; see NOTES.md)
# ---------------------------------------------------------------------------

THRESHOLD_C = Decimal("5.0")  # excursion means strictly above
GAP_MIN = 30  # minutes; more than 2 of the sample's 15-minute intervals
WARMING_MIN_READINGS = 4
WARMING_MIN_RISE_C = Decimal("1.0")
WARMING_MAX_STEP_SHARE = Decimal("0.5")
WEEK_START_DAY = 0  # Monday — provisional
MIN_COVERAGE = Decimal("0.90")  # provisional
WEEK_MINUTES = 7 * 24 * 60  # 10080


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Reading:
    """One reading. `temperature_c is None` means invalid (see `raw_value`)."""

    measured_at: datetime
    temperature_c: Decimal | None
    raw_value: str | None = None


@dataclass(frozen=True)
class Excursion:
    start: datetime
    end: datetime
    peak_c: Decimal
    reading_count: int
    duration_minutes: int
    ended_by: str  # recovered | gap | invalid_reading | end_of_period | end_of_data
    kind: str  # isolated_spike | sustained | unconfirmed


@dataclass(frozen=True)
class WarmingRun:
    start: datetime
    end: datetime
    rise_c: Decimal
    reading_count: int


@dataclass(frozen=True)
class GapIssue:
    start: datetime
    end: datetime
    minutes: int


@dataclass(frozen=True)
class InvalidReadingIssue:
    measured_at: datetime
    raw_value: str | None


@dataclass(frozen=True)
class TimeInterval:
    start: datetime
    end: datetime

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


@dataclass
class SeriesAnalysis:
    """Findings for one (logger, fridge) series inside a reporting week."""

    excursions: list[Excursion] = field(default_factory=list)
    warming_runs: list[WarmingRun] = field(default_factory=list)
    gaps: list[GapIssue] = field(default_factory=list)
    invalid_readings: list[InvalidReadingIssue] = field(default_factory=list)
    single_valid_reading: bool = False
    max_temperature_c: Decimal | None = None
    max_temperature_at: datetime | None = None
    observed_intervals: list[TimeInterval] = field(default_factory=list)
    observed_minutes: int = 0
    unobserved_periods: list[TimeInterval] = field(default_factory=list)


@dataclass
class Coverage:
    observed_minutes: int
    week_minutes: int
    share: Decimal
    unobserved_periods: list[TimeInterval]
    is_estimate: bool = True  # always; see NOTES.md / plan caveats


@dataclass
class FridgeWeekResult:
    """Grouped findings for one fridge in one reporting week."""

    result: str  # excursion_observed | warming_observed | insufficient_data | no_excursion_observed
    coverage: Coverage
    max_temperature_c: Decimal | None
    max_temperature_at: datetime | None
    max_temperature_logger_id: int | None
    excursion_count: int
    sustained_count: int
    isolated_spike_count: int
    unconfirmed_count: int
    warming_count: int
    gap_count: int
    invalid_count: int
    series: list[dict]  # lightweight per-series summaries (filled by API layer)


# ---------------------------------------------------------------------------
# Week helpers
# ---------------------------------------------------------------------------


def week_start(d: date | datetime, week_start_day: int = WEEK_START_DAY) -> datetime:
    """Monday 00:00 (or configured start day) of the week containing `d`."""
    if isinstance(d, datetime):
        d = d.date()
    # Python: Monday=0 … Sunday=6, matching WEEK_START_DAY.
    delta = (d.weekday() - week_start_day) % 7
    start_date = d - timedelta(days=delta)
    return datetime(start_date.year, start_date.month, start_date.day)


def week_bounds(
    d: date | datetime, week_start_day: int = WEEK_START_DAY
) -> tuple[datetime, datetime]:
    """Inclusive start, exclusive end of the reporting week containing `d`."""
    start = week_start(d, week_start_day)
    return start, start + timedelta(days=7)


def week_monday(d: date | datetime, week_start_day: int = WEEK_START_DAY) -> date:
    return week_start(d, week_start_day).date()


# ---------------------------------------------------------------------------
# Core series analysis
# ---------------------------------------------------------------------------


def _is_gap(earlier: datetime, later: datetime, gap_min: int = GAP_MIN) -> bool:
    minutes = (later - earlier).total_seconds() / 60.0
    return minutes > gap_min


def _excursion_kind(reading_count: int, ended_by: str) -> str:
    if reading_count >= 2:
        return "sustained"
    if ended_by == "recovered":
        return "isolated_spike"
    return "unconfirmed"


def analyze_series(
    readings: Sequence[Reading],
    *,
    week_start_at: datetime,
    week_end_at: datetime,
    has_later_reading: bool,
    threshold_c: Decimal = THRESHOLD_C,
    gap_min: int = GAP_MIN,
    warming_min_readings: int = WARMING_MIN_READINGS,
    warming_min_rise_c: Decimal = WARMING_MIN_RISE_C,
    warming_max_step_share: Decimal = WARMING_MAX_STEP_SHARE,
) -> SeriesAnalysis:
    """Analyse one series' readings that fall inside `[week_start_at, week_end_at)`.

    `readings` must already be filtered to the week and sorted by `measured_at`.
    `has_later_reading` is True iff the series has any reading at or after
    `week_end_at` in the database (any value, including invalid). That decides
    `end_of_period` vs `end_of_data` for a run still open at the week's last
    reading — a series with no later reading is always `end_of_data`, even when
    that last reading coincides with a week boundary.
    """
    result = SeriesAnalysis()
    if not readings:
        result.unobserved_periods = [
            TimeInterval(week_start_at, week_end_at),
        ]
        return result

    valid_count = sum(1 for r in readings if r.temperature_c is not None)
    result.single_valid_reading = valid_count == 1

    # Maximum among valid readings.
    for r in readings:
        if r.temperature_c is None:
            result.invalid_readings.append(
                InvalidReadingIssue(r.measured_at, r.raw_value)
            )
            continue
        if result.max_temperature_c is None or r.temperature_c > result.max_temperature_c:
            result.max_temperature_c = r.temperature_c
            result.max_temperature_at = r.measured_at

    # Walk the full sequence: excursions, gaps, observed intervals.
    _detect_excursions_and_gaps(
        readings,
        result,
        has_later_reading=has_later_reading,
        threshold_c=threshold_c,
        gap_min=gap_min,
    )
    _detect_warming(
        readings,
        result,
        gap_min=gap_min,
        warming_min_readings=warming_min_readings,
        warming_min_rise_c=warming_min_rise_c,
        warming_max_step_share=warming_max_step_share,
    )
    result.observed_intervals = _observed_intervals(readings, gap_min=gap_min)
    result.observed_minutes = sum(i.minutes for i in result.observed_intervals)
    result.unobserved_periods = unobserved_periods(
        week_start_at, week_end_at, result.observed_intervals, gap_min=gap_min
    )
    return result


def _detect_excursions_and_gaps(
    readings: Sequence[Reading],
    result: SeriesAnalysis,
    *,
    has_later_reading: bool,
    threshold_c: Decimal,
    gap_min: int,
) -> None:
    """Walk readings in order; an invalid reading or gap ends the current run."""
    run: list[Reading] = []  # consecutive above-threshold valid readings
    last_valid: Reading | None = None

    def close_run(ended_by: str) -> None:
        nonlocal run
        if not run:
            return
        peak = max(r.temperature_c for r in run)  # type: ignore[type-var]
        assert peak is not None
        start, end = run[0].measured_at, run[-1].measured_at
        duration = int((end - start).total_seconds() // 60)
        result.excursions.append(
            Excursion(
                start=start,
                end=end,
                peak_c=peak,
                reading_count=len(run),
                duration_minutes=duration,
                ended_by=ended_by,
                kind=_excursion_kind(len(run), ended_by),
            )
        )
        run = []

    for reading in readings:
        if reading.temperature_c is None:
            # Invalid: ends any open excursion; does not create a gap issue by itself.
            if run:
                close_run("invalid_reading")
            last_valid = None  # break continuity for the next valid reading
            continue

        if last_valid is not None and _is_gap(last_valid.measured_at, reading.measured_at, gap_min):
            minutes = int(
                (reading.measured_at - last_valid.measured_at).total_seconds() // 60
            )
            result.gaps.append(
                GapIssue(last_valid.measured_at, reading.measured_at, minutes)
            )
            if run:
                close_run("gap")

        if reading.temperature_c > threshold_c:
            run.append(reading)
        else:
            if run:
                close_run("recovered")

        last_valid = reading

    if run:
        ended_by = "end_of_period" if has_later_reading else "end_of_data"
        close_run(ended_by)


def _detect_warming(
    readings: Sequence[Reading],
    result: SeriesAnalysis,
    *,
    gap_min: int,
    warming_min_readings: int,
    warming_min_rise_c: Decimal,
    warming_max_step_share: Decimal,
) -> None:
    """Find maximal contiguous rising stretches that meet the warming criteria."""
    # Split into contiguous valid segments (no gap, no invalid).
    segments: list[list[Reading]] = []
    current: list[Reading] = []
    last_valid: Reading | None = None

    def flush() -> None:
        nonlocal current
        if current:
            segments.append(current)
            current = []

    for reading in readings:
        if reading.temperature_c is None:
            flush()
            last_valid = None
            continue
        if last_valid is not None and _is_gap(
            last_valid.measured_at, reading.measured_at, gap_min
        ):
            flush()
        current.append(reading)
        last_valid = reading
    flush()

    for segment in segments:
        if len(segment) < warming_min_readings:
            continue
        # Find maximal contiguous rising runs within the segment.
        i = 0
        while i < len(segment):
            j = i
            while (
                j + 1 < len(segment)
                and segment[j + 1].temperature_c > segment[j].temperature_c  # type: ignore[operator]
            ):
                j += 1
            run = segment[i : j + 1]
            if len(run) >= warming_min_readings:
                temps = [r.temperature_c for r in run]
                assert all(t is not None for t in temps)
                rise = temps[-1] - temps[0]  # type: ignore[operator]
                if rise >= warming_min_rise_c:
                    steps = [temps[k + 1] - temps[k] for k in range(len(temps) - 1)]  # type: ignore[operator]
                    max_step = max(steps)
                    if max_step <= rise * warming_max_step_share:
                        result.warming_runs.append(
                            WarmingRun(
                                start=run[0].measured_at,
                                end=run[-1].measured_at,
                                rise_c=rise,
                                reading_count=len(run),
                            )
                        )
            i = j + 1


def _observed_intervals(
    readings: Sequence[Reading], *, gap_min: int = GAP_MIN
) -> list[TimeInterval]:
    """Observed time = first-to-last of each continuous valid run (no gap/invalid).

    A single reading observes 0 minutes. Coverage from these intervals is an
    estimate from recorded samples, not proof of continuous monitoring.
    """
    intervals: list[TimeInterval] = []
    run_start: datetime | None = None
    run_end: datetime | None = None
    last_valid: Reading | None = None

    def flush() -> None:
        nonlocal run_start, run_end
        if run_start is not None and run_end is not None and run_end > run_start:
            intervals.append(TimeInterval(run_start, run_end))
        run_start = None
        run_end = None

    for reading in readings:
        if reading.temperature_c is None:
            flush()
            last_valid = None
            continue
        if last_valid is not None and _is_gap(
            last_valid.measured_at, reading.measured_at, gap_min
        ):
            flush()
        if run_start is None:
            run_start = reading.measured_at
        run_end = reading.measured_at
        last_valid = reading
    flush()
    return intervals


def merge_intervals(intervals: Iterable[TimeInterval]) -> list[TimeInterval]:
    """Union of intervals, sorted. Used for fridge-level coverage only."""
    ordered = sorted(intervals, key=lambda i: (i.start, i.end))
    if not ordered:
        return []
    merged: list[TimeInterval] = [ordered[0]]
    for interval in ordered[1:]:
        last = merged[-1]
        if interval.start <= last.end:
            if interval.end > last.end:
                merged[-1] = TimeInterval(last.start, interval.end)
        else:
            merged.append(interval)
    return merged


def unobserved_periods(
    week_start_at: datetime,
    week_end_at: datetime,
    observed: Sequence[TimeInterval],
    *,
    gap_min: int = GAP_MIN,
) -> list[TimeInterval]:
    """Week minus observed intervals; keep only stretches longer than `gap_min`."""
    merged = merge_intervals(observed)
    gaps: list[TimeInterval] = []
    cursor = week_start_at
    for interval in merged:
        if interval.start > cursor:
            candidate = TimeInterval(cursor, interval.start)
            if candidate.minutes > gap_min:
                gaps.append(candidate)
        cursor = max(cursor, interval.end)
    if week_end_at > cursor:
        candidate = TimeInterval(cursor, week_end_at)
        if candidate.minutes > gap_min:
            gaps.append(candidate)
    return gaps


def coverage_from_intervals(
    observed: Sequence[TimeInterval],
    *,
    week_minutes: int = WEEK_MINUTES,
    gap_min: int = GAP_MIN,
    week_start_at: datetime | None = None,
    week_end_at: datetime | None = None,
) -> Coverage:
    merged = merge_intervals(observed)
    observed_minutes = sum(i.minutes for i in merged)
    share = (
        (Decimal(observed_minutes) / Decimal(week_minutes)).quantize(Decimal("0.0001"))
        if week_minutes
        else Decimal("0")
    )
    unobs: list[TimeInterval] = []
    if week_start_at is not None and week_end_at is not None:
        unobs = unobserved_periods(
            week_start_at, week_end_at, merged, gap_min=gap_min
        )
    return Coverage(
        observed_minutes=observed_minutes,
        week_minutes=week_minutes,
        share=share,
        unobserved_periods=unobs,
        is_estimate=True,
    )


def fridge_week_result(
    series_analyses: Sequence[SeriesAnalysis],
    *,
    week_start_at: datetime,
    week_end_at: datetime,
    min_coverage: Decimal = MIN_COVERAGE,
    gap_min: int = GAP_MIN,
    series_meta: Sequence[dict] | None = None,
) -> FridgeWeekResult:
    """Combine per-series analyses into one fridge result for the week.

    Detection rules never run across series; only coverage intervals are merged.
    """
    all_observed: list[TimeInterval] = []
    excursion_count = sustained = spike = unconfirmed = warming = gaps = invalids = 0
    max_c: Decimal | None = None
    max_at: datetime | None = None
    max_logger_id: int | None = None

    summaries: list[dict] = []
    meta = list(series_meta or [{} for _ in series_analyses])

    for analysis, info in zip(series_analyses, meta):
        all_observed.extend(analysis.observed_intervals)
        excursion_count += len(analysis.excursions)
        sustained += sum(1 for e in analysis.excursions if e.kind == "sustained")
        spike += sum(1 for e in analysis.excursions if e.kind == "isolated_spike")
        unconfirmed += sum(1 for e in analysis.excursions if e.kind == "unconfirmed")
        warming += len(analysis.warming_runs)
        gaps += len(analysis.gaps)
        invalids += len(analysis.invalid_readings)
        if analysis.max_temperature_c is not None:
            if max_c is None or analysis.max_temperature_c > max_c:
                max_c = analysis.max_temperature_c
                max_at = analysis.max_temperature_at
                max_logger_id = info.get("logger_id")
        summaries.append(
            {
                **info,
                "observed_minutes": analysis.observed_minutes,
                "max_temperature_c": analysis.max_temperature_c,
                "max_temperature_at": analysis.max_temperature_at,
                "excursion_count": len(analysis.excursions),
                "sustained_count": sum(
                    1 for e in analysis.excursions if e.kind == "sustained"
                ),
                "isolated_spike_count": sum(
                    1 for e in analysis.excursions if e.kind == "isolated_spike"
                ),
                "unconfirmed_count": sum(
                    1 for e in analysis.excursions if e.kind == "unconfirmed"
                ),
                "warming_count": len(analysis.warming_runs),
                "gap_count": len(analysis.gaps),
                "invalid_count": len(analysis.invalid_readings),
                "single_valid_reading": analysis.single_valid_reading,
            }
        )

    cov = coverage_from_intervals(
        all_observed,
        week_start_at=week_start_at,
        week_end_at=week_end_at,
        gap_min=gap_min,
    )

    if excursion_count > 0:
        result_label = "excursion_observed"
    elif warming > 0:
        result_label = "warming_observed"
    elif cov.share < min_coverage:
        result_label = "insufficient_data"
    else:
        result_label = "no_excursion_observed"

    return FridgeWeekResult(
        result=result_label,
        coverage=cov,
        max_temperature_c=max_c,
        max_temperature_at=max_at,
        max_temperature_logger_id=max_logger_id,
        excursion_count=excursion_count,
        sustained_count=sustained,
        isolated_spike_count=spike,
        unconfirmed_count=unconfirmed,
        warming_count=warming,
        gap_count=gaps,
        invalid_count=invalids,
        series=summaries,
    )


def duration_label(excursion: Excursion) -> str:
    """Human-readable duration wording (lower bound)."""
    if excursion.reading_count == 1:
        return "single reading"
    minutes = excursion.duration_minutes
    if excursion.ended_by in ("gap", "invalid_reading", "end_of_period", "end_of_data"):
        return f"at least {minutes} min"
    return f"{minutes} min"
