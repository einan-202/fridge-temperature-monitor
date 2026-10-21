"""Ingestion service: XLSX files / parsed rows -> loggers, fridges, assignments, readings.

Rules (see docs/cursor/plan-phase-2.md):

- The service NEVER commits or rolls back; the caller owns the transaction.
- It never resolves a fridge itself. Every row names its logger and fridge
  explicitly: either in the file (combined `Logger | Branch | Fridge | Time |
  Temp` format) or passed by the caller for Time/Temp-only files.
- Raw values are preserved (`raw_timestamp`, `raw_value`, `source_file`,
  `source_row`). Rows are never silently dropped: bad rows are returned as
  rejected with their spreadsheet row number and a reason.
- Assignments are created undated (`assigned_from`/`assigned_to` NULL) only
  when a (logger, fridge) pair has no assignment yet. Dates are never invented.
- Dedup key is (logger, measured_at): the first occurrence wins; an identical
  repeat is a duplicate, a different value is a conflict that is reported.
"""

import os
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, time as dt_time
from decimal import Decimal
from typing import Any, Iterable, Mapping

import openpyxl
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.models import Fridge, Logger, LoggerAssignment, TemperatureReading
from app.normalize import name_key, normalize_name, parse_timestamp, to_celsius

INSERT_CHUNK = 1000

# Explicit header aliases. Matching uses canonical_header() (case, whitespace,
# punctuation). Unlisted names such as "Value" are never guessed.
TIME_ALIASES = ("Time", "Timestamp", "DateTime", "Date/Time", "Date Time", "Date")
TEMP_ALIASES: tuple[tuple[str, str | None], ...] = (
    ("Temp", None),
    ("Temperature", None),
    ("Temperature (°C)", "C"),
    ("Temp C", "C"),
    ("Temperature (°F)", "F"),
    ("Temp F", "F"),
)
LOGGER_ALIASES = ("Logger", "Logger ID", "Logger Code", "Device ID")

_HEADER_DEGREE = str.maketrans({"°": " ", "º": " ", "℃": " c", "℉": " f"})
_HEADER_NON_WORD = re.compile(r"[^\w\s]+", flags=re.UNICODE)
_EXCEL_TIME_IN_FORMAT = re.compile(r"(?<!\\)(?:h+|s+|am/pm|a/p)", re.IGNORECASE)


def canonical_header(value: Any) -> str:
    """Casefold, collapse whitespace, and treat punctuation as spaces."""
    if value is None:
        return ""
    text = normalize_name(value).casefold().translate(_HEADER_DEGREE).replace("_", " ")
    text = _HEADER_NON_WORD.sub(" ", text)
    return " ".join(text.split())


TIME_HEADERS = tuple(canonical_header(alias) for alias in TIME_ALIASES)
TEMP_HEADERS = tuple(canonical_header(alias) for alias, _unit in TEMP_ALIASES)


class IngestError(ValueError):
    """A file-level problem (the file cannot be ingested as given)."""


@dataclass
class ParsedRow:
    """One spreadsheet row, before any validation."""

    row_number: int
    logger_code: Any
    branch_name: Any
    fridge_name: Any
    raw_time: Any
    raw_temp: Any
    error: str | None = None  # reader-level problem: the row is rejected with this reason

    @property
    def is_blank(self) -> bool:
        return all(
            v is None or (isinstance(v, str) and not v.strip())
            for v in (
                self.logger_code,
                self.branch_name,
                self.fridge_name,
                self.raw_time,
                self.raw_temp,
            )
        )


@dataclass
class RejectedRow:
    row_number: int
    reason: str


@dataclass
class Conflict:
    """Same (logger, time) as an earlier reading but a different value (first wins)."""

    row_number: int
    logger_code: str
    measured_at: datetime
    kept: Decimal | None
    ignored: Decimal | None
    kept_source: str  # 'batch' (earlier row in this ingest) or 'database'
    kept_row_number: int | None = None  # spreadsheet row of the kept value if 'batch'


@dataclass
class IngestResult:
    """Outcome of one ingest. rows_read = inserted + duplicates + conflicts + len(rejected);
    blank rows are skipped and counted separately."""

    source_file: str | None = None
    rows_read: int = 0
    inserted: int = 0
    duplicates: int = 0
    conflicts: list[Conflict] = field(default_factory=list)
    rejected: list[RejectedRow] = field(default_factory=list)
    null_temperatures: int = 0  # inserted readings stored with NULL temperature_c
    blank_rows: int = 0
    loggers_created: int = 0
    fridges_created: int = 0
    assignments_created: int = 0


# --------------------------------------------------------------------------
# Shared core
# --------------------------------------------------------------------------


def raw_text(value: Any) -> str | None:
    """Original cell as text (ISO string for datetimes, None for an empty cell)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _is_blank(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def ingest_rows(
    session: Session,
    rows: Iterable[ParsedRow],
    source_file: str | None,
    logger_units: Mapping[str, str] | None = None,
    *,
    header_temp_unit: str | None = None,
    header_temp_label: str | None = None,
    source_units: Mapping[str, str] | None = None,
) -> IngestResult:
    """Validate rows, get-or-create entities and insert new readings.

    `logger_units` maps logger code -> 'C'/'F' for NEW loggers only (default
    'C'); an existing logger's unit is never changed. Does not commit.

    `source_units` maps logger code -> 'C'/'F' for THIS file's numbers. When
    set, conversion and header-unit checks use that map, not `logger.unit`.
    Weekly ingest omits it and keeps converting with the stored native unit.

    `header_temp_unit` is C/F when the temperature column name itself states a
    unit. It is never used to convert values; a mismatch with the conversion
    unit is a file-level error.
    """
    units = {name_key(k): v for k, v in (logger_units or {}).items()}
    for unit in units.values():
        if unit not in ("C", "F"):
            raise ValueError(f"logger unit must be 'C' or 'F', got {unit!r}")

    convert_map = None
    if source_units is not None:
        convert_map = {name_key(k): v for k, v in source_units.items()}
        for unit in convert_map.values():
            if unit not in ("C", "F"):
                raise ValueError(f"source unit must be 'C' or 'F', got {unit!r}")

    result = IngestResult(source_file=source_file)
    loggers: dict[str, Logger] = {}
    fridges: dict[tuple[str, str], Fridge] = {}
    pairs: set[tuple[int, int]] = set()
    candidates = []  # (row, logger, fridge, measured_at, temperature, row dict)

    for row in rows:
        if row.is_blank:
            result.blank_rows += 1
            continue
        result.rows_read += 1
        if row.error:
            result.rejected.append(RejectedRow(row.row_number, row.error))
            continue

        code = normalize_name(row.logger_code)
        branch = normalize_name(row.branch_name)
        fridge_name = normalize_name(row.fridge_name)
        missing = [
            label
            for label, value in (("logger", code), ("branch", branch), ("fridge", fridge_name))
            if not value
        ]
        if missing:
            result.rejected.append(
                RejectedRow(row.row_number, f"missing {', '.join(missing)}")
            )
            continue
        try:
            measured_at = parse_timestamp(row.raw_time)
        except ValueError as exc:
            result.rejected.append(RejectedRow(row.row_number, str(exc)))
            continue

        logger = _get_or_create_logger(session, loggers, code, units, result)
        if convert_map is None:
            convert_unit = logger.unit
        else:
            convert_unit = convert_map.get(name_key(logger.code))
            if convert_unit not in ("C", "F"):
                raise ValueError(
                    f"source unit must be 'C' or 'F' for logger {logger.code}"
                )
        if header_temp_unit and convert_unit != header_temp_unit:
            label = header_temp_label or "temperature"
            raise IngestError(
                f"temperature column {label!r} indicates {header_temp_unit}, "
                f"but logger {logger.code} is configured as {convert_unit}"
            )
        fridge = _get_or_create_fridge(session, fridges, branch, fridge_name, result)
        _ensure_assignment(session, pairs, logger, fridge, result)

        temperature = to_celsius(row.raw_temp, convert_unit)
        candidates.append(
            (
                row,
                logger,
                fridge,
                measured_at,
                temperature,
                {
                    "logger_id": logger.id,
                    "fridge_id": fridge.id,
                    "measured_at": measured_at,
                    "temperature_c": temperature,
                    "raw_timestamp": raw_text(row.raw_time),
                    "raw_value": raw_text(row.raw_temp),
                    "source_file": source_file,
                    "source_row": row.row_number,
                },
            )
        )

    _store_readings(session, candidates, result)
    return result


def _get_or_create_logger(session, cache, code, units, result) -> Logger:
    key = name_key(code)
    if key not in cache:
        logger = session.scalars(
            select(Logger).where(func.lower(Logger.code) == key).order_by(Logger.id)
        ).first()
        if logger is None:
            logger = Logger(code=code, unit=units.get(key, "C"))
            session.add(logger)
            session.flush()
            result.loggers_created += 1
        cache[key] = logger
    return cache[key]


def _get_or_create_fridge(session, cache, branch, name, result) -> Fridge:
    key = (name_key(branch), name_key(name))
    if key not in cache:
        fridge = session.scalars(
            select(Fridge)
            .where(func.lower(Fridge.branch_name) == key[0], func.lower(Fridge.name) == key[1])
            .order_by(Fridge.id)
        ).first()
        if fridge is None:
            # A branch keeps its first-seen spelling across all its fridges
            # ('tel aviv' joins the existing 'Tel Aviv').
            known_branch = session.scalars(
                select(Fridge.branch_name)
                .where(func.lower(Fridge.branch_name) == key[0])
                .order_by(Fridge.id)
            ).first()
            fridge = Fridge(branch_name=known_branch or branch, name=name)
            session.add(fridge)
            session.flush()
            result.fridges_created += 1
        cache[key] = fridge
    return cache[key]


def _ensure_assignment(session, seen, logger, fridge, result) -> None:
    """Create an undated assignment if the pair has none (of any kind)."""
    pair = (logger.id, fridge.id)
    if pair in seen:
        return
    seen.add(pair)
    exists = session.scalar(
        select(LoggerAssignment.id)
        .where(LoggerAssignment.logger_id == logger.id, LoggerAssignment.fridge_id == fridge.id)
        .limit(1)
    )
    if exists is None:
        session.add(
            LoggerAssignment(
                logger_id=logger.id, fridge_id=fridge.id, assigned_from=None, assigned_to=None
            )
        )
        session.flush()
        result.assignments_created += 1


def _store_readings(session, candidates, result) -> None:
    """Classify candidates (new / duplicate / conflict) and insert the new ones."""
    existing: dict[tuple[int, datetime], Decimal | None] = {}
    by_logger: dict[int, list[datetime]] = {}
    for _, logger, _, measured_at, _, _ in candidates:
        by_logger.setdefault(logger.id, []).append(measured_at)
    for logger_id, times in by_logger.items():
        found = session.execute(
            select(TemperatureReading.measured_at, TemperatureReading.temperature_c).where(
                TemperatureReading.logger_id == logger_id,
                TemperatureReading.measured_at >= min(times),
                TemperatureReading.measured_at <= max(times),
            )
        )
        for measured_at, temperature in found:
            existing[(logger_id, measured_at)] = temperature

    # key -> (kept value, source, spreadsheet row of the kept value)
    seen: dict[tuple[int, datetime], tuple[Decimal | None, str, int | None]] = {}
    new_values = []
    for row, logger, _, measured_at, temperature, values in candidates:
        key = (logger.id, measured_at)
        if key not in seen and key in existing:
            seen[key] = (existing[key], "database", None)
        if key in seen:
            kept, source, kept_row = seen[key]
            if kept == temperature:
                result.duplicates += 1
            else:
                result.conflicts.append(
                    Conflict(row.row_number, logger.code, measured_at, kept, temperature, source, kept_row)
                )
            continue
        seen[key] = (temperature, "batch", row.row_number)
        new_values.append(values)

    for start in range(0, len(new_values), INSERT_CHUNK):
        chunk = new_values[start : start + INSERT_CHUNK]
        stmt = (
            pg_insert(TemperatureReading)
            .values(chunk)
            .on_conflict_do_nothing(index_elements=["logger_id", "measured_at"])
            .returning(TemperatureReading.temperature_c)
        )
        inserted = session.execute(stmt).all()
        result.inserted += len(inserted)
        result.null_temperatures += sum(1 for (t,) in inserted if t is None)
        # Rows skipped by ON CONFLICT (e.g. a concurrent writer) count as duplicates.
        result.duplicates += len(chunk) - len(inserted)


# --------------------------------------------------------------------------
# XLSX readers
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class SheetLayout:
    """Resolved first-sheet columns. Duplicate role matches are never collapsed."""

    time_col: int
    temp_col: int
    logger_col: int | None
    branch_col: int | None
    fridge_col: int | None
    temp_unit: str | None
    temp_header: str


def _header_role_map() -> dict[str, tuple[str, str | None]]:
    mapping: dict[str, tuple[str, str | None]] = {}
    for alias in TIME_ALIASES:
        mapping[canonical_header(alias)] = ("time", None)
    for alias, unit in TEMP_ALIASES:
        mapping[canonical_header(alias)] = ("temp", unit)
    for alias in LOGGER_ALIASES:
        mapping[canonical_header(alias)] = ("logger", None)
    mapping[canonical_header("Branch")] = ("branch", None)
    mapping[canonical_header("Fridge")] = ("fridge", None)
    return mapping


def resolve_sheet_layout(header_row: Iterable[Any]) -> SheetLayout:
    """Map header cells to roles. Ambiguous or missing Time/Temp is a file error."""
    roles = _header_role_map()
    found: dict[str, list[tuple[int, str, str | None]]] = {}
    for index, cell in enumerate(header_row):
        original = normalize_name(cell)
        key = canonical_header(cell)
        if not key:
            continue
        mapped = roles.get(key)
        if mapped is None:
            continue
        role, unit = mapped
        found.setdefault(role, []).append((index, original or str(cell), unit))

    ambiguous = [role for role, cols in found.items() if len(cols) > 1]
    if ambiguous:
        parts = [
            f"{role} ({', '.join(label for _i, label, _u in found[role])})"
            for role in sorted(ambiguous)
        ]
        raise IngestError(f"ambiguous column(s): {', '.join(parts)}")

    missing = []
    if "time" not in found:
        missing.append("Time (or Timestamp)")
    if "temp" not in found:
        missing.append("Temp (or Temperature)")
    if missing:
        raise IngestError(f"missing required column(s): {', '.join(missing)}")

    time_col = found["time"][0][0]
    temp_col, temp_header, temp_unit = found["temp"][0]
    logger_col = found["logger"][0][0] if "logger" in found else None
    branch_col = found["branch"][0][0] if "branch" in found else None
    fridge_col = found["fridge"][0][0] if "fridge" in found else None
    return SheetLayout(
        time_col=time_col,
        temp_col=temp_col,
        logger_col=logger_col,
        branch_col=branch_col,
        fridge_col=fridge_col,
        temp_unit=temp_unit,
        temp_header=temp_header,
    )


def _excel_format_includes_time(number_format: str | None) -> bool:
    """True when the Excel number format encodes a clock time, not only a date."""
    fmt = (number_format or "").strip()
    if not fmt or fmt.lower() in ("general", "standard"):
        return True
    stripped = re.sub(r'"[^"]*"', "", fmt)
    return _EXCEL_TIME_IN_FORMAT.search(stripped) is not None


def _excel_cell_value(cell: Any) -> Any:
    """Return a cell value, mapping date-only formatted midnights to datetime.date."""
    value = cell.value
    if (
        isinstance(value, datetime)
        and value.time() == dt_time.min
        and not _excel_format_includes_time(cell.number_format)
    ):
        return value.date()
    return value


def _open_xlsx_data(path: str) -> list[tuple]:
    try:
        workbook = openpyxl.load_workbook(path, data_only=True)
    except (OSError, zipfile.BadZipFile, InvalidFileException, KeyError) as exc:
        raise IngestError(f"cannot read {os.path.basename(path)} as an XLSX file: {exc}") from None
    try:
        sheet = workbook.worksheets[0]
        data = [tuple(_excel_cell_value(cell) for cell in row) for row in sheet.iter_rows()]
    finally:
        workbook.close()
    if not data:
        raise IngestError("file is empty: no header row")
    return data


def _cell(values, col):
    return values[col] if col is not None and col < len(values) else None


def _rows_from_layout(
    data: list[tuple],
    layout: SheetLayout,
    logger: Logger | str | None,
    fridge: Fridge | int | None,
    session: Session | None,
) -> list[ParsedRow]:
    rows: list[ParsedRow] = []
    if logger is not None or fridge is not None:
        if logger is None or fridge is None:
            raise IngestError("pass both logger and fridge explicitly (or neither for combined files)")
        code, branch, name = _explicit_identity(logger, fridge, session)
        for number, values in enumerate(data[1:], start=2):
            raw_time, raw_temp = _cell(values, layout.time_col), _cell(values, layout.temp_col)
            in_file_logger = _cell(values, layout.logger_col)
            if _is_blank(raw_time) and _is_blank(raw_temp) and _is_blank(in_file_logger):
                rows.append(ParsedRow(number, None, None, None, None, None))
            elif not _is_blank(in_file_logger) and name_key(in_file_logger) != name_key(code):
                reason = (
                    f"row names logger {normalize_name(in_file_logger)!r}, "
                    f"but this file was given for logger {code!r}"
                )
                rows.append(ParsedRow(number, in_file_logger, None, None, raw_time, raw_temp, reason))
            else:
                rows.append(ParsedRow(number, code, branch, name, raw_time, raw_temp))
        return rows

    absent = [
        label
        for label, col in (
            ("Logger", layout.logger_col),
            ("Branch", layout.branch_col),
            ("Fridge", layout.fridge_col),
        )
        if col is None
    ]
    if absent:
        raise IngestError(
            f"file has no {', '.join(absent)} column(s): pass the logger and fridge explicitly"
        )
    for number, values in enumerate(data[1:], start=2):
        rows.append(
            ParsedRow(
                number,
                _cell(values, layout.logger_col),
                _cell(values, layout.branch_col),
                _cell(values, layout.fridge_col),
                _cell(values, layout.time_col),
                _cell(values, layout.temp_col),
            )
        )
    return rows


def read_xlsx_sheet(
    path: str | os.PathLike,
    logger: Logger | str | None = None,
    fridge: Fridge | int | None = None,
    session: Session | None = None,
) -> tuple[list[ParsedRow], SheetLayout]:
    """Read the first sheet and the resolved header layout."""
    data = _open_xlsx_data(os.fspath(path))
    layout = resolve_sheet_layout(data[0])
    return _rows_from_layout(data, layout, logger, fridge, session), layout


def read_xlsx_rows(
    path: str | os.PathLike,
    logger: Logger | str | None = None,
    fridge: Fridge | int | None = None,
    session: Session | None = None,
) -> list[ParsedRow]:
    """Read the first sheet into ParsedRows (header is row 1, data starts at row 2).

    Combined format: columns Logger | Branch | Fridge | Time | Temp.
    Time/Temp-only format: pass BOTH `logger` (a Logger or its code) and
    `fridge` (a Fridge, or its id together with `session`); nothing is guessed.
    """
    rows, _layout = read_xlsx_sheet(path, logger=logger, fridge=fridge, session=session)
    return rows


def _explicit_identity(logger, fridge, session) -> tuple[str, str, str]:
    code = logger.code if isinstance(logger, Logger) else str(logger)
    if not normalize_name(code):
        raise IngestError("logger code is empty")
    if isinstance(fridge, Fridge):
        return code, fridge.branch_name, fridge.name
    if isinstance(fridge, int) and not isinstance(fridge, bool):
        if session is None:
            raise IngestError("a session is required to look up a fridge by id")
        found = session.get(Fridge, fridge)
        if found is None:
            raise IngestError(f"fridge id {fridge} does not exist")
        return code, found.branch_name, found.name
    raise IngestError("fridge must be a Fridge object or an existing fridge id")


def ingest_xlsx(
    session: Session,
    path: str | os.PathLike,
    logger: Logger | str | None = None,
    fridge: Fridge | int | None = None,
    logger_units: Mapping[str, str] | None = None,
    source_units: Mapping[str, str] | None = None,
) -> IngestResult:
    """Read an XLSX file and ingest it. Does not commit."""
    rows, layout = read_xlsx_sheet(path, logger=logger, fridge=fridge, session=session)
    return ingest_rows(
        session,
        rows,
        source_file=os.path.basename(os.fspath(path)),
        logger_units=logger_units,
        header_temp_unit=layout.temp_unit,
        header_temp_label=layout.temp_header,
        source_units=source_units,
    )
