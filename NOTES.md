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
- TL-0231 is Fahrenheit per the assignment data (its sample values 38.3 and 39 agree); the file has no unit column.

**Planned, not built yet: two workflows** (`docs/cursor/plan-phase-3.md`). Development and demos keep using `seed.py` with the 16-row sample. Summer's real use has two separate screens in the web UI, with no file paths:
- **Initial Setup / Historical Import (one time):** her combined file (Logger, Branch, Fridge, Time, Temp; about 3,000 rows) goes through the same ingestion. The file has no unit column, so predefined units are applied where there is evidence: TL-0231 is Fahrenheit, and a new logger outside Haifa defaults to Celsius, both shown in the preview and overridable. **A new Haifa logger other than TL-0231 is not defaulted to Celsius** (Haifa is the one branch known to have a Fahrenheit logger), so Summer makes a one-time required C/F choice for it; the unit is then stored and never asked again. Units are never inferred from temperature values. No move dates are invented, and importing again adds nothing.
- **Weekly Upload:** new files that may hold only `Time` and `Temp`, using the mappings and units already in the database, so the combined file is never needed again. A genuinely new logger is registered in the review (typed code, confirmed unit, existing fridge) and saved only at Import. The Celsius default is not applied to it.

*Why:* a one-time bootstrap and a recurring upload have different inputs and risks, and one shared ingestion keeps both simple. *Trade-off:* a logger seen under several fridges in the history has several undated assignments, so Summer records its moves (fridge, date and time) before its weekly files import. Misspelled names or units that were imported cannot be edited in the MVP.

**Planned fixes for gaps found in Phase 2 and the analysis rules (Phase 2 is unchanged):**
- The same logger and time under a different fridge with an identical value is a silent duplicate in Phase 2. Phase 3 checks the fridge before ingesting and reports it as a conflict.
- An `ERR` reading ends an excursion or warming run like a gap, so it never joins two runs.
- **Weekly retrospective, not real time.** Summer uploads weekly and asks what happened to each fridge during the reporting week, so the dashboard opens on the latest week with readings (with a week selector) and analyses every reading in it. There is one card per fridge, while analysis stays per logger and fridge series. Every excursion stays visible after recovery, with the maximum temperature, spikes, warming, invalid readings and gaps. "No excursion observed" is reported only when at least 90% of the week was observed; otherwise the card says "insufficient data", and unobserved time is never called safe. There is no live status, freshness limit or clock input. The 90% figure and the Monday week start are **provisional business assumptions**, not derived facts (see questions below), and "observed" only means "a reading exists nearby", not "confirmed safe for every second in between".
- A run still open at a series' last reading is `end_of_data` only when nothing was recorded after it anywhere in the database; if a later reading exists outside the analysed week it is `end_of_period` instead. The two are never guessed as each other.
- Optional `Logger`, `Branch` and `Fridge` columns in weekly files are checked against the resolved mapping and never used to identify a file.

**Planned weekly upload.** Summer gets dozens of logger files a week, possibly with only `Time` and `Temp`. Per-file confirmation would become rubber-stamping, and 12 branch folders don't say which logger or fridge a file belongs to. Instead:

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
2. Which fridge is each logger in now, and which loggers moved in the historical file, with dates and times?
3. How are physical moves reported to her, and before the next upload?
4. What does a typical week look like: how many files, any with several loggers?
5. Besides TL-0231, are there other Fahrenheit loggers, specifically among the Haifa branch's loggers? The MVP will ask her to confirm the unit of any new Haifa logger rather than assume Celsius.
6. Is the 15-minute logging interval the same for every logger?
7. Which day does her reporting week start (Monday is assumed, Sunday is common in Israel), and is 90% observed time the right bar for "no excursion observed"? Both are provisional and easy to change.



## 4. Unfinished, and one more hour

**Implemented (Phase 3.1):** weekly retrospective analysis (`app/analysis.py`) and read-only API (`GET /api/lookups`, `/api/overview?week=`, `/api/series/{logger_id}/{fridge_id}?week=`). Constants: `THRESHOLD_C=5.0`, `GAP_MIN=30`, warming 4/1.0/0.5, provisional `WEEK_START_DAY=Monday` and `MIN_COVERAGE=0.90`. Coverage is an estimate from sample intervals, not continuous proof. `end_of_data` and `end_of_period` are distinct.

**Unfinished:** upload endpoints, the dashboard UI, and frontend tests. The app UI still shows backend health only.

**Tests:** 160 backend tests pass. No frontend tests.

**One more hour:** weekly upload review/import endpoints, since the dashboard needs data from real uploads next.

## 5. AI usage

**Mistake 1 (infrastructure):** the AI wrote the database healthcheck as `pg_isready -U $POSTGRES_USER`. Without `-d`, it probes a database named after the user, which doesn't exist, yet the container reported healthy.

**Detection:** the Postgres logs showed `FATAL: database "fridge_monitor" does not exist` about 100 times.

**Correction:** `docker-compose.yml` now uses `-d $${POSTGRES_DB}`, committed in `7bf242d`.

**Mistake 2 (planning, real-time vs retrospective):** when asked to redesign the Phase 3 dashboard around fridges, the AI invented a real-time "current status" model unprompted: a `FRESH_MAX_MIN` of 120 minutes, a server `?now=` parameter, and statuses like `active_excursion` and `stale`. Nothing in any instruction asked for a freshness clock; Summer's actual workflow is a weekly upload reviewed after the fact, so "is this fridge OK right now" was never a question she could ask.

**Detection:** caught in review, not by running code — the next instruction opened with "Correct the Phase 3 plan to use WEEKLY RETROSPECTIVE MONITORING, not real-time monitoring," spelling out that `FRESH_MAX_MIN`, `?now=`, and `active_excursion`/`stale` all had to go.

**Correction:** the freshness section of `docs/cursor/plan-phase-3.md` was replaced with a weekly report model (`WEEK_START_DAY`, `MIN_COVERAGE`, a week selector, `excursion_observed` / `warming_observed` / `insufficient_data` / `no_excursion_observed`). **Record:** this section is the documented review record, not independent Git proof. The mistake was introduced and corrected before anything was committed, so Git does not preserve the erroneous intermediate version. The only repository facts are that the plan was committed once in `370418c` without any freshness concept, and that the final plan has no `FRESH_MAX_MIN`, `?now=` or real-time status.

**Mistake 3 (planning, an unsupported branch-wide assumption):** Phase 2 reasonably inferred TL-0231 is Fahrenheit from its own values (38.3, 39 — see `git show 370418c:NOTES.md`, "TL-0231 is assumed Fahrenheit from its values"). When Phase 3 added automatic units for the historical import, the AI over-generalized this one evidenced fact into a blanket rule, "every other logger in the file is Celsius" — including other Haifa loggers, for which there is no such evidence; Haifa is precisely the branch with a known exception.

**Detection:** caught in review: "do not assume every additional Haifa logger is Celsius... require one-time verification for unknown units during historical import."

**Correction:** `docs/cursor/plan-phase-3.md` now applies the Celsius default only to a **non-Haifa** new logger; a new Haifa logger other than TL-0231 gets a required, un-prefilled C/F choice in the review, stored once and never re-asked. **Record:** as above, this is the documented review record, not Git proof: the blanket Celsius rule was introduced and corrected before any commit, so no commit preserves it. The only checkable facts are the committed Phase 2 note (`git show 370418c:NOTES.md`) and the final plan section "Units are predefined only where there is evidence" with the Haifa carve-out.