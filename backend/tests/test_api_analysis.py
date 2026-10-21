"""Integration tests for the weekly retrospective read API."""

from datetime import datetime
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.deps import get_db
from app.main import app
from app.models import Fridge, Logger, TemperatureReading
from app.seed import SAMPLE_DIR, find_sample_file, seed_sample

pytestmark = pytest.mark.integration

WEEK = "2026-09-14"


@pytest.fixture(scope="module")
def sample_path():
    if not list(SAMPLE_DIR.glob("*.xlsx")):
        pytest.skip(f"no .xlsx sample file in {SAMPLE_DIR}")
    return find_sample_file()


@pytest.fixture
def api_client(db_session, sample_path):
    seed_sample(db_session, sample_path)

    def override():
        yield db_session

    app.dependency_overrides[get_db] = override
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def _fridge(session, branch, name):
    return session.scalars(
        select(Fridge).where(Fridge.branch_name == branch, Fridge.name == name)
    ).one()


def _logger(session, code):
    return session.scalars(select(Logger).where(Logger.code == code)).one()


def _series(client, session, code, branch, name, week=WEEK):
    """GET /api/series/{logger_id}/{fridge_id}?week=… using codes/names, not hardcoded IDs."""
    logger = _logger(session, code)
    fridge = _fridge(session, branch, name)
    response = client.get(
        f"/api/series/{logger.id}/{fridge.id}", params={"week": week}
    )
    assert response.status_code == 200
    return response.json()


def _eq_temp(value, expected):
    assert value is not None
    assert Decimal(value) == Decimal(expected)


def test_lookups(api_client, db_session):
    """Seeded loggers and fridges are listed; TL-0231 is Fahrenheit."""
    body = api_client.get("/api/lookups").json()
    assert {logger["code"] for logger in body["loggers"]} == {
        "TL-0231",
        "TL-0388",
        "TL-0417",
        "TL-0512",
    }
    assert len(body["fridges"]) == 5
    tl = next(logger for logger in body["loggers"] if logger["code"] == "TL-0231")
    assert tl["unit"] == "F"


def test_overview_defaults_to_latest_week_golden(api_client, db_session):
    """Fridge-first overview for the seeded week matches the golden sample results."""
    body = api_client.get("/api/overview").json()
    assert body["weeks"] == [WEEK]
    assert body["week"]["monday"] == WEEK
    assert body["notes"]["coverage_is_estimate"] is True
    assert body["notes"]["unobserved_never_safe"] is True
    assert "FRESH_MAX_MIN" not in body.get("constants", {})
    assert "now" not in body

    by_key = {(f["branch"], f["name"]): f for f in body["fridges"]}

    cream = by_key[("Rishon LeZion", "Cream cakes")]
    assert cream["result"] == "excursion_observed"
    assert cream["sustained_count"] == 1
    assert cream["warming_count"] == 1
    assert cream["series"][0]["code"] == "TL-0388"
    assert cream["excursion_count"] == len(cream["excursions"]) == 1
    assert cream["excursions"][0]["logger_code"] == "TL-0388"
    assert cream["excursions"][0]["kind"] == "sustained"
    assert cream["excursions"][0]["start"] == "2026-09-14 06:15:00"
    assert cream["excursions"][0]["ended_by"] == "end_of_data"
    assert cream["excursions"][0]["duration_label"] == "at least 30 min"

    walk_in = by_key[("Tel Aviv", "Walk-in")]
    assert walk_in["result"] == "excursion_observed"
    assert walk_in["isolated_spike_count"] == 1
    assert walk_in["series"][0]["code"] == "TL-0417"
    assert walk_in["excursions"] == [
        {
            "logger_id": walk_in["series"][0]["logger_id"],
            "logger_code": "TL-0417",
            "start": "2026-09-14 06:15:00",
            "end": "2026-09-14 06:15:00",
            "kind": "isolated_spike",
            "duration_minutes": 0,
            "duration_label": "single reading",
            "ended_by": "recovered",
        }
    ]

    display = by_key[("Tel Aviv", "Display 2")]
    assert display["result"] == "insufficient_data"
    assert display["series"][0]["single_valid_reading"] is True
    assert display["series"][0]["code"] == "TL-0417"

    # TL-0417 is two fridges, each with one series — never merged.
    assert len(walk_in["series"]) == 1
    assert len(display["series"]) == 1

    jerusalem = by_key[("Jerusalem", "Dairy")]
    assert jerusalem["result"] == "insufficient_data"
    assert jerusalem["gap_count"] == 1
    assert jerusalem["excursions"] == []

    haifa = by_key[("Haifa", "Dairy")]
    assert haifa["result"] == "insufficient_data"
    assert haifa["invalid_count"] == 1
    assert haifa["excursions"] == []


def _reading(session, logger, fridge, at, temp, row=1):
    session.add(
        TemperatureReading(
            logger_id=logger.id,
            fridge_id=fridge.id,
            measured_at=at,
            temperature_c=None if temp is None else Decimal(str(temp)),
            raw_value=None if temp is None else str(temp),
            raw_timestamp=at.strftime("%d/%m/%Y %H:%M"),
            source_file="test",
            source_row=row,
        )
    )


def _overview_fridge(client, branch, name, week):
    body = client.get("/api/overview", params={"week": week}).json()
    return next(f for f in body["fridges"] if f["branch"] == branch and f["name"] == name)


def test_overview_excursions_recovered_sustained(api_client, db_session):
    client, session = api_client, db_session
    logger = _logger(session, "TL-0512")
    fridge = _fridge(session, "Jerusalem", "Dairy")
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 0), "4.0", 1)
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 15), "5.4", 2)
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 30), "5.6", 3)
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 45), "4.2", 4)
    session.flush()

    dairy = _overview_fridge(client, "Jerusalem", "Dairy", "2026-10-12")
    assert dairy["excursion_count"] == 1
    event = dairy["excursions"][0]
    assert event["logger_code"] == "TL-0512"
    assert event["kind"] == "sustained"
    assert event["start"] == "2026-10-12 06:15:00"
    assert event["end"] == "2026-10-12 06:30:00"
    assert event["duration_minutes"] == 15
    assert event["duration_label"] == "15 min"
    assert event["ended_by"] == "recovered"


def test_overview_excursions_end_of_data(api_client, db_session):
    client, session = api_client, db_session
    logger = _logger(session, "TL-0512")
    fridge = _fridge(session, "Jerusalem", "Dairy")
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 0), "5.4", 1)
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 15), "5.8", 2)
    session.flush()

    dairy = _overview_fridge(client, "Jerusalem", "Dairy", "2026-10-12")
    event = dairy["excursions"][0]
    assert event["kind"] == "sustained"
    assert event["ended_by"] == "end_of_data"
    assert event["duration_label"] == "at least 15 min"
    assert event["start"] == "2026-10-12 06:00:00"
    assert event["end"] == "2026-10-12 06:15:00"


def test_overview_excursions_end_of_period(api_client, db_session):
    client, session = api_client, db_session
    logger = _logger(session, "TL-0512")
    fridge = _fridge(session, "Jerusalem", "Dairy")
    _reading(session, logger, fridge, datetime(2026, 10, 18, 23, 45), "6.2", 1)
    _reading(session, logger, fridge, datetime(2026, 10, 19, 6, 0), "4.0", 2)
    session.flush()

    dairy = _overview_fridge(client, "Jerusalem", "Dairy", "2026-10-12")
    event = dairy["excursions"][0]
    assert event["ended_by"] == "end_of_period"
    assert event["kind"] == "unconfirmed"
    assert event["start"] == "2026-10-18 23:45:00"
    assert event["duration_label"] == "single reading"


def test_overview_excursions_isolated_high_reading(api_client, db_session):
    client, session = api_client, db_session
    logger = _logger(session, "TL-0512")
    fridge = _fridge(session, "Jerusalem", "Dairy")
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 0), "4.0", 1)
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 15), "9.4", 2)
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 30), "4.1", 3)
    session.flush()

    dairy = _overview_fridge(client, "Jerusalem", "Dairy", "2026-10-12")
    event = dairy["excursions"][0]
    assert event["kind"] == "isolated_spike"
    assert event["ended_by"] == "recovered"
    assert event["duration_minutes"] == 0
    assert event["duration_label"] == "single reading"
    assert event["start"] == event["end"] == "2026-10-12 06:15:00"


def test_overview_excursions_keep_separate_logger_histories(api_client, db_session):
    client, session = api_client, db_session
    jerusalem = _fridge(session, "Jerusalem", "Dairy")
    first = _logger(session, "TL-0512")
    second = _logger(session, "TL-0388")
    _reading(session, first, jerusalem, datetime(2026, 10, 12, 6, 0), "5.4", 1)
    _reading(session, first, jerusalem, datetime(2026, 10, 12, 6, 15), "5.6", 2)
    _reading(session, first, jerusalem, datetime(2026, 10, 12, 6, 30), "4.0", 3)
    _reading(session, second, jerusalem, datetime(2026, 10, 12, 8, 0), "4.0", 1)
    _reading(session, second, jerusalem, datetime(2026, 10, 12, 8, 15), "9.1", 2)
    _reading(session, second, jerusalem, datetime(2026, 10, 12, 8, 30), "4.2", 3)
    session.flush()

    dairy = _overview_fridge(client, "Jerusalem", "Dairy", "2026-10-12")
    assert dairy["excursion_count"] == 2
    assert len(dairy["excursions"]) == 2
    by_logger = {event["logger_code"]: event for event in dairy["excursions"]}
    assert set(by_logger) == {"TL-0512", "TL-0388"}
    assert by_logger["TL-0512"]["kind"] == "sustained"
    assert by_logger["TL-0512"]["ended_by"] == "recovered"
    assert by_logger["TL-0512"]["duration_label"] == "15 min"
    assert by_logger["TL-0388"]["kind"] == "isolated_spike"
    assert by_logger["TL-0388"]["duration_label"] == "single reading"
    # Not merged into one run from 06:00 to 08:15.
    assert by_logger["TL-0512"]["end"] == "2026-10-12 06:15:00"
    assert by_logger["TL-0388"]["start"] == "2026-10-12 08:15:00"


def test_overview_excursions_differ_by_selected_week(api_client, db_session):
    client, session = api_client, db_session
    logger = _logger(session, "TL-0388")
    fridge = _fridge(session, "Rishon LeZion", "Cream cakes")
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 0), "5.5", 1)
    _reading(session, logger, fridge, datetime(2026, 10, 12, 6, 15), "4.0", 2)
    session.flush()

    september = _overview_fridge(client, "Rishon LeZion", "Cream cakes", "2026-09-14")
    october = _overview_fridge(client, "Rishon LeZion", "Cream cakes", "2026-10-12")
    assert september["excursions"][0]["start"] == "2026-09-14 06:15:00"
    assert september["excursions"][0]["ended_by"] == "end_of_data"
    assert october["excursions"][0]["start"] == "2026-10-12 06:00:00"
    assert october["excursions"][0]["kind"] == "isolated_spike"
    assert october["excursions"][0]["ended_by"] == "recovered"


def test_overview_week_param_selects_monday_week(api_client):
    """Any date in a week selects that Monday-based week; empty weeks are insufficient_data."""
    for value in ("2026-09-14", "2026-09-17", "2026-09-20"):
        assert api_client.get("/api/overview", params={"week": value}).json()["week"][
            "monday"
        ] == WEEK

    empty_week = api_client.get("/api/overview", params={"week": "2026-09-21"}).json()
    assert empty_week["week"]["monday"] == "2026-09-21"
    assert all(f["result"] == "insufficient_data" for f in empty_week["fridges"])


def test_overview_empty_database(db_session):
    """With no readings, overview returns empty weeks and fridges."""

    def override():
        yield db_session

    app.dependency_overrides[get_db] = override
    try:
        with TestClient(app) as client:
            body = client.get("/api/overview").json()
            assert body["weeks"] == []
            assert body["fridges"] == []
            assert body["week"] is None
    finally:
        app.dependency_overrides.clear()


def test_overview_independent_of_server_clock(api_client):
    """Overview is deterministic: two identical requests match, and there is no `now`."""
    first = api_client.get("/api/overview").json()
    second = api_client.get("/api/overview").json()
    assert first == second
    assert "now" not in first


def test_series_detail_golden_cream_cakes(api_client, db_session):
    """Rishon LeZion / Cream cakes (TL-0388) — curl-verified week of 2026-09-14."""
    body = _series(api_client, db_session, "TL-0388", "Rishon LeZion", "Cream cakes")
    assert body["week"]["monday"] == WEEK

    assert [r["measured_at"] for r in body["readings"]] == [
        "2026-09-14 06:00:00",
        "2026-09-14 06:15:00",
        "2026-09-14 06:30:00",
        "2026-09-14 06:45:00",
    ]
    assert [Decimal(r["temperature_c"]) for r in body["readings"]] == [
        Decimal("4.6"),
        Decimal("5.4"),
        Decimal("6.3"),
        Decimal("7.1"),
    ]

    assert len(body["excursions"]) == 1
    excursion = body["excursions"][0]
    assert excursion["kind"] == "sustained"
    assert excursion["start"] == "2026-09-14 06:15:00"
    assert excursion["end"] == "2026-09-14 06:45:00"
    _eq_temp(excursion["peak_c"], "7.10")
    assert excursion["duration_minutes"] == 30
    assert excursion["ended_by"] == "end_of_data"
    assert excursion["duration_label"] == "at least 30 min"

    assert len(body["warming_runs"]) == 1
    warming = body["warming_runs"][0]
    _eq_temp(warming["rise_c"], "2.50")
    assert warming["reading_count"] == 4
    assert warming["start"] == "2026-09-14 06:00:00"
    assert warming["end"] == "2026-09-14 06:45:00"

    assert body["observed_minutes"] == 45
    assert body["notes"]["unobserved_never_safe"] is True


def test_series_detail_recovered_spike_and_walk_in(api_client, db_session):
    """Tel Aviv / Walk-in (TL-0417) — curl-verified week of 2026-09-14."""
    body = _series(api_client, db_session, "TL-0417", "Tel Aviv", "Walk-in")
    assert body["week"]["monday"] == WEEK

    assert [r["measured_at"] for r in body["readings"]] == [
        "2026-09-14 05:45:00",
        "2026-09-14 06:00:00",
        "2026-09-14 06:15:00",
        "2026-09-14 06:30:00",
    ]
    assert [Decimal(r["temperature_c"]) for r in body["readings"]] == [
        Decimal("4.0"),
        Decimal("4.1"),
        Decimal("9.4"),
        Decimal("4.3"),
    ]

    assert len(body["excursions"]) == 1
    excursion = body["excursions"][0]
    assert excursion["kind"] == "isolated_spike"
    assert excursion["start"] == "2026-09-14 06:15:00"
    assert excursion["end"] == "2026-09-14 06:15:00"
    _eq_temp(excursion["peak_c"], "9.40")
    assert excursion["ended_by"] == "recovered"
    assert excursion["duration_minutes"] == 0
    assert excursion["duration_label"] == "single reading"
    assert body["warming_runs"] == []


def test_series_detail_jerusalem_dairy_gap(api_client, db_session):
    """Jerusalem / Dairy (TL-0512) — curl-verified week of 2026-09-14."""
    body = _series(api_client, db_session, "TL-0512", "Jerusalem", "Dairy")
    assert body["week"]["monday"] == WEEK

    assert [r["measured_at"] for r in body["readings"]] == [
        "2026-09-14 06:00:00",
        "2026-09-14 06:15:00",
        "2026-09-14 08:30:00",
    ]
    assert [Decimal(r["temperature_c"]) for r in body["readings"]] == [
        Decimal("3.8"),
        Decimal("3.9"),
        Decimal("4.0"),
    ]

    assert body["excursions"] == []
    assert body["warming_runs"] == []
    assert len(body["gaps"]) == 1
    gap = body["gaps"][0]
    assert gap["start"] == "2026-09-14 06:15:00"
    assert gap["end"] == "2026-09-14 08:30:00"
    assert gap["minutes"] == 135
    _eq_temp(body["max_temperature_c"], "4.00")


def test_series_detail_haifa_dairy_fahrenheit_and_err(api_client, db_session):
    """Haifa / Dairy (TL-0231) — Fahrenheit conversion, raw values, NULL ERR."""
    body = _series(api_client, db_session, "TL-0231", "Haifa", "Dairy")
    assert body["week"]["monday"] == WEEK

    assert [r["measured_at"] for r in body["readings"]] == [
        "2026-09-14 06:00:00",
        "2026-09-14 06:15:00",
        "2026-09-14 06:30:00",
    ]
    # Raw Fahrenheit values are preserved; converted Celsius is stored.
    assert body["readings"][0]["raw_value"] == "38.3"
    _eq_temp(body["readings"][0]["temperature_c"], "3.50")
    assert body["readings"][1]["raw_value"] == "39"
    _eq_temp(body["readings"][1]["temperature_c"], "3.89")
    # ERR is stored as NULL temperature_c and listed under invalid_readings.
    assert body["readings"][2]["raw_value"] == "ERR"
    assert body["readings"][2]["temperature_c"] is None
    assert body["invalid_readings"] == [
        {"measured_at": "2026-09-14 06:30:00", "raw_value": "ERR"}
    ]

    assert body["excursions"] == []
    _eq_temp(body["max_temperature_c"], "3.89")


def test_series_truncated_monday_not_end_of_period_with_later_week(api_client, db_session):
    """Later-week rows must not imply the fridge stayed high through Sunday."""
    logger = _logger(db_session, "TL-0388")
    fridge = _fridge(db_session, "Rishon LeZion", "Cream cakes")
    db_session.add(
        TemperatureReading(
            logger_id=logger.id,
            fridge_id=fridge.id,
            measured_at=datetime(2026, 9, 21, 6, 0),
            temperature_c=None,
            raw_value="later",
            raw_timestamp="21/09/2026 06:00",
            source_file="test",
            source_row=1,
        )
    )
    db_session.flush()

    body = _series(api_client, db_session, "TL-0388", "Rishon LeZion", "Cream cakes")
    assert body["excursions"][0]["ended_by"] == "end_of_data"
    assert body["excursions"][0]["end"] == "2026-09-14 06:45:00"
    assert body["excursions"][0]["duration_label"] == "at least 30 min"


def test_series_end_of_period_when_later_reading_exists(api_client, db_session):
    """A later reading plus a last sample at week end is end_of_period."""
    logger = _logger(db_session, "TL-0388")
    fridge = _fridge(db_session, "Rishon LeZion", "Cream cakes")
    db_session.add(
        TemperatureReading(
            logger_id=logger.id,
            fridge_id=fridge.id,
            measured_at=datetime(2026, 9, 20, 23, 45),
            temperature_c=Decimal("6.20"),
            raw_value="6.20",
            raw_timestamp="20/09/2026 23:45",
            source_file="test",
            source_row=1,
        )
    )
    db_session.add(
        TemperatureReading(
            logger_id=logger.id,
            fridge_id=fridge.id,
            measured_at=datetime(2026, 9, 21, 6, 0),
            temperature_c=None,
            raw_value="later",
            raw_timestamp="21/09/2026 06:00",
            source_file="test",
            source_row=2,
        )
    )
    db_session.flush()

    body = _series(api_client, db_session, "TL-0388", "Rishon LeZion", "Cream cakes")
    sunday = next(e for e in body["excursions"] if e["end"] == "2026-09-20 23:45:00")
    assert sunday["ended_by"] == "end_of_period"
    monday = next(e for e in body["excursions"] if e["end"] == "2026-09-14 06:45:00")
    assert monday["ended_by"] == "gap"

    overview = api_client.get("/api/overview").json()
    assert overview["weeks"][0] == "2026-09-21"
    assert WEEK in overview["weeks"]


def test_series_404(api_client):
    """Unknown logger/fridge ids return 404."""
    assert api_client.get("/api/series/99999/99999").status_code == 404


def test_invalid_week_param(api_client):
    """A non-ISO week query parameter returns 400."""
    assert api_client.get("/api/overview", params={"week": "not-a-date"}).status_code == 400
