"""Database connectivity layer.

Minimal SQLAlchemy setup: a single engine built from the `DATABASE_URL`
environment variable (configured in `docker-compose.yml` from the
`POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB` values in `.env`), plus a
small helper to check connectivity, and `SessionLocal` for ORM sessions
(models live in `app/models.py`; the schema is created by Alembic).
"""

import os

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ["DATABASE_URL"]

# pool_pre_ping tests each connection before handing it out, so a stale
# connection (e.g. after the db container restarts) doesn't surface as a
# confusing error deeper in the request.
engine: Engine = create_engine(DATABASE_URL, pool_pre_ping=True)

SessionLocal = sessionmaker(bind=engine)


def check_connection() -> bool:
    """Run a trivial query to confirm the database is reachable.

    Returns True if the connection + query succeed, False on any error
    (connection refused, auth failure, DB not ready yet, etc.). Callers
    decide what to do with that — e.g. `/health` returns HTTP 503.
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
