"""Shared pytest fixtures.

Unit tests need no database. Integration tests that need one request the
fixtures below, which are created lazily (nothing here is autouse):

- `test_db_url` / `db_engine` (session scope): a separate `<POSTGRES_DB>_test`
  database, dropped and recreated fresh, then migrated with the real Alembic
  migrations (`alembic upgrade head`). The dev database is never touched.
- `db_session` (per test): a Session inside an outer connection-level
  transaction that is rolled back after the test. Code under test (or the
  test itself) may use `session.begin_nested()` to recover from
  IntegrityError via savepoints.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.main import app
from tests.db_helpers import (
    database_url,
    drop_database,
    recreate_database,
    run_alembic,
)


@pytest.fixture
def client() -> TestClient:
    """A FastAPI TestClient wrapping the app, for request-level tests."""
    return TestClient(app)


@pytest.fixture(scope="session")
def test_db_url():
    url = database_url("test")
    recreate_database(url)
    run_alembic(url, "upgrade", "head")
    yield url


@pytest.fixture(scope="session")
def db_engine(test_db_url):
    engine = create_engine(test_db_url)
    yield engine
    engine.dispose()


@pytest.fixture
def db_session(db_engine):
    connection = db_engine.connect()
    outer = connection.begin()
    session = Session(bind=connection, join_transaction_mode="create_savepoint")
    try:
        yield session
    finally:
        session.close()
        outer.rollback()
        connection.close()


@pytest.fixture
def scratch_db_url():
    """A throwaway, empty database (`<POSTGRES_DB>_test_scratch`) for tests
    that migrate up/down themselves, so the shared test DB stays at head."""
    url = database_url("test_scratch")
    recreate_database(url)
    yield url
    drop_database(url)
