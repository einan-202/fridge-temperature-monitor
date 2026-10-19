"""Integration tests for the Alembic migration (real PostgreSQL).

The up/down/up round trip runs on a throwaway database so the shared test
database stays at head for the other tests.
"""

import pytest
from sqlalchemy import create_engine, inspect

from tests.db_helpers import run_alembic

pytestmark = pytest.mark.integration

APP_TABLES = {"fridges", "loggers", "logger_assignments", "temperature_readings"}


def table_names(url) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_upgrade_creates_exactly_the_four_tables(scratch_db_url):
    run_alembic(scratch_db_url, "upgrade", "head")

    tables = table_names(scratch_db_url)
    assert tables == APP_TABLES | {"alembic_version"}
    assert "branches" not in tables


def test_downgrade_removes_tables_and_upgrade_works_again(scratch_db_url):
    run_alembic(scratch_db_url, "upgrade", "head")

    run_alembic(scratch_db_url, "downgrade", "base")
    assert table_names(scratch_db_url) & APP_TABLES == set()

    run_alembic(scratch_db_url, "upgrade", "head")
    assert table_names(scratch_db_url) == APP_TABLES | {"alembic_version"}


def test_shared_test_database_is_migrated_to_head(db_engine):
    assert set(inspect(db_engine).get_table_names()) == APP_TABLES | {"alembic_version"}


def test_expected_constraints_and_indexes_exist(db_engine):
    insp = inspect(db_engine)

    assert {u["name"] for u in insp.get_unique_constraints("loggers")} == {"uq_loggers_code"}
    assert {c["name"] for c in insp.get_check_constraints("loggers")} == {"ck_loggers_unit_valid"}
    assert {c["name"] for c in insp.get_check_constraints("logger_assignments")} == {
        "ck_logger_assignments_range_valid"
    }
    assert {u["name"] for u in insp.get_unique_constraints("logger_assignments")} == {
        "uq_logger_assignments_logger_fridge_from"
    }
    assert {u["name"] for u in insp.get_unique_constraints("temperature_readings")} == {
        "uq_temperature_readings_logger_measured_at"
    }

    fridge_indexes = {i["name"]: i for i in insp.get_indexes("fridges")}
    assert fridge_indexes["uq_fridges_branch_name_lower_name_lower"]["unique"]
    assert "ix_logger_assignments_fridge_id" in {
        i["name"] for i in insp.get_indexes("logger_assignments")
    }
    assert "ix_temperature_readings_fridge_id" in {
        i["name"] for i in insp.get_indexes("temperature_readings")
    }

    columns = {c["name"]: c for c in insp.get_columns("temperature_readings")}
    assert columns["fridge_id"]["nullable"] is False
    assert columns["temperature_c"]["nullable"] is True
    assert "status" not in columns
