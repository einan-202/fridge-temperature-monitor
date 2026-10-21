"""Unit tests for weekly retrospective analysis (no database)."""

from datetime import datetime, timedelta
from decimal import Decimal

from app.analysis import (
    GAP_MIN,
    MIN_COVERAGE,
    THRESHOLD_C,
    WEEK_START_DAY,
    Reading,
    analyze_series,
    coverage_from_intervals,
    duration_label,
    fridge_week_result,
    merge_intervals,
    week_bounds,
    week_monday,
    TimeInterval,
)


def R(day_hour_min_temp, raw=None):
    """Shorthand: (day, hour, minute, temp_or_None) -> Reading. Base date 2026-09-14."""
    d, h, m, t = day_hour_min_temp
    return Reading(
        datetime(2026, 9, d, h, m),
        None if t is None else Decimal(str(t)),
        raw if raw is not None else (None if t is None else str(t)),
    )


WEEK_START, WEEK_END = week_bounds(datetime(2026, 9, 14))


def analyze(readings, has_later=False, **kwargs):
    return analyze_series(
        readings,
        week_start_at=WEEK_START,
        week_end_at=WEEK_END,
        has_later_reading=has_later,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Threshold, gaps, excursions
# ---------------------------------------------------------------------------


def test_threshold_strictly_above():
    a = analyze([R((14, 6, 0, "5.0")), R((14, 6, 15, "5.1"))])
    assert len(a.excursions) == 1
    assert a.excursions[0].peak_c == Decimal("5.1")
    assert a.excursions[0].reading_count == 1
    assert a.excursions[0].ended_by == "end_of_data"


def test_sustained_excursion_and_single_reading():
    sustained = analyze(
        [R((14, 6, 0, "5.5")), R((14, 6, 15, "6.0")), R((14, 6, 30, "5.8"))]
    )
    assert sustained.excursions[0].kind == "sustained"
    assert sustained.excursions[0].duration_minutes == 30
    assert sustained.excursions[0].ended_by == "end_of_data"

    single = analyze([R((14, 6, 0, "4.0")), R((14, 6, 15, "9.4")), R((14, 6, 30, "4.3"))])
    assert single.excursions[0].kind == "isolated_spike"
    assert single.excursions[0].duration_minutes == 0
    assert single.excursions[0].ended_by == "recovered"


def test_gap_splits_excursions():
    a = analyze(
        [
            R((14, 6, 0, "6.0")),
            R((14, 6, 15, "6.5")),
            R((14, 7, 0, "6.2")),  # 45 min later > GAP_MIN
        ]
    )
    assert len(a.excursions) == 2
    assert a.excursions[0].ended_by == "gap"
    assert a.excursions[1].ended_by == "end_of_data"
    assert len(a.gaps) == 1
    assert a.gaps[0].minutes == 45


def test_gap_boundary_30_vs_31():
    no_gap = analyze([R((14, 6, 0, "4.0")), R((14, 6, 30, "4.1"))])
    assert no_gap.gaps == []
    yes_gap = analyze([R((14, 6, 0, "4.0")), R((14, 6, 31, "4.1"))])
    assert len(yes_gap.gaps) == 1
    assert yes_gap.gaps[0].minutes == 31


def test_invalid_reading_ends_run_not_skipped():
    """7.0, ERR, 7.2 at 15-min steps: two unconfirmed excursions, never one of three."""
    a = analyze(
        [
            R((14, 6, 0, "7.0")),
            R((14, 6, 15, None), raw="ERR"),
            R((14, 6, 30, "7.2")),
        ]
    )
    assert len(a.excursions) == 2
    assert a.excursions[0].ended_by == "invalid_reading"
    assert a.excursions[0].kind == "unconfirmed"
    assert a.excursions[1].ended_by == "end_of_data"
    assert a.excursions[1].kind == "unconfirmed"
    assert len(a.invalid_readings) == 1
    assert a.invalid_readings[0].raw_value == "ERR"


def test_err_breaks_warming():
    a = analyze(
        [
            R((14, 6, 0, "4.0")),
            R((14, 6, 15, "4.5")),
            R((14, 6, 30, None), raw="ERR"),
            R((14, 6, 45, "5.0")),
            R((14, 7, 0, "5.6")),
        ]
    )
    assert a.warming_runs == []


def test_err_between_normal_does_not_create_excursion():
    a = analyze(
        [
            R((14, 6, 0, "3.0")),
            R((14, 6, 15, None), raw="ERR"),
            R((14, 6, 30, "3.5")),
        ]
    )
    assert a.excursions == []
    assert len(a.invalid_readings) == 1


# ---------------------------------------------------------------------------
# end_of_data vs end_of_period
# ---------------------------------------------------------------------------


def test_end_of_data_when_no_later_reading_even_at_week_boundary():
    # Last reading of the week, nothing after → end_of_data, never end_of_period.
    a = analyze([R((14, 6, 0, "6.0")), R((14, 6, 15, "6.5"))], has_later=False)
    assert a.excursions[0].ended_by == "end_of_data"


def test_truncated_monday_is_end_of_data_even_with_later_week():
    """Recordings that stop Monday are not the reporting-period boundary."""
    a = analyze([R((14, 6, 15, "5.4")), R((14, 6, 30, "6.3")), R((14, 6, 45, "7.1"))], has_later=True)
    assert a.excursions[0].ended_by == "end_of_data"
    assert duration_label(a.excursions[0]) == "at least 30 min"


def test_end_of_period_when_later_reading_exists_at_week_boundary():
    a = analyze([R((20, 23, 45, "6.5"))], has_later=True)
    assert a.excursions[0].ended_by == "end_of_period"
    assert duration_label(a.excursions[0]) == "single reading"


def test_open_run_45_min_before_week_end_is_end_of_data():
    """Later-week data does not make a Sunday 23:15 sample the period boundary."""
    a = analyze([R((20, 23, 15, "6.5"))], has_later=True)
    assert a.excursions[0].ended_by == "end_of_data"


def test_end_of_data_not_guessed_as_period():
    """Open at last reading of series with nothing after → end_of_data."""
    a = analyze([R((20, 23, 45, "7.0"))], has_later=False)  # Sunday near week end
    assert a.excursions[0].ended_by == "end_of_data"


def test_recovered_excursion_is_not_end_of_data():
    a = analyze([R((14, 6, 15, "5.4")), R((14, 6, 30, "4.2"))], has_later=True)
    assert a.excursions[0].ended_by == "recovered"
    assert duration_label(a.excursions[0]) == "single reading"


# ---------------------------------------------------------------------------
# Warming
# ---------------------------------------------------------------------------


def test_warming_positive_and_guards():
    good = analyze(
        [
            R((14, 6, 0, "4.6")),
            R((14, 6, 15, "5.4")),
            R((14, 6, 30, "6.3")),
            R((14, 6, 45, "7.1")),
        ]
    )
    assert len(good.warming_runs) == 1
    assert good.warming_runs[0].rise_c == Decimal("2.5")

    too_few = analyze(
        [R((14, 6, 0, "4.0")), R((14, 6, 15, "4.5")), R((14, 6, 30, "5.0"))]
    )
    assert too_few.warming_runs == []

    small_rise = analyze(
        [
            R((14, 6, 0, "4.0")),
            R((14, 6, 15, "4.2")),
            R((14, 6, 30, "4.4")),
            R((14, 6, 45, "4.5")),
        ]
    )
    assert small_rise.warming_runs == []

    flat = analyze(
        [
            R((14, 6, 0, "4.0")),
            R((14, 6, 15, "4.5")),
            R((14, 6, 30, "4.5")),
            R((14, 6, 45, "5.5")),
        ]
    )
    assert flat.warming_runs == []

    spike_guard = analyze(
        [
            R((14, 6, 0, "4.0")),
            R((14, 6, 15, "4.1")),
            R((14, 6, 30, "4.2")),
            R((14, 6, 45, "9.4")),
        ]
    )
    assert spike_guard.warming_runs == []


# ---------------------------------------------------------------------------
# Weekly window
# ---------------------------------------------------------------------------


def test_week_bounds_monday():
    assert WEEK_START_DAY == 0
    start, end = week_bounds(datetime(2026, 9, 17))  # Thursday
    assert start == datetime(2026, 9, 14)
    assert end == datetime(2026, 9, 21)
    assert week_monday(datetime(2026, 9, 14, 0, 0)) == datetime(2026, 9, 14).date()
    # Monday 00:00 belongs to the new week; Sunday 23:59 to the old one.
    assert week_monday(datetime(2026, 9, 14, 0, 0)) == datetime(2026, 9, 14).date()
    assert week_monday(datetime(2026, 9, 13, 23, 59)) == datetime(2026, 9, 7).date()


def test_recovered_excursion_stays_visible():
    a = analyze(
        [
            R((15, 6, 0, "6.5")),  # Tuesday
            R((15, 6, 15, "4.0")),
            R((20, 12, 0, "3.5")),  # Sunday normal
        ]
    )
    assert len(a.excursions) == 1
    assert a.excursions[0].ended_by == "recovered"
    assert a.excursions[0].peak_c == Decimal("6.5")
    fr = fridge_week_result(
        [a], week_start_at=WEEK_START, week_end_at=WEEK_END
    )
    assert fr.result == "excursion_observed"


# ---------------------------------------------------------------------------
# Coverage and fridge result
# ---------------------------------------------------------------------------


def test_coverage_full_week_no_excursion():
    # Build observed intervals covering >= MIN_COVERAGE (full-week synthetic).
    from app.analysis import SeriesAnalysis

    start = WEEK_START
    minutes = int(Decimal("10080") * MIN_COVERAGE) + 1
    intervals = [TimeInterval(start, start + timedelta(minutes=minutes))]
    cov = coverage_from_intervals(
        intervals, week_start_at=WEEK_START, week_end_at=WEEK_END
    )
    assert cov.share >= MIN_COVERAGE
    assert cov.is_estimate is True

    high = SeriesAnalysis(observed_intervals=intervals, observed_minutes=minutes)
    fr = fridge_week_result([high], week_start_at=WEEK_START, week_end_at=WEEK_END)
    assert fr.result == "no_excursion_observed"


def test_insufficient_data_below_min_coverage():
    a = analyze(
        [R((14, 6, 0, "3.8")), R((14, 6, 15, "3.9")), R((14, 8, 30, "4.0"))]
    )
    fr = fridge_week_result([a], week_start_at=WEEK_START, week_end_at=WEEK_END)
    assert fr.result == "insufficient_data"
    assert fr.coverage.share < MIN_COVERAGE
    assert fr.coverage.is_estimate is True


def test_coverage_exactly_at_min_coverage_boundary():
    minutes_ok = int(Decimal("10080") * MIN_COVERAGE)
    minutes_under = minutes_ok - 1
    from app.analysis import SeriesAnalysis

    ok = SeriesAnalysis(
        observed_intervals=[
            TimeInterval(WEEK_START, WEEK_START + timedelta(minutes=minutes_ok))
        ],
        observed_minutes=minutes_ok,
    )
    under = SeriesAnalysis(
        observed_intervals=[
            TimeInterval(WEEK_START, WEEK_START + timedelta(minutes=minutes_under))
        ],
        observed_minutes=minutes_under,
    )
    assert (
        fridge_week_result([ok], week_start_at=WEEK_START, week_end_at=WEEK_END).result
        == "no_excursion_observed"
    )
    assert (
        fridge_week_result(
            [under], week_start_at=WEEK_START, week_end_at=WEEK_END
        ).result
        == "insufficient_data"
    )


def test_single_reading_observes_zero_minutes():
    a = analyze([R((17, 6, 0, "3.7"))])
    assert a.observed_minutes == 0
    assert a.single_valid_reading is True


def test_excursion_with_low_coverage_still_excursion_observed():
    a = analyze(
        [R((14, 6, 0, "5.4")), R((14, 6, 15, "6.3")), R((14, 6, 30, "7.1"))]
    )
    fr = fridge_week_result([a], week_start_at=WEEK_START, week_end_at=WEEK_END)
    assert fr.result == "excursion_observed"
    assert fr.coverage.share < MIN_COVERAGE


def test_warming_only_result():
    # Four rising readings all below threshold.
    a = analyze(
        [
            R((14, 6, 0, "2.0")),
            R((14, 6, 15, "2.5")),
            R((14, 6, 30, "3.0")),
            R((14, 6, 45, "3.5")),
        ]
    )
    assert a.warming_runs and not a.excursions
    fr = fridge_week_result([a], week_start_at=WEEK_START, week_end_at=WEEK_END)
    assert fr.result == "warming_observed"


def test_max_ignores_invalid():
    a = analyze(
        [
            R((14, 6, 0, "3.5")),
            R((14, 6, 15, None), raw="ERR"),
            R((14, 6, 30, "4.0")),
        ]
    )
    assert a.max_temperature_c == Decimal("4.0")


def test_fridge_coverage_merges_series_no_double_count():
    # Two overlapping 30-minute observed intervals → merged 45 minutes.
    from app.analysis import SeriesAnalysis

    a = SeriesAnalysis(
        observed_intervals=[
            TimeInterval(datetime(2026, 9, 14, 6, 0), datetime(2026, 9, 14, 6, 30))
        ],
        observed_minutes=30,
    )
    b = SeriesAnalysis(
        observed_intervals=[
            TimeInterval(datetime(2026, 9, 14, 6, 15), datetime(2026, 9, 14, 6, 45))
        ],
        observed_minutes=30,
    )
    fr = fridge_week_result(
        [a, b],
        week_start_at=WEEK_START,
        week_end_at=WEEK_END,
        series_meta=[{"logger_id": 1, "code": "A"}, {"logger_id": 2, "code": "B"}],
    )
    assert fr.coverage.observed_minutes == 45
    assert len(fr.series) == 2


def test_merge_intervals():
    merged = merge_intervals(
        [
            TimeInterval(datetime(2026, 9, 14, 6, 0), datetime(2026, 9, 14, 6, 30)),
            TimeInterval(datetime(2026, 9, 14, 6, 15), datetime(2026, 9, 14, 6, 45)),
            TimeInterval(datetime(2026, 9, 14, 8, 0), datetime(2026, 9, 14, 8, 15)),
        ]
    )
    assert len(merged) == 2
    assert merged[0].minutes == 45


def test_duration_label():
    a = analyze([R((14, 6, 0, "4.0")), R((14, 6, 15, "9.4")), R((14, 6, 30, "4.0"))])
    assert duration_label(a.excursions[0]) == "single reading"
    b = analyze(
        [R((14, 6, 0, "5.5")), R((14, 6, 15, "6.0")), R((14, 6, 30, "6.5"))],
        has_later=False,
    )
    assert "at least" in duration_label(b.excursions[0])


# ---------------------------------------------------------------------------
# Golden sample (16 rows / 15 readings), week of 2026-09-14
# ---------------------------------------------------------------------------


def test_golden_tl_0388_cream_cakes():
    a = analyze(
        [
            R((14, 6, 0, "4.6")),
            R((14, 6, 15, "5.4")),
            R((14, 6, 30, "6.3")),
            R((14, 6, 45, "7.1")),
        ]
    )
    assert len(a.excursions) == 1
    e = a.excursions[0]
    assert e.kind == "sustained"
    assert e.start == datetime(2026, 9, 14, 6, 15)
    assert e.end == datetime(2026, 9, 14, 6, 45)
    assert e.peak_c == Decimal("7.1")
    assert e.duration_minutes == 30
    assert e.ended_by == "end_of_data"
    assert len(a.warming_runs) == 1
    assert a.warming_runs[0].rise_c == Decimal("2.5")
    assert a.observed_minutes == 45
    fr = fridge_week_result([a], week_start_at=WEEK_START, week_end_at=WEEK_END)
    assert fr.result == "excursion_observed"


def test_golden_tl_0417_walk_in():
    a = analyze(
        [
            R((14, 5, 45, "4.0")),
            R((14, 6, 0, "4.1")),
            R((14, 6, 15, "9.4")),
            R((14, 6, 30, "4.3")),
        ]
    )
    assert len(a.excursions) == 1
    assert a.excursions[0].kind == "isolated_spike"
    assert a.excursions[0].peak_c == Decimal("9.4")
    assert a.excursions[0].duration_minutes == 0
    assert a.warming_runs == []
    fr = fridge_week_result([a], week_start_at=WEEK_START, week_end_at=WEEK_END)
    assert fr.result == "excursion_observed"


def test_golden_tl_0417_display_2():
    a = analyze([R((17, 6, 0, "3.7"))])
    assert a.excursions == []
    assert a.single_valid_reading is True
    assert a.observed_minutes == 0
    fr = fridge_week_result([a], week_start_at=WEEK_START, week_end_at=WEEK_END)
    assert fr.result == "insufficient_data"


def test_golden_tl_0512_jerusalem_dairy():
    a = analyze(
        [
            R((14, 6, 0, "3.8")),
            R((14, 6, 15, "3.9")),
            R((14, 8, 30, "4.0")),
        ]
    )
    assert a.excursions == []
    assert len(a.gaps) == 1
    assert a.gaps[0].minutes == 135
    fr = fridge_week_result([a], week_start_at=WEEK_START, week_end_at=WEEK_END)
    assert fr.result == "insufficient_data"


def test_golden_tl_0231_haifa_dairy():
    a = analyze(
        [
            R((14, 6, 0, "3.50")),
            R((14, 6, 15, "3.89")),
            R((14, 6, 30, None), raw="ERR"),
        ]
    )
    assert a.excursions == []
    assert len(a.invalid_readings) == 1
    fr = fridge_week_result([a], week_start_at=WEEK_START, week_end_at=WEEK_END)
    assert fr.result == "insufficient_data"


def test_constants_match_plan():
    assert THRESHOLD_C == Decimal("5.0")
    assert GAP_MIN == 30
    assert MIN_COVERAGE == Decimal("0.90")
    assert WEEK_START_DAY == 0
