---
name: Fridge Temperature Monitor Phase 3 MVP
overview: Deterministic analysis (excursions above 5 C, lower-bound durations, gradual warming vs spikes, gaps, data-quality issues), a bulk XLSX upload (logger from file name only when exact, fridge resolved per reading by timestamp, optional recorded moves, partial success, no new tables), and a mobile-first dashboard. Five small endpoints, one shared upload code path.
todos:
  - id: prereq
    content: "Prerequisite: Phase 2 normalization, ingestion and seed exist (Phase 2 plan, unchanged)"
    status: pending
  - id: analysis
    content: app/analysis.py (pure functions, constants) with unit tests against the golden sample results
    status: pending
  - id: read-api
    content: GET /api/lookups, /api/overview, /api/series/{logger_id}/{fridge_id} with integration tests
    status: pending
  - id: upload-api
    content: app/upload.py with POST /api/uploads/review (dry run) and /api/uploads/import, tests
    status: pending
  - id: frontend
    content: Vitest + RTL, responsive dashboard, series detail, bulk upload review and results screens, component tests
    status: pending
  - id: docs-verify
    content: Update NOTES.md, run all suites, check the dashboard at phone width
    status: pending
isProject: false
---

# Phase 3: Analysis, Dashboard and Bulk Upload (MVP)

## Scope and prerequisite

- Done and committed: four-table schema, Alembic migration, 26 backend tests. Tables are empty.
- **Phase 2 normalization, ingestion and seed must exist first** (existing Phase 2 plan, unchanged). Import reuses its `ingest_rows`; the dashboard needs seeded data.
- Each reading stores `fridge_id`, so the unit of analysis is a **series**: readings for one `(logger_id, fridge_id)`, ordered by time. A logger that moved becomes two series, and nothing is assumed across the move.

## Detection rules (`backend/app/analysis.py`)

Pure functions over `(measured_at, temperature_c or None, raw_value)`. Constants live at the top of the file, are passed in explicitly for tests, and are documented in `NOTES.md`.

| Constant | Value |
| --- | --- |
| `THRESHOLD_C` | 5.0 (excursion means strictly above) |
| `GAP_MIN` | 30 (more than 2 of the sample's 15-minute intervals) |
| `WARMING_MIN_READINGS` / `WARMING_MIN_RISE_C` / `WARMING_MAX_STEP_SHARE` | 4 / 1.0 / 0.5 |

- **Invalid readings** (`temperature_c` NULL, such as `ERR`) are excluded from all rules and listed as data-quality issues.
- **Gap:** more than `GAP_MIN` minutes between consecutive valid readings. Nothing is interpolated.
- **Excursion:** a run of consecutive valid readings all above 5 C with no gap between them. A gap always ends a run. Reports start, end, peak, reading count, and `ended_by` (`recovered`, `gap` or `end_of_data`).
- **Duration:** first to last above-threshold reading, a **lower bound**. It never spans a gap or extends to the next reading. One reading means duration 0, shown as "single reading"; `gap` or `end_of_data` endings are shown as "at least".
- **Spike vs sustained:** a one-reading excursion that recovered is an `isolated_spike`. Two or more readings is `sustained`. A one-reading excursion ended by a gap or the end of data is "unconfirmed".
- **Gradual warming:** at least 4 consecutive valid readings with no gap, every step rising, total rise at least 1.0 C, and no single step more than half the total (the spike guard: `4.0, 4.1, 4.2, 9.4` is not warming). Independent of the threshold, so it can warn before 5 C.
- **Data-quality issues:** `invalid_reading` (time and raw value), `gap`, `single_valid_reading`.

**Golden results on the 16 sample rows (unit and API tests):**

| Series | Result |
| --- | --- |
| TL-0388 Rishon LeZion / Cream cakes | Sustained excursion 06:15 to 06:45, peak 7.1, 30 min, `end_of_data`. Gradual warming 06:00 to 06:45, rise 2.5. |
| TL-0417 Tel Aviv / Walk-in | Isolated spike at 06:15, peak 9.4, duration 0. No warming. |
| TL-0417 Tel Aviv / Display 2 | Nothing above threshold, `single_valid_reading`. |
| TL-0512 Jerusalem / Dairy | No excursion. One gap of 135 min (06:15 to 08:30). |
| TL-0231 Haifa / Dairy | No excursion. One `invalid_reading` (`ERR`). |

## Bulk upload design

**Problem:** dozens of logger files a week; a file may hold only `Time` and `Temp`. Nothing is required to identify the logger, and nothing is guessed.

**Flow:** pick many `.xlsx` files, then `review` (a dry run), fix what needs attention, then `import`, then per-file results. The browser keeps the `File` objects, so the server stores nothing between steps.

- **Files:** `.xlsx` only, first sheet, up to 100 files and 5 MB each. `Time` and `Temp` columns required (also `Timestamp`, `Temperature`; case-insensitive). Other columns are ignored, except that a `Logger` column holding anything other than the chosen logger's code makes the file `invalid`. Row cleaning is the Phase 2 normalization.
- **Logger:** detected from the **file name only**, when exactly one known logger code matches as a whole token, ignoring case (`TL-0512_2026-09-14.xlsx` yes; `XTL-05123.xlsx` and `TL-0512_TL-0417.xlsx` no). Otherwise Summer selects it in the review screen. Never inferred from temperatures, units, timestamps or other data. Detection is a convenience, not a guarantee: detected loggers stay visible and changeable, and `source_file` is stored on every reading.
- **Fridge, resolved per reading by timestamp** from the logger's assignments plus any recorded moves. For a reading at time `t`:
  1. **From a dated move onward:** the assignment with the latest `assigned_from <= t` that is still open at `t` wins. A file spanning a known move is split automatically by timestamp, so Summer never splits the Excel file.
  2. **Before that (a move says nothing about earlier readings):** only a confirmed historical assignment may be used. That is a dated assignment that covers `t`, or, if the logger has **exactly one undated assignment**, that one as the **last known mapping** (not guaranteed to be current truth: an unreported move cannot be detected, see Limitations).
  3. **Otherwise** (no assignment, or several undated ones such as TL-0417's) the reading is **unresolved**. The previous fridge is never guessed, and a move's fridge is never applied backwards.
- **A file is imported only if every reading resolves.** Otherwise that file is `needs_attention` and nothing from it is written; the reason names the first unresolved time. Other files are never affected.
- **Recording moves (optional):** logger, destination fridge, effective date and time. Saved as a dated row in `logger_assignments` (`assigned_from` set, `assigned_to` empty); earlier rows are untouched, and the date comes only from Summer. Moves are saved first at import and persist even if no file imports. They do not re-attribute readings already imported.
- **Partial success:** each file is imported in its own committed transaction. An unresolved, invalid or failing file never blocks or rolls back another file. Re-importing is safe (duplicates are skipped by `(logger, measured_at)`).
- **Unresolved files are not stored.** There is no staging or upload table. They stay only on the review screen, where Summer can fix and re-import them. The UI says: "N files were not imported and are not saved on the server. Resolve them now or upload them again later. Leaving or reloading this page discards them." The page also asks for confirmation before it is left.

## Endpoints (5)

- `GET /api/lookups`: loggers (id, code, unit) and fridges (id, branch, name) for the dropdowns.
- `GET /api/overview`: per series, latest reading, status (`ok`, `warning`, `excursion`), and counts of excursions, warming runs, gaps and issues.
- `GET /api/series/{logger_id}/{fridge_id}`: readings (including invalid ones) and all findings.
- `POST /api/uploads/review` and `POST /api/uploads/import` take the same multipart request: `files`, `selections` (JSON `{file_index: logger_id}`) and `moves` (JSON list of `{logger_id, fridge_id, effective_at}`). They share one function. `review` runs it inside a transaction that is **rolled back**, so it reports exactly what import would do and writes nothing. `import` commits the moves first, then each file separately.
- Per-file result: `status` (`ready`/`imported`, `needs_attention`, `invalid`, `failed`), detected or selected logger, fridges used, `inserted`, `duplicates` skipped, `conflicts` (same logger and time with a different value; first wins), `rejected` rows (number and reason), `invalid_values` stored as NULL, `unit_converted`, and a `message` when not imported.
- New backend dependency: `python-multipart`. Analysis runs on request from stored readings. **No new tables.**

## Frontend (React + TypeScript, mobile-first, no router, no chart library)

- **Dashboard:** a card per series with branch, fridge, logger, latest temperature, and status badge. One column on phones, a grid from about 640 px, tap targets of at least 44 px.
- **Series detail:** an inline SVG line chart with the 5 C line and visible gaps (never drawn across a gap), then lists of excursions (with the duration wording above), warming runs, and data-quality issues. Invalid readings are listed.
- **Upload review** (calls `review` after picking files and after each change): a summary line, then **Needs attention** first (file, reason, logger dropdown), **Invalid** (file, reason, remove), and **Ready** collapsed with a count (file, logger and its source, fridge or fridges). Ready files need no per-file confirmation. A collapsible **Record a move** form lists staged moves. "Import N ready files" is enabled whenever at least one file is ready. Cards stack on phones instead of a table.
- **Results:** a summary and a row per file with inserted, skipped duplicates, rejected rows, conflicts, and the message for files not imported, plus the not-saved banner. Not-imported files stay on the review screen. "View dashboard" refetches the data.
- Vitest, React Testing Library and jsdom are added (`npm test` in the container). Fetches use relative `/api/...`, so LAN and mobile access keep working.

## Steps and time (about 8 hours; tests written with each step)

1. `analysis.py`, 1.5 h. 2. Read endpoints, 1 h. 3. `upload.py` and the two upload routes, 2 h. 4. Frontend, 3 h. 5. Docs and verification, 0.5 h.

Cut line, in order: the SVG chart (use lists), the expandable row-level issue details (counts only), visual polish beyond the responsive layout. Everything else is mandatory.

## Tests

- **`test_analysis.py` (unit):** 5.0 is not an excursion and 5.1 is. A run, a single reading, and two stretches split by a gap are two excursions. Each `ended_by` value. Spike vs sustained vs unconfirmed. Warming: positive, too few readings, rise under 1.0, a flat step, and the `4.0, 4.1, 4.2, 9.4` guard. A 30 minute gap is not a gap and 31 is. `ERR` is reported and excluded. The golden table.
- **`test_upload.py` (unit):** file names (exact match, case, two codes, substring, unknown, overlapping codes `TL-051` and `TL-0512`); a `Time`/`Temp`-only file is never identified from its values; `Logger` column check; per-reading fridge resolution: one undated assignment resolves, none or two undated (TL-0417) is ambiguous, a dated move splits one file's readings between two fridges, readings before a move with no baseline are unresolved and never get the later fridge, an ended assignment, and the same start with different fridges.
  - **Focused TL-0417 test:** the logger has two undated assignments (Walk-in, Display 2) and a recorded move to Display 2 effective 2026-09-17 06:00. Readings at or after the move resolve to Display 2. Readings before it are **unresolved**: not Walk-in, not Display 2. A file spanning the move is `needs_attention` with nothing written, and a file entirely before the move is `needs_attention` too. In the same batch, files for other loggers still import (covered end to end in `test_api_upload.py`).
- **`test_api_analysis.py` (integration):** seeded data matches the golden table, and TL-0417 is two series.
- **`test_api_upload.py` (integration):**
  - `review` writes nothing and reports the same outcome as `import`.
  - A mixed batch (ready, ambiguous, invalid, several valid) imports every valid file, writes nothing for the others (no readings and no assignments), and never uses the previous fridge.
  - A failure forced in the middle file leaves the first and last files committed.
  - Moves are saved first and persist with no importable files. A repeated move is harmless, a conflicting move is rejected, and a recorded move resolves a file that was ambiguous.
  - Per-file counts for inserted, duplicates, rejected rows and conflicts, Fahrenheit conversion with raw text kept, and re-import inserting 0.
  - Only the four application tables exist afterwards.
- **Frontend (fetch mocked):** needs-attention files shown first and expanded, ready files collapsed with a count; a detected logger labelled "file name" and a not-detected one showing a dropdown; Import enabled with one ready file while others need attention; the move form validation and its effect on the next review; results with mixed statuses and the not-saved banner; leave confirmation while files remain; dashboard cards and badges; detail view wording ("single reading", "at least 30 min", gaps).
- Existing tests keep passing, and `pytest -m "not integration"` still needs no database.

## Acceptance criteria

1. Constants are defined in one place, documented in `NOTES.md`, and results are deterministic. The golden table is reproduced in the unit test and through the API.
2. No duration crosses a gap and no value is interpolated. The `4.0, 4.1, 4.2, 9.4` series is not warming, and the 9.4 C sample reading is an isolated spike.
3. Invalid readings, gaps, rejected rows and conflicts are visible in the UI with time and reason.
4. Up to 100 files upload in one batch, including `Time`/`Temp`-only files. A logger is auto-detected only from an exact, unambiguous file-name match, never from data, and the UI does not claim it is guaranteed.
5. The fridge is resolved per reading by timestamp: a known move splits a file automatically, readings before it use only a confirmed historical assignment (one undated assignment is the last known mapping), and an ambiguous fridge is never guessed or taken from the move. TL-0417 with two undated assignments leaves its earlier readings unresolved without blocking other files.
6. Review leads with files needing attention, and ready files need no per-file confirmation. Moves can be recorded before import, with no inferred dates.
7. Valid files import independently with a commit each. No unresolved, invalid or failing file blocks or rolls back another, and unresolved files are not stored, which the UI states.
8. Per-file results show imported rows, skipped duplicates, rejected rows, conflicts, and files requiring attention. Re-import inserts nothing. No new tables are added.
9. At 375 px width there is no horizontal scrolling and tap targets are usable (checked in the browser).
10. `docker compose exec backend pytest` and the frontend tests pass with a non-zero collected count, and `/health` still returns 200.

## Open questions for Summer

Recorded in `NOTES.md`. Top item: how does a logger file identify its logger (file name pattern, column, header cell, or nothing)? Unanswered, the MVP asks Summer to select it.

## Out of scope

Authentication, creating loggers or fridges in the UI, per-logger thresholds or intervals, alerts, time zones, multi-sheet or multi-logger files (use the seed), re-attributing already imported readings, detecting unreported moves, directory or zip upload, progress bars or background jobs, and any upload-history table or server-side staging.
