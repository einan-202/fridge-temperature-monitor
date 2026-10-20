"""Historical import and weekly bulk upload (Phase 3.2).

Wraps Phase 2 `ingest_rows` / `read_xlsx_rows` with:
- dry-run review (caller rolls back) vs committing import
- predefined / override / required units for historical mode
- filename logger detection, per-reading fridge resolution, moves,
  new-logger registration, optional-column validation, and fridge-conflict
  pre-checks for weekly mode

No schema changes. Phase 2 ingestion is not modified.
"""

from __future__ import annotations

import json
import os
import re
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any, Mapping, Sequence

import openpyxl
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.ingest import (
    TEMP_HEADERS,
    TIME_HEADERS,
    Conflict,
    IngestError,
    IngestResult,
    ParsedRow,
    RejectedRow,
    ingest_rows,
    read_xlsx_rows,
)
from app.models import Fridge, Logger, LoggerAssignment, TemperatureReading
from app.normalize import name_key, normalize_name, parse_timestamp

# Predefined units with evidence (see plan). Never inferred from values.
HISTORICAL_LOGGER_UNITS: dict[str, str] = {"TL-0231": "F"}
HISTORICAL_DEFAULT_UNIT = "C"
HAIFA_BRANCH_KEY = "haifa"

MAX_FILES = 100
MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB

# Whole-token match: code bounded by non-alphanumeric (or string edges).
_TOKEN_RE_TEMPLATE = r"(?<![A-Za-z0-9]){code}(?![A-Za-z0-9])"
# Recognised weekly logger-code shape: TL- plus digits (e.g. TL-0777).
_LOGGER_CODE_RE = re.compile(
    r"(?<![A-Za-z0-9])(TL-\d+)(?![A-Za-z0-9])", re.IGNORECASE
)


class UploadError(ValueError):
    """Request-level problem (bad mode, limits, missing required units, …)."""


@dataclass
class FridgeConflict:
    """Same (logger, time) under a different fridge; first wins."""

    row_number: int
    logger_code: str
    measured_at: datetime
    kept_branch: str
    kept_fridge: str
    ignored_branch: str
    ignored_fridge: str
    kept_source: str  # 'batch' | 'database'
    kept_row_number: int | None = None


@dataclass
class MappingMismatch:
    row_number: int
    field: str  # 'Logger' | 'Branch' | 'Fridge'
    found: str
    expected: str
    message: str


@dataclass
class LoggerUnitInfo:
    code: str
    unit: str | None
    source: str  # known | default | override | unresolved
    is_new: bool
    branch: str | None = None


@dataclass
class AssignmentInfo:
    logger_id: int
    fridge_id: int
    assigned_from: datetime | None
    assigned_to: datetime | None
    branch_name: str
    fridge_name: str


@dataclass
class StagedNewFridge:
    branch: str
    name: str


@dataclass
class StagedNewLogger:
    code: str
    unit: str
    fridge_id: int | str  # existing id, or "new:<index>" into staged new_fridges


@dataclass
class StagedMove:
    logger_id: int
    fridge_id: int | str  # existing id, or "new:<index>" into staged new_fridges
    effective_at: datetime


@dataclass
class FileUpload:
    """One uploaded spreadsheet, already on disk."""

    index: int
    filename: str
    path: str
    size: int


@dataclass
class FileResult:
    status: str  # ready | imported | needs_attention | invalid | failed
    file_index: int
    filename: str
    logger_id: int | None = None
    logger_code: str | None = None
    logger_source: str | None = None  # filename | selection | new
    fridges: list[dict] = field(default_factory=list)
    inserted: int = 0
    duplicates: int = 0
    conflicts: list[dict] = field(default_factory=list)
    fridge_conflicts: list[dict] = field(default_factory=list)
    mapping_mismatches: list[dict] = field(default_factory=list)
    rejected: list[dict] = field(default_factory=list)
    rejected_total: int = 0
    invalid_values: int = 0
    unit_converted: bool = False
    loggers_created: int = 0
    fridges_created: int = 0
    assignments_created: int = 0
    message: str | None = None
    logger_column: list[dict] = field(default_factory=list)
    suggested_logger_code: str | None = None


@dataclass
class UploadOutcome:
    mode: str
    dry_run: bool
    files: list[FileResult] = field(default_factory=list)
    logger_units: list[LoggerUnitInfo] = field(default_factory=list)
    moves_applied: list[dict] = field(default_factory=list)
    moves_rejected: list[dict] = field(default_factory=list)
    new_loggers_created: list[dict] = field(default_factory=list)
    new_loggers_rejected: list[dict] = field(default_factory=list)
    new_fridges_created: list[dict] = field(default_factory=list)
    new_fridges_rejected: list[dict] = field(default_factory=list)
    historical: dict | None = None
    message: str | None = None
    blocked: bool = False  # import refused entirely (e.g. unresolved Haifa units)


# --------------------------------------------------------------------------
# Filename logger detection
# --------------------------------------------------------------------------


def extract_logger_code_from_filename(filename: str) -> str | None:
    """Return the single recognised logger code in the file stem, or None.

    A recognised code is a whole token `TL-` plus digits (case-insensitive).
    Zero or several distinct codes mean the name is unidentified — never use
    the whole filename, a leading index like `07`, or `TL` alone.
    """
    stem = Path(filename).stem
    seen: dict[str, str] = {}
    for raw in _LOGGER_CODE_RE.findall(stem):
        digits = raw.split("-", 1)[1]
        normalised = f"TL-{digits}"
        seen.setdefault(normalised.casefold(), normalised)
    if len(seen) == 1:
        return next(iter(seen.values()))
    return None


def detect_logger_code(filename: str, known_codes: Sequence[str]) -> str | None:
    """Return the single known logger code that matches as a whole token, or None.

    Matching is case-insensitive on the file stem. Zero or multiple matches
    mean the file is unidentified (never guessed from contents or the DB).

    Recognised `TL-`+digits tokens are preferred so a name like
    `04_logger_in_column_generic_filename.xlsx` is never assigned to an
    unrelated known logger.
    """
    extracted = extract_logger_code_from_filename(filename)
    known_by_key = {name_key(code): code for code in known_codes}
    if extracted is not None:
        return known_by_key.get(name_key(extracted))

    # Recognised TL- codes are handled above. Remaining known codes (if any)
    # still match as whole tokens; they must not steal generic filenames.
    stem = Path(filename).stem
    matches: list[str] = []
    for code in known_codes:
        if re.fullmatch(r"TL-\d+", code, flags=re.IGNORECASE):
            continue
        pattern = re.compile(
            _TOKEN_RE_TEMPLATE.format(code=re.escape(code)), re.IGNORECASE
        )
        if pattern.search(stem):
            matches.append(code)
    if len(matches) == 1:
        return matches[0]
    return None


# --------------------------------------------------------------------------
# Fridge resolution per reading timestamp
# --------------------------------------------------------------------------


def resolve_fridge_at(
    assignments: Sequence[AssignmentInfo], measured_at: datetime
) -> AssignmentInfo | None:
    """Resolve which assignment covers `measured_at`, or None if unresolved.

    Rules (plan):
    1. Among dated assignments with assigned_from <= t still open at t,
       the latest assigned_from wins. Same latest start with different
       fridges is ambiguous (unresolved).
    2. Otherwise, exactly one undated assignment is the last-known mapping.
    3. None or several undated assignments → unresolved. A dated move is
       never applied backwards.
    """
    dated_open = [
        a
        for a in assignments
        if a.assigned_from is not None
        and a.assigned_from <= measured_at
        and (a.assigned_to is None or a.assigned_to > measured_at)
    ]
    if dated_open:
        best_from = max(a.assigned_from for a in dated_open)  # type: ignore[type-var]
        winners = [a for a in dated_open if a.assigned_from == best_from]
        if len(winners) == 1:
            return winners[0]
        return None

    undated = [a for a in assignments if a.assigned_from is None]
    if len(undated) == 1:
        return undated[0]
    return None


def load_assignments(session: Session, logger_id: int) -> list[AssignmentInfo]:
    rows = session.execute(
        select(
            LoggerAssignment.logger_id,
            LoggerAssignment.fridge_id,
            LoggerAssignment.assigned_from,
            LoggerAssignment.assigned_to,
            Fridge.branch_name,
            Fridge.name,
        )
        .join(Fridge, Fridge.id == LoggerAssignment.fridge_id)
        .where(LoggerAssignment.logger_id == logger_id)
    ).all()
    return [
        AssignmentInfo(
            logger_id=r.logger_id,
            fridge_id=r.fridge_id,
            assigned_from=r.assigned_from,
            assigned_to=r.assigned_to,
            branch_name=r.branch_name,
            fridge_name=r.name,
        )
        for r in rows
    ]


# --------------------------------------------------------------------------
# Historical units
# --------------------------------------------------------------------------


def _logger_branches_from_rows(rows: Sequence[ParsedRow]) -> dict[str, set[str]]:
    """Map normalized logger code -> set of branch name_keys seen on non-blank rows."""
    branches: dict[str, set[str]] = {}
    for row in rows:
        if row.is_blank or row.error:
            continue
        code = normalize_name(row.logger_code)
        branch = normalize_name(row.branch_name)
        if not code:
            continue
        branches.setdefault(name_key(code), set())
        if branch:
            branches[name_key(code)].add(name_key(branch))
    return branches


def _display_code_for_key(rows: Sequence[ParsedRow], key: str) -> str:
    for row in rows:
        if row.is_blank:
            continue
        code = normalize_name(row.logger_code)
        if code and name_key(code) == key:
            return code
    return key


def resolve_historical_logger_units(
    session: Session,
    rows: Sequence[ParsedRow],
    overrides: Mapping[str, str] | None = None,
) -> list[LoggerUnitInfo]:
    """Decide the unit for every logger code appearing in a historical file."""
    overrides_by_key = {name_key(k): v for k, v in (overrides or {}).items()}
    for unit in overrides_by_key.values():
        if unit not in ("C", "F"):
            raise UploadError(f"logger unit must be 'C' or 'F', got {unit!r}")

    branches = _logger_branches_from_rows(rows)
    infos: list[LoggerUnitInfo] = []

    for key in sorted(branches.keys()):
        code = _display_code_for_key(rows, key)
        branch_keys = branches[key]
        primary_branch = next(
            (
                normalize_name(r.branch_name)
                for r in rows
                if not r.is_blank
                and name_key(r.logger_code) == key
                and normalize_name(r.branch_name)
            ),
            None,
        )

        existing = session.scalars(
            select(Logger).where(func.lower(Logger.code) == key).order_by(Logger.id)
        ).first()
        if existing is not None:
            infos.append(
                LoggerUnitInfo(
                    code=existing.code,
                    unit=existing.unit,
                    source="known",
                    is_new=False,
                    branch=primary_branch,
                )
            )
            continue

        if key in overrides_by_key:
            infos.append(
                LoggerUnitInfo(
                    code=code,
                    unit=overrides_by_key[key],
                    source="override",
                    is_new=True,
                    branch=primary_branch,
                )
            )
            continue

        predefined = None
        for known_code, unit in HISTORICAL_LOGGER_UNITS.items():
            if name_key(known_code) == key:
                predefined = unit
                break
        if predefined is not None:
            infos.append(
                LoggerUnitInfo(
                    code=code,
                    unit=predefined,
                    source="known",
                    is_new=True,
                    branch=primary_branch,
                )
            )
            continue

        is_haifa = HAIFA_BRANCH_KEY in branch_keys
        if is_haifa:
            infos.append(
                LoggerUnitInfo(
                    code=code,
                    unit=None,
                    source="unresolved",
                    is_new=True,
                    branch=primary_branch,
                )
            )
        else:
            infos.append(
                LoggerUnitInfo(
                    code=code,
                    unit=HISTORICAL_DEFAULT_UNIT,
                    source="default",
                    is_new=True,
                    branch=primary_branch,
                )
            )

    return infos


def historical_units_mapping(infos: Sequence[LoggerUnitInfo]) -> dict[str, str]:
    """Mapping suitable for ingest_rows; only entries with a chosen unit."""
    return {info.code: info.unit for info in infos if info.unit in ("C", "F")}


def unresolved_haifa_loggers(infos: Sequence[LoggerUnitInfo]) -> list[LoggerUnitInfo]:
    return [i for i in infos if i.source == "unresolved" and i.is_new]


# --------------------------------------------------------------------------
# Fridge-conflict pre-check (Phase 2 is silent on fridge-only differences)
# --------------------------------------------------------------------------


def _fridge_identity(branch: str, name: str) -> tuple[str, str]:
    return name_key(branch), name_key(name)


def filter_fridge_conflicts(
    session: Session,
    rows: Sequence[ParsedRow],
    *,
    batch_fridge_index: dict[tuple[str, datetime], tuple[str, str, str, int]] | None = None,
) -> tuple[list[ParsedRow], list[FridgeConflict]]:
    """Remove rows that collide on (logger, time) under a different fridge.

    `batch_fridge_index` maps (logger_key, measured_at) ->
    (branch, fridge_name, kept_source, kept_row_number) for readings already
    accepted earlier in this batch (other files). Updated in place for rows
    that pass.
    """
    if batch_fridge_index is None:
        batch_fridge_index = {}

    # Preload existing readings for loggers that already exist.
    logger_ids: dict[str, int] = {}
    codes_needed: set[str] = set()
    parsed_times: list[tuple[ParsedRow, str, datetime, str, str]] = []
    conflicts: list[FridgeConflict] = []

    for row in rows:
        if row.is_blank or row.error:
            continue
        code = normalize_name(row.logger_code)
        branch = normalize_name(row.branch_name)
        fridge_name = normalize_name(row.fridge_name)
        if not code or not branch or not fridge_name:
            continue
        try:
            measured_at = parse_timestamp(row.raw_time)
        except ValueError:
            continue
        codes_needed.add(name_key(code))
        parsed_times.append((row, code, measured_at, branch, fridge_name))

    if codes_needed:
        found = session.execute(
            select(Logger.id, Logger.code).where(
                func.lower(Logger.code).in_(list(codes_needed))
            )
        ).all()
        for lid, code in found:
            logger_ids[name_key(code)] = lid

    existing_fridge: dict[tuple[int, datetime], tuple[str, str]] = {}
    if logger_ids and parsed_times:
        by_logger: dict[int, list[datetime]] = {}
        for _, code, measured_at, _, _ in parsed_times:
            lid = logger_ids.get(name_key(code))
            if lid is not None:
                by_logger.setdefault(lid, []).append(measured_at)
        for lid, times in by_logger.items():
            rows_db = session.execute(
                select(
                    TemperatureReading.measured_at,
                    Fridge.branch_name,
                    Fridge.name,
                )
                .join(Fridge, Fridge.id == TemperatureReading.fridge_id)
                .where(
                    TemperatureReading.logger_id == lid,
                    TemperatureReading.measured_at >= min(times),
                    TemperatureReading.measured_at <= max(times),
                )
            ).all()
            for measured_at, br, nm in rows_db:
                existing_fridge[(lid, measured_at)] = (br, nm)

    conflict_numbers: set[int] = set()
    for row, code, measured_at, branch, fridge_name in parsed_times:
        key_batch = (name_key(code), measured_at)
        identity = _fridge_identity(branch, fridge_name)

        if key_batch in batch_fridge_index:
            kept_br, kept_nm, source, kept_row = batch_fridge_index[key_batch]
            if _fridge_identity(kept_br, kept_nm) != identity:
                conflicts.append(
                    FridgeConflict(
                        row_number=row.row_number,
                        logger_code=code,
                        measured_at=measured_at,
                        kept_branch=kept_br,
                        kept_fridge=kept_nm,
                        ignored_branch=branch,
                        ignored_fridge=fridge_name,
                        kept_source=source,
                        kept_row_number=kept_row,
                    )
                )
                conflict_numbers.add(row.row_number)
            # Same fridge: let Phase 2 handle duplicate/conflict on value.
            continue

        lid = logger_ids.get(name_key(code))
        if lid is not None and (lid, measured_at) in existing_fridge:
            kept_br, kept_nm = existing_fridge[(lid, measured_at)]
            if _fridge_identity(kept_br, kept_nm) != identity:
                conflicts.append(
                    FridgeConflict(
                        row_number=row.row_number,
                        logger_code=code,
                        measured_at=measured_at,
                        kept_branch=kept_br,
                        kept_fridge=kept_nm,
                        ignored_branch=branch,
                        ignored_fridge=fridge_name,
                        kept_source="database",
                    )
                )
                conflict_numbers.add(row.row_number)
                continue

        batch_fridge_index[key_batch] = (branch, fridge_name, "batch", row.row_number)

    ordered = [r for r in rows if r.row_number not in conflict_numbers]
    return ordered, conflicts


# --------------------------------------------------------------------------
# Weekly sheet reading (optional Logger/Branch/Fridge columns)
# --------------------------------------------------------------------------


@dataclass
class WeeklySheetRow:
    row_number: int
    raw_time: Any
    raw_temp: Any
    logger_col: Any = None
    branch_col: Any = None
    fridge_col: Any = None
    is_blank: bool = False


def read_weekly_sheet(path: str | os.PathLike) -> list[WeeklySheetRow]:
    """Read Time/Temp (required) plus optional Logger/Branch/Fridge columns."""
    path = os.fspath(path)
    try:
        workbook = openpyxl.load_workbook(path, data_only=True)
    except (OSError, zipfile.BadZipFile, InvalidFileException, KeyError) as exc:
        raise IngestError(
            f"cannot read {os.path.basename(path)} as an XLSX file: {exc}"
        ) from None
    try:
        sheet = workbook.worksheets[0]
        data = list(sheet.iter_rows(values_only=True))
    finally:
        workbook.close()

    if not data:
        raise IngestError("file is empty: no header row")

    headers: dict[str, int] = {}
    for index, cell in enumerate(data[0]):
        label = normalize_name(cell).casefold()
        if label and label not in headers:
            headers[label] = index

    def find_col(aliases: tuple[str, ...]) -> int | None:
        for alias in aliases:
            if alias in headers:
                return headers[alias]
        return None

    time_col = find_col(TIME_HEADERS)
    temp_col = find_col(TEMP_HEADERS)
    missing = [
        label
        for label, col in (
            ("Time (or Timestamp)", time_col),
            ("Temp (or Temperature)", temp_col),
        )
        if col is None
    ]
    if missing:
        raise IngestError(f"missing required column(s): {', '.join(missing)}")

    logger_col = headers.get("logger")
    branch_col = headers.get("branch")
    fridge_col = headers.get("fridge")

    def cell(values, col):
        return values[col] if col is not None and col < len(values) else None

    def blank(value: Any) -> bool:
        return value is None or (isinstance(value, str) and not value.strip())

    rows: list[WeeklySheetRow] = []
    for number, values in enumerate(data[1:], start=2):
        raw_time = cell(values, time_col)
        raw_temp = cell(values, temp_col)
        logger_v = cell(values, logger_col)
        branch_v = cell(values, branch_col)
        fridge_v = cell(values, fridge_col)
        if blank(raw_time) and blank(raw_temp) and blank(logger_v) and blank(branch_v) and blank(fridge_v):
            rows.append(WeeklySheetRow(number, None, None, is_blank=True))
        else:
            rows.append(
                WeeklySheetRow(
                    number,
                    raw_time,
                    raw_temp,
                    logger_col=logger_v,
                    branch_col=branch_v,
                    fridge_col=fridge_v,
                )
            )
    return rows


def summarize_logger_column(
    sheet_rows: Sequence[WeeklySheetRow],
) -> tuple[list[dict], str | None]:
    """Count distinct Logger-column values. Suggest only when exactly one code."""
    counts: dict[str, int] = {}
    display: dict[str, str] = {}
    for row in sheet_rows:
        if row.is_blank or row.logger_col is None or not str(row.logger_col).strip():
            continue
        found = normalize_name(row.logger_col)
        if not found:
            continue
        key = name_key(found)
        counts[key] = counts.get(key, 0) + 1
        display.setdefault(key, found)
    summary = [
        {"code": display[key], "count": counts[key]}
        for key in sorted(counts, key=lambda k: (-counts[k], display[k]))
    ]
    suggested = summary[0]["code"] if len(summary) == 1 else None
    return summary, suggested


def mapping_mismatch_summary(mismatches: Sequence[MappingMismatch]) -> str:
    """Plain-English summary of repeated column mismatches."""
    logger_mm = [m for m in mismatches if m.field == "Logger"]
    if logger_mm:
        groups: dict[tuple[str, str], int] = {}
        for item in logger_mm:
            key = (item.found, item.expected)
            groups[key] = groups.get(key, 0) + 1
        found, expected = next(iter(groups))
        count = groups[(found, expected)]
        if len(groups) == 1:
            noun = "row" if count == 1 else "rows"
            verb = "contains" if count == 1 else "contain"
            return f"{count} {noun} {verb} {found}, but {expected} was selected."
        parts = [
            f"{n} row{'s' if n != 1 else ''} contain {found}"
            for (found, _expected), n in groups.items()
        ]
        expected = logger_mm[0].expected
        return f"{'; '.join(parts)}. Selected logger is {expected}."
    return mismatches[0].message


def attach_logger_column(result: FileResult, file: FileUpload) -> None:
    """Fill logger-column hint without using it to resolve the file."""
    try:
        rows = read_weekly_sheet(file.path)
    except IngestError:
        return
    summary, suggested = summarize_logger_column(rows)
    result.logger_column = summary
    result.suggested_logger_code = suggested


def validate_optional_columns(
    sheet_rows: Sequence[WeeklySheetRow],
    logger_code: str,
    resolved: Mapping[int, AssignmentInfo],
) -> list[MappingMismatch]:
    """Compare optional Logger/Branch/Fridge cells to the resolved mapping."""
    mismatches: list[MappingMismatch] = []
    for row in sheet_rows:
        if row.is_blank:
            continue
        if row.logger_col is not None and str(row.logger_col).strip():
            found = normalize_name(row.logger_col)
            if name_key(found) != name_key(logger_code):
                mismatches.append(
                    MappingMismatch(
                        row.row_number,
                        "Logger",
                        found,
                        logger_code,
                        f"row {row.row_number} says {found}, but file resolves to {logger_code}",
                    )
                )
        assignment = resolved.get(row.row_number)
        if assignment is None:
            continue
        if row.branch_col is not None and str(row.branch_col).strip():
            found = normalize_name(row.branch_col)
            if name_key(found) != name_key(assignment.branch_name):
                mismatches.append(
                    MappingMismatch(
                        row.row_number,
                        "Branch",
                        found,
                        assignment.branch_name,
                        f"row {row.row_number} says {found}, but {logger_code} resolves to "
                        f"{assignment.branch_name} / {assignment.fridge_name} at that time",
                    )
                )
        if row.fridge_col is not None and str(row.fridge_col).strip():
            found = normalize_name(row.fridge_col)
            if name_key(found) != name_key(assignment.fridge_name):
                mismatches.append(
                    MappingMismatch(
                        row.row_number,
                        "Fridge",
                        found,
                        assignment.fridge_name,
                        f"row {row.row_number} says {found}, but {logger_code} resolves to "
                        f"{assignment.fridge_name} at that time",
                    )
                )
    return mismatches


# --------------------------------------------------------------------------
# Moves and new loggers
# --------------------------------------------------------------------------


def parse_effective_at(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    if not isinstance(value, str) or not value.strip():
        raise UploadError("move effective_at is required")
    text = value.strip().replace("T", " ")
    # Allow ISO with seconds or the Phase 2 timestamp formats.
    try:
        return parse_timestamp(text)
    except ValueError:
        pass
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    raise UploadError(f"unrecognized move effective_at {value!r}")


def _lookup_fridge(
    session: Session,
    fridge_ref: int | str,
    fridge_by_index: Mapping[int, Fridge] | None = None,
) -> tuple[Fridge | None, str | None]:
    """Resolve an existing fridge id or a staged `new:<index>` reference."""
    fridge_by_index = fridge_by_index or {}
    if isinstance(fridge_ref, str) and fridge_ref.lower().startswith("new:"):
        rest = fridge_ref.split(":", 1)[1]
        try:
            index = int(rest)
        except ValueError:
            return None, f"invalid new fridge reference {fridge_ref!r}"
        fridge = fridge_by_index.get(index)
        if fridge is None:
            return None, f"staged fridge {fridge_ref} is not confirmed"
        return fridge, None
    try:
        fridge_id = int(fridge_ref)
    except (TypeError, ValueError):
        return None, f"invalid fridge reference {fridge_ref!r}"
    fridge = session.get(Fridge, fridge_id)
    if fridge is None:
        return None, f"fridge id {fridge_id} does not exist"
    return fridge, None


def apply_new_fridges(
    session: Session, staged: Sequence[StagedNewFridge]
) -> tuple[list[dict], list[dict], dict[int, Fridge]]:
    """Create staged fridges in existing cities. Repeated identical names reuse the row."""
    created: list[dict] = []
    rejected: list[dict] = []
    by_index: dict[int, Fridge] = {}
    batch_seen: dict[tuple[str, str], Fridge] = {}

    for index, item in enumerate(staged):
        branch = normalize_name(item.branch)
        name = normalize_name(item.name)
        if not branch or not name:
            rejected.append(
                {
                    "index": index,
                    "branch": item.branch,
                    "name": item.name,
                    "reason": "city and fridge name are required",
                }
            )
            continue
        identity = (name_key(branch), name_key(name))
        if identity in batch_seen:
            fridge = batch_seen[identity]
            by_index[index] = fridge
            created.append(
                {
                    "index": index,
                    "id": fridge.id,
                    "branch": fridge.branch_name,
                    "name": fridge.name,
                    "status": "already_present",
                }
            )
            continue

        known_branch = session.scalars(
            select(Fridge.branch_name)
            .where(func.lower(Fridge.branch_name) == name_key(branch))
            .order_by(Fridge.id)
        ).first()
        if known_branch is None:
            rejected.append(
                {
                    "index": index,
                    "branch": branch,
                    "name": name,
                    "reason": "city is not in the list; pick an existing city",
                }
            )
            continue

        existing = session.scalars(
            select(Fridge)
            .where(
                func.lower(Fridge.branch_name) == name_key(branch),
                func.lower(Fridge.name) == name_key(name),
            )
            .order_by(Fridge.id)
        ).first()
        if existing is not None:
            batch_seen[identity] = existing
            by_index[index] = existing
            created.append(
                {
                    "index": index,
                    "id": existing.id,
                    "branch": existing.branch_name,
                    "name": existing.name,
                    "status": "already_present",
                }
            )
            continue

        fridge = Fridge(branch_name=known_branch, name=name)
        nested = session.begin_nested()
        try:
            session.add(fridge)
            session.flush()
            nested.commit()
        except IntegrityError:
            nested.rollback()
            existing = session.scalars(
                select(Fridge)
                .where(
                    func.lower(Fridge.branch_name) == name_key(branch),
                    func.lower(Fridge.name) == name_key(name),
                )
                .order_by(Fridge.id)
            ).first()
            if existing is None:
                rejected.append(
                    {
                        "index": index,
                        "branch": branch,
                        "name": name,
                        "reason": "could not create fridge",
                    }
                )
                continue
            batch_seen[identity] = existing
            by_index[index] = existing
            created.append(
                {
                    "index": index,
                    "id": existing.id,
                    "branch": existing.branch_name,
                    "name": existing.name,
                    "status": "already_present",
                }
            )
            continue

        batch_seen[identity] = fridge
        by_index[index] = fridge
        created.append(
            {
                "index": index,
                "id": fridge.id,
                "branch": fridge.branch_name,
                "name": fridge.name,
                "status": "created",
            }
        )
    return created, rejected, by_index


def apply_new_loggers(
    session: Session,
    staged: Sequence[StagedNewLogger],
    fridge_by_index: Mapping[int, Fridge] | None = None,
) -> tuple[list[dict], list[dict], dict[str, Logger]]:
    """Create staged new loggers + undated assignments. Returns created, rejected, by_code."""
    created: list[dict] = []
    rejected: list[dict] = []
    by_code: dict[str, Logger] = {}

    for item in staged:
        code = normalize_name(item.code)
        if not code:
            rejected.append({"code": item.code, "reason": "logger code is empty"})
            continue
        if item.unit not in ("C", "F"):
            rejected.append({"code": code, "reason": "unit must be 'C' or 'F'"})
            continue
        existing = session.scalars(
            select(Logger).where(func.lower(Logger.code) == name_key(code)).order_by(Logger.id)
        ).first()
        if existing is not None:
            rejected.append(
                {
                    "code": code,
                    "reason": "logger already exists; select it from the list",
                    "existing_id": existing.id,
                }
            )
            continue
        fridge, fridge_err = _lookup_fridge(session, item.fridge_id, fridge_by_index)
        if fridge is None:
            rejected.append({"code": code, "reason": fridge_err})
            continue

        logger = Logger(code=code, unit=item.unit)
        session.add(logger)
        session.flush()
        session.add(
            LoggerAssignment(
                logger_id=logger.id,
                fridge_id=fridge.id,
                assigned_from=None,
                assigned_to=None,
            )
        )
        session.flush()
        by_code[name_key(code)] = logger
        created.append(
            {
                "id": logger.id,
                "code": logger.code,
                "unit": logger.unit,
                "fridge_id": fridge.id,
                "branch": fridge.branch_name,
                "fridge": fridge.name,
            }
        )
    return created, rejected, by_code


def apply_moves(
    session: Session,
    moves: Sequence[StagedMove],
    fridge_by_index: Mapping[int, Fridge] | None = None,
) -> tuple[list[dict], list[dict]]:
    """Insert dated assignments. Repeated identical moves are harmless."""
    applied: list[dict] = []
    rejected: list[dict] = []
    # Within this batch: same logger + effective_at + different fridge = conflict.
    seen: dict[tuple[int, datetime], int] = {}

    for move in moves:
        logger = session.get(Logger, move.logger_id)
        if logger is None:
            rejected.append(
                {"logger_id": move.logger_id, "reason": f"logger id {move.logger_id} does not exist"}
            )
            continue
        fridge, fridge_err = _lookup_fridge(session, move.fridge_id, fridge_by_index)
        if fridge is None:
            rejected.append(
                {
                    "logger_id": move.logger_id,
                    "fridge_id": move.fridge_id,
                    "reason": fridge_err,
                }
            )
            continue

        key = (move.logger_id, move.effective_at)
        if key in seen and seen[key] != fridge.id:
            rejected.append(
                {
                    "logger_id": move.logger_id,
                    "fridge_id": move.fridge_id,
                    "effective_at": move.effective_at.isoformat(sep=" "),
                    "reason": "conflicting move: same logger and effective time, different fridge",
                }
            )
            continue
        seen[key] = fridge.id

        existing = session.scalars(
            select(LoggerAssignment).where(
                LoggerAssignment.logger_id == move.logger_id,
                LoggerAssignment.assigned_from == move.effective_at,
            )
        ).all()
        same = [a for a in existing if a.fridge_id == fridge.id]
        other = [a for a in existing if a.fridge_id != fridge.id]
        if other:
            rejected.append(
                {
                    "logger_id": move.logger_id,
                    "fridge_id": fridge.id,
                    "effective_at": move.effective_at.isoformat(sep=" "),
                    "reason": "conflicting move: another fridge already has this effective time",
                }
            )
            continue
        if same:
            applied.append(
                {
                    "logger_id": move.logger_id,
                    "fridge_id": fridge.id,
                    "effective_at": move.effective_at.isoformat(sep=" "),
                    "status": "already_present",
                }
            )
            continue

        nested = session.begin_nested()
        try:
            session.add(
                LoggerAssignment(
                    logger_id=move.logger_id,
                    fridge_id=fridge.id,
                    assigned_from=move.effective_at,
                    assigned_to=None,
                )
            )
            session.flush()
            nested.commit()
        except IntegrityError:
            nested.rollback()
            applied.append(
                {
                    "logger_id": move.logger_id,
                    "fridge_id": fridge.id,
                    "effective_at": move.effective_at.isoformat(sep=" "),
                    "status": "already_present",
                }
            )
            continue
        applied.append(
            {
                "logger_id": move.logger_id,
                "fridge_id": fridge.id,
                "effective_at": move.effective_at.isoformat(sep=" "),
                "status": "created",
            }
        )
    return applied, rejected


# --------------------------------------------------------------------------
# Serialization helpers
# --------------------------------------------------------------------------


def _dec(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value, "f")


def _dt(value: datetime | None) -> str | None:
    return value.isoformat(sep=" ") if value is not None else None


def conflict_to_dict(c: Conflict) -> dict:
    return {
        "row_number": c.row_number,
        "logger_code": c.logger_code,
        "measured_at": _dt(c.measured_at),
        "kept": _dec(c.kept),
        "ignored": _dec(c.ignored),
        "kept_source": c.kept_source,
        "kept_row_number": c.kept_row_number,
    }


def fridge_conflict_to_dict(c: FridgeConflict) -> dict:
    return {
        "row_number": c.row_number,
        "logger_code": c.logger_code,
        "measured_at": _dt(c.measured_at),
        "kept_branch": c.kept_branch,
        "kept_fridge": c.kept_fridge,
        "ignored_branch": c.ignored_branch,
        "ignored_fridge": c.ignored_fridge,
        "kept_source": c.kept_source,
        "kept_row_number": c.kept_row_number,
    }


def rejected_to_dict(r: RejectedRow) -> dict:
    return {"row_number": r.row_number, "reason": r.reason}


def logger_unit_to_dict(info: LoggerUnitInfo) -> dict:
    return {
        "code": info.code,
        "unit": info.unit,
        "source": info.source,
        "is_new": info.is_new,
        "branch": info.branch,
    }


def file_result_to_dict(result: FileResult) -> dict:
    return {
        "status": result.status,
        "file_index": result.file_index,
        "filename": result.filename,
        "logger": (
            None
            if result.logger_code is None
            else {
                "id": result.logger_id,
                "code": result.logger_code,
                "source": result.logger_source,
            }
        ),
        "fridges": result.fridges,
        "inserted": result.inserted,
        "duplicates": result.duplicates,
        "conflicts": result.conflicts,
        "fridge_conflicts": result.fridge_conflicts,
        "mapping_mismatches": result.mapping_mismatches,
        "rejected": result.rejected,
        "rejected_total": result.rejected_total,
        "invalid_values": result.invalid_values,
        "unit_converted": result.unit_converted,
        "loggers_created": result.loggers_created,
        "fridges_created": result.fridges_created,
        "assignments_created": result.assignments_created,
        "message": result.message,
        "logger_column": result.logger_column,
        "suggested_logger_code": result.suggested_logger_code,
    }


def outcome_to_dict(outcome: UploadOutcome) -> dict:
    body: dict[str, Any] = {
        "mode": outcome.mode,
        "dry_run": outcome.dry_run,
        "files": [file_result_to_dict(f) for f in outcome.files],
        "moves_applied": outcome.moves_applied,
        "moves_rejected": outcome.moves_rejected,
        "new_loggers_created": outcome.new_loggers_created,
        "new_loggers_rejected": outcome.new_loggers_rejected,
        "new_fridges_created": outcome.new_fridges_created,
        "new_fridges_rejected": outcome.new_fridges_rejected,
        "blocked": outcome.blocked,
        "message": outcome.message,
    }
    if outcome.mode == "historical":
        body["logger_units"] = [logger_unit_to_dict(u) for u in outcome.logger_units]
        body["historical"] = outcome.historical
    return body


def _apply_ingest_counts(
    file_result: FileResult,
    ingest: IngestResult,
    fridge_conflicts: Sequence[FridgeConflict],
) -> None:
    file_result.inserted = ingest.inserted
    file_result.duplicates = ingest.duplicates
    file_result.conflicts = [conflict_to_dict(c) for c in ingest.conflicts]
    file_result.fridge_conflicts = [fridge_conflict_to_dict(c) for c in fridge_conflicts]
    file_result.rejected = [rejected_to_dict(r) for r in ingest.rejected[:100]]
    file_result.rejected_total = len(ingest.rejected)
    file_result.invalid_values = ingest.null_temperatures
    file_result.loggers_created = ingest.loggers_created
    file_result.fridges_created = ingest.fridges_created
    file_result.assignments_created = ingest.assignments_created


# --------------------------------------------------------------------------
# Historical processing
# --------------------------------------------------------------------------


def process_historical(
    session: Session,
    file: FileUpload,
    logger_units_override: Mapping[str, str] | None,
    *,
    commit: bool,
) -> UploadOutcome:
    outcome = UploadOutcome(mode="historical", dry_run=not commit)
    try:
        rows = read_xlsx_rows(file.path)
    except IngestError as exc:
        fr = FileResult(
            status="invalid",
            file_index=file.index,
            filename=file.filename,
            message=str(exc),
        )
        outcome.files.append(fr)
        outcome.message = str(exc)
        return outcome

    infos = resolve_historical_logger_units(session, rows, logger_units_override)
    outcome.logger_units = infos
    unresolved = unresolved_haifa_loggers(infos)

    units = historical_units_mapping(infos)
    fr = FileResult(
        status="ready" if not unresolved else "needs_attention",
        file_index=file.index,
        filename=file.filename,
        unit_converted=any(u == "F" for u in units.values()),
    )

    if unresolved:
        names = ", ".join(u.code for u in unresolved)
        fr.message = (
            f"unit required for Haifa logger(s): {names}. "
            "Supply logger_units before import."
        )
        fr.status = "needs_attention"
        outcome.files.append(fr)
        outcome.blocked = True
        outcome.message = fr.message
        if commit:
            # Import refuses entirely — write nothing.
            return outcome
        # Review still reports what would happen if units were supplied? Plan:
        # review lists them unresolved; import refuses. For review counts,
        # still run a dry ingest only when all units resolved. When unresolved,
        # report unit list without ingesting.
        outcome.historical = {
            "rows_read": sum(1 for r in rows if not r.is_blank),
            "loggers": [logger_unit_to_dict(i) for i in infos],
            "unresolved_units": [logger_unit_to_dict(u) for u in unresolved],
        }
        return outcome

    filtered, fridge_conflicts = filter_fridge_conflicts(session, rows)
    ingest = ingest_rows(session, filtered, source_file=file.filename, logger_units=units)
    _apply_ingest_counts(fr, ingest, fridge_conflicts)

    # Names that would be / were created.
    new_logger_codes = [i.code for i in infos if i.is_new]
    fr.status = "imported" if commit else "ready"
    outcome.files.append(fr)
    outcome.historical = {
        "rows_read": ingest.rows_read,
        "blank_rows": ingest.blank_rows,
        "inserted": ingest.inserted,
        "duplicates": ingest.duplicates,
        "conflicts": len(ingest.conflicts),
        "fridge_conflicts": len(fridge_conflicts),
        "rejected_total": len(ingest.rejected),
        "invalid_values": ingest.null_temperatures,
        "loggers_created": ingest.loggers_created,
        "fridges_created": ingest.fridges_created,
        "assignments_created": ingest.assignments_created,
        "new_logger_codes": new_logger_codes,
        "logger_units": [logger_unit_to_dict(i) for i in infos],
    }
    if commit:
        session.commit()
    return outcome


# --------------------------------------------------------------------------
# Weekly processing
# --------------------------------------------------------------------------


def _selection_value(
    selections: Mapping[Any, Any], file_index: int
) -> Any:
    if file_index in selections:
        return selections[file_index]
    key = str(file_index)
    if key in selections:
        return selections[key]
    return None


def _resolve_weekly_logger(
    session: Session,
    file: FileUpload,
    selections: Mapping[Any, Any],
    new_by_code: Mapping[str, Logger],
    known_codes: Sequence[str],
) -> tuple[Logger | None, str | None, str | None]:
    """Return (logger, source, error_message)."""
    selection = _selection_value(selections, file.index)
    if selection is not None:
        if isinstance(selection, str) and selection.lower().startswith("new:"):
            code = normalize_name(selection[4:])
            logger = new_by_code.get(name_key(code))
            if logger is None:
                # May still be pending confirmation in review before apply.
                return None, "new", f"staged new logger {code!r} is not confirmed"
            return logger, "new", None
        try:
            logger_id = int(selection)
        except (TypeError, ValueError):
            return None, None, f"invalid logger selection {selection!r}"
        logger = session.get(Logger, logger_id)
        if logger is None:
            return None, None, f"logger id {logger_id} does not exist"
        return logger, "selection", None

    detected = detect_logger_code(file.filename, known_codes)
    if detected is None:
        return None, None, "logger not identified; select a logger or register a new one"
    logger = session.scalars(
        select(Logger).where(func.lower(Logger.code) == name_key(detected)).order_by(Logger.id)
    ).first()
    if logger is None:
        return None, None, f"detected logger {detected!r} is not in the database"
    return logger, "filename", None


def _ambiguous_history_message(logger: Logger, assignments: Sequence[AssignmentInfo]) -> str:
    undated = [a for a in assignments if a.assigned_from is None]
    dated = [a for a in assignments if a.assigned_from is not None]
    fridge_names = sorted({a.fridge_name for a in undated})
    if len(undated) > 1:
        names = ", ".join(fridge_names)
        if dated:
            earliest_move = min(a.assigned_from for a in dated if a.assigned_from is not None)
            return (
                f"{logger.code} was in two fridges ({names}) with no recorded dates, "
                f"so readings before {earliest_move.isoformat(sep=' ')} cannot be assigned. "
                f"Record each known move with its date and time "
                f"(including the earlier one), then review again."
            )
        return (
            f"{logger.code} was in multiple fridges ({names}) with no recorded dates, "
            "so readings cannot be assigned. Record each known move with its date and time, "
            "then review again."
        )
    if not assignments:
        return f"{logger.code} has no fridge assignment; record a move or register the mapping"
    return f"{logger.code} has unresolved fridge history for some readings"


def process_weekly_file(
    session: Session,
    file: FileUpload,
    logger: Logger,
    logger_source: str,
    *,
    batch_fridge_index: dict[tuple[str, datetime], tuple[str, str, str, int]],
    commit_label: bool,
) -> FileResult:
    result = FileResult(
        status="ready",
        file_index=file.index,
        filename=file.filename,
        logger_id=logger.id,
        logger_code=logger.code,
        logger_source=logger_source,
        unit_converted=(logger.unit == "F"),
    )
    try:
        sheet_rows = read_weekly_sheet(file.path)
    except IngestError as exc:
        result.status = "invalid"
        result.message = str(exc)
        return result

    assignments = load_assignments(session, logger.id)
    resolved_for_row: dict[int, AssignmentInfo] = {}
    first_unresolved_time: datetime | None = None
    parsed_rows: list[ParsedRow] = []
    fridges_used: dict[int, dict] = {}

    for sheet_row in sheet_rows:
        if sheet_row.is_blank:
            parsed_rows.append(ParsedRow(sheet_row.row_number, None, None, None, None, None))
            continue
        try:
            measured_at = parse_timestamp(sheet_row.raw_time)
        except ValueError as exc:
            parsed_rows.append(
                ParsedRow(
                    sheet_row.row_number,
                    logger.code,
                    None,
                    None,
                    sheet_row.raw_time,
                    sheet_row.raw_temp,
                    error=str(exc),
                )
            )
            continue

        assignment = resolve_fridge_at(assignments, measured_at)
        if assignment is None:
            if first_unresolved_time is None:
                first_unresolved_time = measured_at
            continue

        resolved_for_row[sheet_row.row_number] = assignment
        fridges_used[assignment.fridge_id] = {
            "id": assignment.fridge_id,
            "branch": assignment.branch_name,
            "name": assignment.fridge_name,
        }
        parsed_rows.append(
            ParsedRow(
                sheet_row.row_number,
                logger.code,
                assignment.branch_name,
                assignment.fridge_name,
                sheet_row.raw_time,
                sheet_row.raw_temp,
            )
        )

    if first_unresolved_time is not None:
        result.status = "needs_attention"
        result.message = _ambiguous_history_message(logger, assignments)
        result.fridges = list(fridges_used.values())
        # Do not ingest anything from an unresolved file.
        return result

    column_summary, column_suggested = summarize_logger_column(sheet_rows)
    result.logger_column = column_summary
    result.suggested_logger_code = column_suggested

    mismatches = validate_optional_columns(sheet_rows, logger.code, resolved_for_row)
    if mismatches:
        result.status = "needs_attention"
        result.mapping_mismatches = [
            {
                "row_number": m.row_number,
                "field": m.field,
                "found": m.found,
                "expected": m.expected,
                "message": m.message,
            }
            for m in mismatches
        ]
        result.message = mapping_mismatch_summary(mismatches)
        result.fridges = list(fridges_used.values())
        return result

    # No non-blank data rows?
    data_rows = [r for r in parsed_rows if not r.is_blank]
    if not data_rows:
        result.status = "invalid"
        result.message = "file has no data rows"
        return result

    filtered, fridge_conflicts = filter_fridge_conflicts(
        session, parsed_rows, batch_fridge_index=batch_fridge_index
    )
    # Explicit units so Phase 2 never defaults a (should-already-exist) logger.
    ingest = ingest_rows(
        session,
        filtered,
        source_file=file.filename,
        logger_units={logger.code: logger.unit},
    )
    _apply_ingest_counts(result, ingest, fridge_conflicts)
    result.fridges = list(fridges_used.values())
    result.status = "imported" if commit_label else "ready"
    return result


def process_weekly(
    session: Session,
    files: Sequence[FileUpload],
    selections: Mapping[Any, Any],
    new_loggers: Sequence[StagedNewLogger],
    moves: Sequence[StagedMove],
    *,
    commit: bool,
    new_fridges: Sequence[StagedNewFridge] | None = None,
) -> UploadOutcome:
    outcome = UploadOutcome(mode="weekly", dry_run=not commit)

    if len(files) > MAX_FILES:
        raise UploadError(f"at most {MAX_FILES} files allowed per batch")

    # Apply staged fridges, then new loggers and moves first (persisted on
    # import even if no file imports). On review they run inside the rollback.
    created_f, rejected_f, fridge_by_index = apply_new_fridges(
        session, new_fridges or []
    )
    outcome.new_fridges_created = created_f
    outcome.new_fridges_rejected = rejected_f

    created, rejected_nl, new_by_code = apply_new_loggers(
        session, new_loggers, fridge_by_index
    )
    outcome.new_loggers_created = created
    outcome.new_loggers_rejected = rejected_nl

    # If import and any staged new logger was rejected while referenced, files
    # that need it stay needs_attention.
    applied_moves, rejected_moves = apply_moves(session, moves, fridge_by_index)
    outcome.moves_applied = applied_moves
    outcome.moves_rejected = rejected_moves

    if commit:
        session.commit()

    known = session.scalars(select(Logger).order_by(Logger.id)).all()
    known_codes = [logger.code for logger in known]
    # Include just-created codes for filename detection in the same request.
    for logger in new_by_code.values():
        if logger.code not in known_codes:
            known_codes.append(logger.code)

    batch_fridge_index: dict[tuple[str, datetime], tuple[str, str, str, int]] = {}

    for file in files:
        if file.size > MAX_FILE_BYTES:
            outcome.files.append(
                FileResult(
                    status="invalid",
                    file_index=file.index,
                    filename=file.filename,
                    message=f"file exceeds {MAX_FILE_BYTES} bytes",
                )
            )
            continue
        if not file.filename.lower().endswith(".xlsx"):
            outcome.files.append(
                FileResult(
                    status="invalid",
                    file_index=file.index,
                    filename=file.filename,
                    message="only .xlsx files are accepted",
                )
            )
            continue

        logger, source, err = _resolve_weekly_logger(
            session, file, selections, new_by_code, known_codes
        )
        if logger is None:
            # Selection asked for new:<CODE> but it wasn't in new_loggers /
            # was rejected — still needs attention.
            sel = _selection_value(selections, file.index)
            status = "needs_attention"
            if err and "invalid" in err:
                status = "invalid"
            unidentified = FileResult(
                status=status,
                file_index=file.index,
                filename=file.filename,
                logger_source=source,
                message=err,
            )
            attach_logger_column(unidentified, file)
            if unidentified.suggested_logger_code and status == "needs_attention":
                unidentified.message = (
                    f"{err}. The Logger column consistently contains "
                    f"{unidentified.suggested_logger_code}."
                )
            elif len(unidentified.logger_column) > 1:
                codes = ", ".join(
                    f"{item['code']} ({item['count']})"
                    for item in unidentified.logger_column
                )
                unidentified.message = (
                    f"{err}. The Logger column has mixed codes: {codes}."
                )
            outcome.files.append(unidentified)
            continue

        # Snapshot so a non-imported file does not poison later fridge-conflict checks.
        index_snapshot = dict(batch_fridge_index)
        if commit:
            try:
                fr = process_weekly_file(
                    session,
                    file,
                    logger,
                    source or "selection",
                    batch_fridge_index=batch_fridge_index,
                    commit_label=True,
                )
                if fr.status in ("ready", "imported"):
                    session.commit()
                    fr.status = "imported"
                else:
                    session.rollback()
                    batch_fridge_index.clear()
                    batch_fridge_index.update(index_snapshot)
                outcome.files.append(fr)
            except Exception as exc:  # noqa: BLE001 — per-file failure must not abort batch
                session.rollback()
                batch_fridge_index.clear()
                batch_fridge_index.update(index_snapshot)
                outcome.files.append(
                    FileResult(
                        status="failed",
                        file_index=file.index,
                        filename=file.filename,
                        logger_id=logger.id,
                        logger_code=logger.code,
                        logger_source=source,
                        message=f"import failed: {exc}",
                    )
                )
        else:
            fr = process_weekly_file(
                session,
                file,
                logger,
                source or "selection",
                batch_fridge_index=batch_fridge_index,
                commit_label=False,
            )
            if fr.status not in ("ready", "imported"):
                batch_fridge_index.clear()
                batch_fridge_index.update(index_snapshot)
            outcome.files.append(fr)

    return outcome


# --------------------------------------------------------------------------
# Request parsing / temp files / entry points
# --------------------------------------------------------------------------


def parse_json_field(raw: str | None, default: Any) -> Any:
    if raw is None or raw == "":
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise UploadError(f"invalid JSON: {exc}") from None


def parse_fridge_ref(value: Any) -> int | str:
    """Existing fridge id, or staged fridge `new:<index>`."""
    if isinstance(value, bool):
        raise UploadError("fridge_id must be an integer or new:<index>")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        text = value.strip()
        if text.lower().startswith("new:"):
            rest = text.split(":", 1)[1]
            try:
                index = int(rest)
            except ValueError as exc:
                raise UploadError("new fridge reference must be new:<index>") from exc
            return f"new:{index}"
        try:
            return int(text)
        except ValueError as exc:
            raise UploadError("fridge_id must be an integer or new:<index>") from exc
    raise UploadError("fridge_id must be an integer or new:<index>")


def parse_new_fridges(raw: Any) -> list[StagedNewFridge]:
    data = raw if not isinstance(raw, str) else parse_json_field(raw, [])
    if not isinstance(data, list):
        raise UploadError("new_fridges must be a JSON list")
    out: list[StagedNewFridge] = []
    for item in data:
        if not isinstance(item, dict):
            raise UploadError("each new_fridge must be an object")
        if "branch" not in item or "name" not in item:
            raise UploadError("new_fridge requires branch and name")
        out.append(StagedNewFridge(branch=str(item["branch"]), name=str(item["name"])))
    return out


def parse_new_loggers(raw: Any) -> list[StagedNewLogger]:
    data = raw if not isinstance(raw, str) else parse_json_field(raw, [])
    if not isinstance(data, list):
        raise UploadError("new_loggers must be a JSON list")
    out: list[StagedNewLogger] = []
    for item in data:
        if not isinstance(item, dict):
            raise UploadError("each new_logger must be an object")
        if "code" not in item or "unit" not in item or "fridge_id" not in item:
            raise UploadError("new_logger requires code, unit and fridge_id")
        out.append(
            StagedNewLogger(
                code=str(item["code"]),
                unit=str(item["unit"]),
                fridge_id=parse_fridge_ref(item["fridge_id"]),
            )
        )
    return out


def parse_moves(raw: Any) -> list[StagedMove]:
    data = raw if not isinstance(raw, str) else parse_json_field(raw, [])
    if not isinstance(data, list):
        raise UploadError("moves must be a JSON list")
    out: list[StagedMove] = []
    for item in data:
        if not isinstance(item, dict):
            raise UploadError("each move must be an object")
        try:
            logger_id = int(item["logger_id"])
        except (KeyError, TypeError, ValueError) as exc:
            raise UploadError("move requires logger_id, fridge_id, effective_at") from exc
        if "fridge_id" not in item or "effective_at" not in item:
            raise UploadError("move requires logger_id, fridge_id, effective_at")
        out.append(
            StagedMove(
                logger_id=logger_id,
                fridge_id=parse_fridge_ref(item["fridge_id"]),
                effective_at=parse_effective_at(item["effective_at"]),
            )
        )
    return out


def parse_selections(raw: Any) -> dict:
    data = raw if not isinstance(raw, str) else parse_json_field(raw, {})
    if not isinstance(data, dict):
        raise UploadError("selections must be a JSON object")
    return data


def parse_logger_units(raw: Any) -> dict[str, str]:
    data = raw if not isinstance(raw, str) else parse_json_field(raw, {})
    if not isinstance(data, dict):
        raise UploadError("logger_units must be a JSON object")
    out: dict[str, str] = {}
    for key, value in data.items():
        if value not in ("C", "F"):
            raise UploadError(f"logger unit must be 'C' or 'F', got {value!r}")
        out[str(key)] = value
    return out


def save_upload_to_temp(filename: str, data: bytes, directory: str) -> FileUpload:
    if len(data) > MAX_FILE_BYTES:
        raise UploadError(f"{filename}: file exceeds {MAX_FILE_BYTES} bytes")
    safe = Path(filename).name or "upload.xlsx"
    path = os.path.join(directory, safe)
    # Avoid collisions when several files share a name.
    if os.path.exists(path):
        stem, suffix = os.path.splitext(safe)
        path = os.path.join(directory, f"{stem}_{os.getpid()}{suffix}")
    with open(path, "wb") as fh:
        fh.write(data)
    return FileUpload(index=0, filename=safe, path=path, size=len(data))


def read_upload_bytes(upload: Any) -> tuple[str, bytes]:
    """Read a Starlette/FastAPI UploadFile (or file-like) into memory."""
    filename = getattr(upload, "filename", None) or "upload.xlsx"
    if hasattr(upload, "file"):
        upload.file.seek(0)
        data = upload.file.read()
    elif hasattr(upload, "read"):
        data = upload.read()
        if hasattr(data, "__await__"):
            raise UploadError("async upload read must be awaited by the caller")
    else:
        raise UploadError("invalid upload")
    if isinstance(data, memoryview):
        data = data.tobytes()
    if not isinstance(data, (bytes, bytearray)):
        raise UploadError("upload body must be bytes")
    return filename, bytes(data)


async def read_upload_bytes_async(upload: Any) -> tuple[str, bytes]:
    filename = getattr(upload, "filename", None) or "upload.xlsx"
    data = await upload.read()
    if isinstance(data, memoryview):
        data = data.tobytes()
    return filename, bytes(data)


def run_upload(
    session: Session,
    *,
    mode: str,
    files: Sequence[FileUpload],
    selections: Mapping[Any, Any] | None = None,
    new_loggers: Sequence[StagedNewLogger] | None = None,
    moves: Sequence[StagedMove] | None = None,
    logger_units: Mapping[str, str] | None = None,
    new_fridges: Sequence[StagedNewFridge] | None = None,
    commit: bool,
) -> UploadOutcome:
    mode = (mode or "weekly").strip().lower()
    if mode not in ("weekly", "historical"):
        raise UploadError(f"mode must be 'weekly' or 'historical', got {mode!r}")

    if mode == "historical":
        if len(files) != 1:
            raise UploadError("historical mode requires exactly one file")
        return process_historical(
            session, files[0], logger_units, commit=commit
        )

    return process_weekly(
        session,
        files,
        selections or {},
        new_loggers or [],
        moves or [],
        commit=commit,
        new_fridges=new_fridges or [],
    )


def review_upload(session: Session, **kwargs: Any) -> dict:
    """Dry run: apply work then roll back so the database is unchanged."""
    nested = session.begin_nested()
    try:
        outcome = run_upload(session, commit=False, **kwargs)
        body = outcome_to_dict(outcome)
    finally:
        nested.rollback()
    return body


def import_upload(session: Session, **kwargs: Any) -> dict:
    """Commit new loggers/moves, then each ready file independently.

    An unexpected error during historical import rolls back so nothing is
    written. Weekly mode already isolates per-file failures.
    """
    try:
        outcome = run_upload(session, commit=True, **kwargs)
    except Exception:
        session.rollback()
        raise
    return outcome_to_dict(outcome)
