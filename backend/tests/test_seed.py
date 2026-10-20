"""Integration tests for the sample seed (isolated test DB, rolled back per test).

The sample file is located by scanning the sample_data directory; no file name
is hardcoded.
"""

from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy import func, select

from app.models import Fridge, Logger, LoggerAssignment, TemperatureReading
from app.seed import SAMPLE_DIR, SeedError, find_sample_file, seed_sample

pytestmark = pytest.mark.integration


@pytest.fixture(scope="module")
def sample_path():
    if not list(SAMPLE_DIR.glob("*.xlsx")):
        pytest.skip(f"no .xlsx sample file in {SAMPLE_DIR}")
    return find_sample_file()


def count(session, model, *where):
    return session.scalar(select(func.count()).select_from(model).where(*where))


def all_counts(session):
    return tuple(count(session, m) for m in (Fridge, Logger, LoggerAssignment, TemperatureReading))


def test_seed_counts_and_result(db_session, sample_path):
    result = seed_sample(db_session, sample_path)

    assert all_counts(db_session) == (5, 4, 5, 15)
    assert count(db_session, TemperatureReading, TemperatureReading.temperature_c.is_not(None)) == 14
    assert count(db_session, TemperatureReading, TemperatureReading.temperature_c.is_(None)) == 1
    assert (result.rows_read, result.inserted, result.duplicates) == (16, 15, 1)
    assert (len(result.rejected), len(result.conflicts), result.blank_rows) == (0, 0, 0)
    assert result.null_temperatures == 1
    assert result.source_file == sample_path.name


def test_err_reading_is_null_with_raw_value(db_session, sample_path):
    seed_sample(db_session, sample_path)
    err = db_session.scalars(select(TemperatureReading).where(TemperatureReading.raw_value == "ERR")).one()
    assert err.temperature_c is None
    assert err.measured_at == datetime(2026, 9, 14, 6, 30)


def test_tl_0231_is_fahrenheit_with_raw_preserved_and_day_first_dates(db_session, sample_path):
    seed_sample(db_session, sample_path)
    logger = db_session.scalar(select(Logger).where(Logger.code == "TL-0231"))
    assert logger.unit == "F"
    rows = db_session.scalars(
        select(TemperatureReading)
        .where(TemperatureReading.logger_id == logger.id, TemperatureReading.temperature_c.is_not(None))
        .order_by(TemperatureReading.measured_at)
    ).all()
    assert [(r.temperature_c, r.raw_value) for r in rows] == [
        (Decimal("3.50"), "38.3"),
        (Decimal("3.89"), "39"),
    ]
    assert [r.measured_at for r in rows] == [datetime(2026, 9, 14, 6, 0), datetime(2026, 9, 14, 6, 15)]
    assert rows[0].raw_timestamp == "14/09/2026 06:00"
    assert db_session.scalar(
        select(func.count()).select_from(Logger).where(Logger.code != "TL-0231", Logger.unit == "F")
    ) == 0


def test_tl_0417_two_undated_assignments_and_readings_on_their_own_fridge(db_session, sample_path):
    seed_sample(db_session, sample_path)
    logger = db_session.scalar(select(Logger).where(Logger.code == "TL-0417"))

    assignments = db_session.execute(
        select(Fridge.branch_name, Fridge.name, LoggerAssignment.assigned_from, LoggerAssignment.assigned_to)
        .join(Fridge, Fridge.id == LoggerAssignment.fridge_id)
        .where(LoggerAssignment.logger_id == logger.id)
        .order_by(Fridge.name)
    ).all()
    assert assignments == [("Tel Aviv", "Display 2", None, None), ("Tel Aviv", "Walk-in", None, None)]

    readings = db_session.execute(
        select(Fridge.name, TemperatureReading.measured_at, TemperatureReading.temperature_c)
        .join(Fridge, Fridge.id == TemperatureReading.fridge_id)
        .where(TemperatureReading.logger_id == logger.id)
        .order_by(TemperatureReading.measured_at)
    ).all()
    assert readings == [
        ("Walk-in", datetime(2026, 9, 14, 5, 45), Decimal("4.00")),  # out-of-order row stored
        ("Walk-in", datetime(2026, 9, 14, 6, 0), Decimal("4.10")),
        ("Walk-in", datetime(2026, 9, 14, 6, 15), Decimal("9.40")),  # warm reading kept as is
        ("Walk-in", datetime(2026, 9, 14, 6, 30), Decimal("4.30")),
        ("Display 2", datetime(2026, 9, 17, 6, 0), Decimal("3.70")),
    ]


def test_tel_aviv_branch_spelling_is_normalized_and_all_assignments_undated(db_session, sample_path):
    seed_sample(db_session, sample_path)
    tel_aviv = db_session.scalars(select(Fridge).where(func.lower(Fridge.branch_name) == "tel aviv")).all()
    assert sorted((f.branch_name, f.name) for f in tel_aviv) == [("Tel Aviv", "Display 2"), ("Tel Aviv", "Walk-in")]
    assert count(db_session, LoggerAssignment, LoggerAssignment.assigned_from.is_not(None)) == 0
    assert count(db_session, LoggerAssignment, LoggerAssignment.assigned_to.is_not(None)) == 0


def test_second_seed_changes_nothing(db_session, sample_path):
    seed_sample(db_session, sample_path)
    before = all_counts(db_session)
    again = seed_sample(db_session, sample_path)
    assert again.inserted == 0
    assert (again.duplicates, len(again.conflicts), len(again.rejected)) == (16, 0, 0)
    assert (again.fridges_created, again.loggers_created, again.assignments_created) == (0, 0, 0)
    assert all_counts(db_session) == before == (5, 4, 5, 15)


def test_find_sample_file_errors(tmp_path):
    with pytest.raises(SeedError, match="no .xlsx"):
        find_sample_file(tmp_path)
    (tmp_path / "a.xlsx").write_bytes(b"")
    (tmp_path / "b.xlsx").write_bytes(b"")
    with pytest.raises(SeedError, match="exactly one"):
        find_sample_file(tmp_path)
