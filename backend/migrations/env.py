"""Alembic environment.

The database URL comes from, in order of precedence:
1. `config.attributes["url"]` - programmatic override (the test suite uses
   this to point migrations at the isolated test database),
2. `-x url=...` on the command line (`alembic -x url=... upgrade head`),
3. the `DATABASE_URL` environment variable.
"""

import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.models import Base

config = context.config

if config.config_file_name is not None and "url" not in config.attributes:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def get_url() -> str:
    url = config.attributes.get("url") or context.get_x_argument(as_dictionary=True).get("url")
    return url or os.environ["DATABASE_URL"]


def run_migrations_offline() -> None:
    context.configure(
        url=get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(get_url(), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
