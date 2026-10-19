"""Integration tests for the schema constraints (real PostgreSQL, isolated test DB).

Each test runs inside a rolled-back transaction (see `db_session`). A statement
expected to violate a constraint is wrapped in a savepoint (`begin_nested`) so
the session remains usable afterwards.
"""

from datetime import datetime
from decimal import Decimal

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import Fridge, Logger, LoggerAssignment, TemperatureReading

pytestmark = pytest.mark.integration

T0 = datetime(2026, 9, 14, 6, 0)


def add(session, obj):
    session.add(obj)
    session.flush()
    return obj


def rejected(session, obj):
    """Assert flushing `obj` violates a DB constraint; the session stays usable."""
    with pytest.raises(IntegrityError):
        with session.begin_nested():
            session.add(obj)
            session.flush()


@pytest.fixture
def fridge(db_session):
    return add(db_session, Fridge(branch_name="Tel Aviv", name="Walk-in"))


@pytest.fixture
def logger(db_session):
    return add(db_session, Logger(code="TL-0001", unit="C"))


def reading(logger, fridge, **kwargs):
    values = dict(
        logger_id=logger.id,
        fridge_id=fridge.id,
        measured_at=T0,
        temperature_c=Decimal("4.0"),
    )
    values.update(kwargs)
    return TemperatureReading(**values)


# --- readings ---------------------------------------------------------------


def test_duplicate_logger_and_measured_at_rejected(db_session, logger, fridge):
    add(db_session, reading(logger, fridge))
    rejected(db_session, reading(logger, fridge, temperature_c=Decimal("5.0")))
    # Same time on a different logger is fine; session still works after the error.
    other = add(db_session, Logger(code="TL-0002", unit="C"))
    add(db_session, reading(other, fridge))


def test_reading_without_fridge_rejected(db_session, logger, fridge):
    rejected(db_session, reading(logger, fridge, fridge_id=None))


def test_reading_with_nonexistent_logger_or_fridge_rejected(db_session, logger, fridge):
    rejected(db_session, reading(logger, fridge, logger_id=999_999))
    rejected(db_session, reading(logger, fridge, fridge_id=999_999))


def test_null_temperature_accepted_and_raw_err_preserved(db_session, logger, fridge):
    r = add(db_session, reading(logger, fridge, temperature_c=None, raw_value="ERR"))
    db_session.expire(r)
    assert r.temperature_c is None
    assert r.raw_value == "ERR"


@pytest.mark.parametrize("value", ["150", "-80", "9.4", "0.123456789"])
def test_extreme_and_unrounded_temperatures_accepted(db_session, logger, fridge, value):
    r = add(db_session, reading(logger, fridge, temperature_c=Decimal(value)))
    db_session.expire(r)
    assert r.temperature_c == Decimal(value)


# --- loggers ----------------------------------------------------------------


def test_duplicate_logger_code_rejected(db_session, logger):
    rejected(db_session, Logger(code=logger.code, unit="F"))


def test_invalid_unit_rejected(db_session):
    rejected(db_session, Logger(code="TL-BAD", unit="K"))


# --- fridges ----------------------------------------------------------------


def test_same_fridge_name_allowed_in_different_branches(db_session):
    add(db_session, Fridge(branch_name="Jerusalem", name="Dairy"))
    add(db_session, Fridge(branch_name="Haifa", name="Dairy"))
    assert len(db_session.scalars(select(Fridge).where(Fridge.name == "Dairy")).all()) == 2


def test_same_fridge_in_same_branch_rejected_case_insensitively(db_session):
    add(db_session, Fridge(branch_name="Jerusalem", name="Dairy"))
    rejected(db_session, Fridge(branch_name="Jerusalem", name="Dairy"))
    rejected(db_session, Fridge(branch_name="jerusalem", name="DAIRY"))


# --- assignments ------------------------------------------------------------


def test_assignment_end_must_be_after_start(db_session, logger, fridge):
    base = dict(logger_id=logger.id, fridge_id=fridge.id)
    rejected(db_session, LoggerAssignment(**base, assigned_from=T0, assigned_to=T0))
    rejected(
        db_session,
        LoggerAssignment(**base, assigned_from=T0, assigned_to=datetime(2026, 9, 13)),
    )
    add(db_session, LoggerAssignment(**base, assigned_from=T0, assigned_to=datetime(2026, 9, 15)))


def test_assignment_with_unknown_bounds_allowed(db_session, logger, fridge):
    add(db_session, LoggerAssignment(logger_id=logger.id, fridge_id=fridge.id, assigned_to=T0))


def test_duplicate_assignment_with_null_from_rejected(db_session, logger, fridge):
    add(db_session, LoggerAssignment(logger_id=logger.id, fridge_id=fridge.id))
    # NULLS NOT DISTINCT: two NULL assigned_from values collide.
    rejected(db_session, LoggerAssignment(logger_id=logger.id, fridge_id=fridge.id))


def test_same_pair_with_different_known_from_allowed(db_session, logger, fridge):
    add(db_session, LoggerAssignment(logger_id=logger.id, fridge_id=fridge.id))
    add(
        db_session,
        LoggerAssignment(logger_id=logger.id, fridge_id=fridge.id, assigned_from=T0),
    )
    add(
        db_session,
        LoggerAssignment(
            logger_id=logger.id, fridge_id=fridge.id, assigned_from=datetime(2026, 9, 20)
        ),
    )
    rejected(
        db_session,
        LoggerAssignment(logger_id=logger.id, fridge_id=fridge.id, assigned_from=T0),
    )


def test_logger_reassigned_to_other_fridge_with_unknown_dates(db_session):
    """TL-0417 style: two fridges, both assignments with NULL dates."""
    logger = add(db_session, Logger(code="TL-0417", unit="C"))
    walk_in = add(db_session, Fridge(branch_name="Tel Aviv", name="Walk-in"))
    display = add(db_session, Fridge(branch_name="Tel Aviv", name="Display 2"))

    add(db_session, LoggerAssignment(logger_id=logger.id, fridge_id=walk_in.id))
    add(db_session, LoggerAssignment(logger_id=logger.id, fridge_id=display.id))

    rows = db_session.scalars(
        select(LoggerAssignment).where(LoggerAssignment.logger_id == logger.id)
    ).all()
    assert len(rows) == 2
    assert all(a.assigned_from is None and a.assigned_to is None for a in rows)


def test_assignment_foreign_keys_enforced(db_session, logger, fridge):
    rejected(db_session, LoggerAssignment(logger_id=999_999, fridge_id=fridge.id))
    rejected(db_session, LoggerAssignment(logger_id=logger.id, fridge_id=999_999))
