"""SQLAlchemy 2.0 models for the four-table schema.

Tables: fridges, loggers, logger_assignments, temperature_readings. There is
deliberately no branches table - the branch is just `fridges.branch_name`.

All constraints are enforced by the database and mirrored here so the models
and the hand-written Alembic migration (`migrations/versions/0001_*`) agree.
Timestamps are naive `TIMESTAMP` (local time, no timezone).
"""

from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    MetaData,
    Numeric,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# Stable, predictable constraint/index names.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class Fridge(Base):
    __tablename__ = "fridges"

    id: Mapped[int] = mapped_column(primary_key=True)
    branch_name: Mapped[str] = mapped_column(Text)
    name: Mapped[str] = mapped_column(Text)


# A fridge is identified by branch + name, case-insensitively.
Index(
    "uq_fridges_branch_name_lower_name_lower",
    func.lower(Fridge.branch_name),
    func.lower(Fridge.name),
    unique=True,
)


class Logger(Base):
    __tablename__ = "loggers"
    __table_args__ = (CheckConstraint("unit IN ('C','F')", name="unit_valid"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(Text, unique=True)
    unit: Mapped[str] = mapped_column(Text)  # 'C' or 'F'


class LoggerAssignment(Base):
    """A logger <-> fridge pairing with optional bounds.

    NULL dates mean *unknown* (or open-ended for `assigned_to`); they are
    never inferred from readings.
    """

    __tablename__ = "logger_assignments"
    __table_args__ = (
        CheckConstraint(
            "assigned_from IS NULL OR assigned_to IS NULL OR assigned_to > assigned_from",
            name="range_valid",
        ),
        UniqueConstraint(
            "logger_id",
            "fridge_id",
            "assigned_from",
            name="uq_logger_assignments_logger_fridge_from",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    logger_id: Mapped[int] = mapped_column(ForeignKey("loggers.id"))
    fridge_id: Mapped[int] = mapped_column(ForeignKey("fridges.id"), index=True)
    assigned_from: Mapped[datetime | None] = mapped_column(DateTime)
    assigned_to: Mapped[datetime | None] = mapped_column(DateTime)


class TemperatureReading(Base):
    """One reading. `temperature_c IS NULL` means invalid (see `raw_value`)."""

    __tablename__ = "temperature_readings"
    __table_args__ = (
        UniqueConstraint(
            "logger_id", "measured_at", name="uq_temperature_readings_logger_measured_at"
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    logger_id: Mapped[int] = mapped_column(ForeignKey("loggers.id"))
    fridge_id: Mapped[int] = mapped_column(ForeignKey("fridges.id"), index=True)
    measured_at: Mapped[datetime] = mapped_column(DateTime)
    temperature_c: Mapped[Decimal | None] = mapped_column(Numeric)
    raw_timestamp: Mapped[str | None] = mapped_column(Text)
    raw_value: Mapped[str | None] = mapped_column(Text)
    source_file: Mapped[str | None] = mapped_column(Text)
    source_row: Mapped[int | None] = mapped_column()
