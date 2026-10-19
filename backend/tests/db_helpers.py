"""Helpers for the isolated test database(s).

Test databases are named `<POSTGRES_DB>_test...` (derived from DATABASE_URL)
and are created via the server's maintenance database `postgres`. The dev
database is never used by tests that rely on these helpers.
"""

import os

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL, make_url

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def dev_url() -> URL:
    return make_url(os.environ["DATABASE_URL"])


def database_url(suffix: str) -> URL:
    """URL for `<dev database name>_<suffix>` - never the dev database itself."""
    dev = dev_url()
    url = dev.set(database=f"{dev.database}_{suffix}")
    assert url.database != dev.database
    return url


def recreate_database(url: URL) -> None:
    """Drop (if present) and create the database named by `url`, fresh."""
    assert url.database.endswith(("_test", "_test_scratch")), "refusing to touch non-test DB"
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
            conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    finally:
        admin.dispose()


def drop_database(url: URL) -> None:
    assert url.database.endswith(("_test", "_test_scratch")), "refusing to touch non-test DB"
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    try:
        with admin.connect() as conn:
            conn.execute(text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)'))
    finally:
        admin.dispose()


def run_alembic(url: URL, action: str, revision: str) -> None:
    """Run `alembic <action> <revision>` against `url` (via the env.py override)."""
    cfg = Config(os.path.join(BACKEND_DIR, "alembic.ini"))
    cfg.attributes["url"] = url.render_as_string(hide_password=False)
    getattr(command, action)(cfg, revision)
