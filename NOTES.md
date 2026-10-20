# Engineering Notes — Fridge Temperature Monitor

## 1. Time spent

*To be filled in: [hours].*

## 2. Key decisions and trade-offs

**Implemented:** schema, migration, normalization, ingestion and a seed of the 16 sample rows.

- Each reading keeps its own `fridge_id`. Unknown assignment dates stay NULL and are never invented (TL-0417 moved, but nothing says when).
- `Decimal` parsing. `ERR`/blank/NaN become NULL with the raw text kept. No thresholds: 150 is stored as given.
- Dedup on (logger, time): first row wins, differing repeats are reported as conflicts.
- `Time`/`Temp`-only files need the logger and fridge passed explicitly; a fridge is never guessed.
- Commits live in the caller, not in the ingestion service.
- TL-0231 is assumed Fahrenheit from its values (38.3, 39); the file has no unit column.

**Planned, not built yet: bulk upload** (`docs/cursor/plan-phase-3.md`). Summer gets dozens of logger files a week, possibly with only `Time` and `Temp`. Per-file confirmation would become rubber-stamping, and 12 branch folders don't say which logger or fridge a file belongs to. Instead:

1. Summer selects many files at once.
2. **Preview** parses and validates them, identifies loggers when possible, and prepares mappings **without saving readings**. A logger is identified only when exactly one known code matches the file name as a whole token. This is a convenience, not a guarantee, and never guessed from temperatures.
3. Summer resolves **only unidentified files**, and can optionally record a logger move (logger, destination fridge, effective date and time). Moves stay staged until **Import All**.
4. Known moves resolve the fridge **per reading timestamp**, including files spanning a move. A move does not establish the fridge for earlier readings: those use only a confirmed historical assignment, and one undated assignment counts as the last known mapping. Anything else (such as TL-0417's two undated assignments) is unresolved and never guessed.
5. **Import All** saves ready files independently. An invalid or ambiguous file never blocks the others.
6. Unresolved files are not imported and **not stored on the server**. Leaving the page means uploading them again.
7. **Fridge identity:** A fridge is uniquely identified by its branch and name, case-insensitively. This prevents duplicates caused by inconsistent capitalization while allowing different branches to have fridges with the same name.

*Why:* Summer's attention goes only to exceptions, and valid data lands even when some files are problematic.

*Trade-offs:* a batch can end up partly imported, and unresolved files are lost on leaving, since keeping them would need an upload table.

**Limitation:** an unreported physical move cannot be detected reliably from temperatures, because door openings, defrosts and loading look the same. That logger's files keep going to its last known fridge until a move is recorded.

## 3. Questions for Summer before production

1. How does a logger file identify its logger: file name (exact pattern), column, or not at all?
2. Which fridge is each logger in now, and what moves have happened, with dates and times?
3. How are physical moves reported to her, and before the next upload?
4. What does a typical week look like: how many files, any with several loggers?
5. Which loggers report Fahrenheit? TL-0231 is assumed from sample values only.
6. Is the 15-minute logging interval the same for every logger?



## 4. Unfinished, and one more hour

**Unfinished:** analytics (excursions above 5 °C, durations, warming, gaps), the upload endpoints, the dashboard, and frontend tests. The app UI still shows backend health only.

**Tests:** 120 backend tests pass (70 unit, 50 integration). No frontend tests.

**One more hour:** the analysis functions (excursions and gaps) with unit tests, since the dashboard and upload both build on them.

## 5. AI usage

**Mistake:** the AI wrote the database healthcheck as `pg_isready -U $POSTGRES_USER`. Without `-d`, it probes a database named after the user, which doesn't exist, yet the container reported healthy.

**Detection:** the Postgres logs showed `FATAL: database "fridge_monitor" does not exist` about 100 times.

**Correction:** `docker-compose.yml` now uses `-d $${POSTGRES_DB}`, committed in `7bf242d`.