"""Seed the development database from the sample XLSX.

    docker compose exec backend python -m app.seed [path]

Without a path, the single `.xlsx` in the `sample_data/` directory is used
(mounted read-only at /app/sample_data). The run is idempotent: a second run
inserts nothing. `seed_sample` never commits; only the CLI entry point does.
"""

import sys
from pathlib import Path

from sqlalchemy.orm import Session

from app.ingest import IngestError, IngestResult, ingest_xlsx

SAMPLE_DIR = Path(__file__).resolve().parent.parent / "sample_data"

# The sample file has no unit column. TL-0231 reports 38.3 and 39, which are
# plausible only in Fahrenheit (3.50 and 3.89 C), so it is configured as 'F'.
# This is an assumption from inspecting the data (see NOTES.md), not detection.
SAMPLE_LOGGER_UNITS = {"TL-0231": "F"}


class SeedError(RuntimeError):
    pass


def find_sample_file(directory: Path = SAMPLE_DIR) -> Path:
    """The single .xlsx in `directory`; an error if there is none or several."""
    files = sorted(
        p for p in Path(directory).glob("*") if p.suffix.lower() == ".xlsx" and not p.name.startswith("~$")
    )
    if not files:
        raise SeedError(f"no .xlsx file found in {directory}")
    if len(files) > 1:
        raise SeedError(
            f"expected exactly one .xlsx in {directory}, found {len(files)}: pass a path explicitly"
        )
    return files[0]


def seed_sample(session: Session, path: str | Path | None = None) -> IngestResult:
    """Ingest the combined-format sample file. Does not commit."""
    path = Path(path) if path else find_sample_file()
    return ingest_xlsx(session, path, logger_units=SAMPLE_LOGGER_UNITS)


def format_summary(result: IngestResult) -> str:
    lines = [
        f"source file:        {result.source_file}",
        f"rows read:          {result.rows_read} (blank rows skipped: {result.blank_rows})",
        f"readings inserted:  {result.inserted} (of which NULL temperature: {result.null_temperatures})",
        f"duplicates skipped: {result.duplicates}",
        f"conflicts:          {len(result.conflicts)}",
        f"rejected rows:      {len(result.rejected)}",
        f"created:            {result.fridges_created} fridges, {result.loggers_created} loggers, "
        f"{result.assignments_created} assignments",
    ]
    for c in result.conflicts:
        lines.append(
            f"  conflict row {c.row_number}: {c.logger_code} {c.measured_at} "
            f"kept {c.kept} ({c.kept_source}), ignored {c.ignored}"
        )
    for r in result.rejected:
        lines.append(f"  rejected row {r.row_number}: {r.reason}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) > 1:
        print("usage: python -m app.seed [path-to-xlsx]", file=sys.stderr)
        return 2

    from app.database import SessionLocal  # imported here: needs DATABASE_URL

    session = SessionLocal()
    try:
        result = seed_sample(session, args[0] if args else None)
        print(format_summary(result))
        session.commit()  # the single commit of the seed run
    except (SeedError, IngestError) as exc:
        session.rollback()
        print(f"seed failed: {exc}", file=sys.stderr)
        return 1
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
