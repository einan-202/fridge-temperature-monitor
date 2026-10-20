# Engineering Notes — Fridge Temperature Monitor

## 1. Time spent

Approximately 11 hours so far, including planning, implementation, testing, debugging, and documentation.

## 2. Key decisions and trade-offs

**Implemented through Phase 3.3A:** four-table schema and migration; normalization and ingestion; sample seed; weekly retrospective analysis and read APIs; historical/weekly upload APIs; weekly fridge dashboard UI.

**Why these choices (brief):**

- **Weekly retrospective analysis** matches Summer’s weekly upload workflow and avoids misleading real-time status claims.
- **Historical imports are atomic** so a failed first load cannot leave a half-built initial dataset.
- **Weekly imports commit per valid file** so one problematic logger does not block other branches.
- **Unknown logger move dates are not invented** because that could attach readings to the wrong fridge.

**Haifa temperature units (per logger, not per branch):**

- Summer refers to “the old logger in Haifa” (singular), not every Haifa logger.
- The sample identifies **TL-0231** with values 38.3 and 39.0, which only make sense as Fahrenheit; `HISTORICAL_LOGGER_UNITS` / seed both set TL-0231 to `F`.
- Units are configured **per logger**: TL-0231 is predefined as Fahrenheit; other Haifa loggers are **not** assumed Fahrenheit. A new Haifa logger other than TL-0231 stays unresolved until `logger_units` supplies an explicit `C` or `F` (import is blocked until then). Non-Haifa new loggers default to Celsius.
- **Ambiguity:** Summer’s combined historical Excel may already contain Celsius values. Treating those as Fahrenheit would convert again and store wrong °C.
- **Current behaviour:** conversion always follows the logger’s stored unit (`to_celsius(..., logger.unit)`). There is no separate “already converted / skip conversion” flag. For a *new* logger, `logger_units` can override the unit on first import (including setting TL-0231 to `C` if the sheet is already Celsius). An *existing* logger’s unit is never changed on re-import. Units are never inferred from temperature magnitudes.

**Supporting future changes:**

- **Implemented:** units are per logger (not per city), so devices may use different scales; dated moves preserve the correct fridge for historical readings; Unknown move dates are not invented; unknown Haifa logger units require confirmation, while new non-Haifa loggers default to Celsius.
- **Limitation (unresolved):** a combined historical sheet may already hold Celsius values from a Fahrenheit logger. The system has only one stored unit per logger—no separate source unit per import. Setting that unit to `C` for a converted sheet would skip conversion correctly for that file, but later original Fahrenheit files for the same logger would then be stored without conversion (wrong °C).
- **Future improvement (not built):** separate the logger’s native unit from each import’s source unit so historical and weekly uploads can both convert correctly.

**Phase 2 (ingestion):**

- Each reading keeps its own `fridge_id`. Unknown assignment dates stay NULL and are never invented (TL-0417 moved, but nothing says when).
- `Decimal` parsing. `ERR`/blank/NaN become NULL with the raw text kept. No thresholds: 150 is stored as given.
- Dedup on (logger, time): first row wins, differing repeats are reported as conflicts.
- `Time`/`Temp`-only files need the logger and fridge passed explicitly; a fridge is never guessed.
- Commits live in the caller, not in the ingestion service.
- TL-0231 is Fahrenheit per the assignment data (its sample values 38.3 and 39 agree); the file has no unit column.

**Phase 3 analysis (backend):** weekly retrospective, not real time. Excursions strictly above 5 °C stay visible after recovery. An `ERR` ends a run like a gap. Coverage is an estimate from sample intervals; unobserved time is never called safe. `end_of_data` vs `end_of_period` are distinct. Provisional constants: Monday week start, `MIN_COVERAGE=0.90`.

**Phase 3.2 upload APIs** (`POST /api/uploads/review`, `/import`): same Phase 2 ingestion; review is a dry run (rolled back); historical import is atomic; weekly import commits per ready file. Filename logger detection, per-reading fridge resolution, staged moves and new loggers, fridge-conflict pre-check, Haifa unit confirmation for unknown historical loggers. No React upload screens yet.

**Phase 3.3A dashboard UX:**

- Fridge-first weekly report from `GET /api/overview` only (no `/api/series` in this phase).
- Cards grouped by city (A–Z); within a city, numeric logger code then fridge name. One card per fridge; multiple loggers listed on the card.
- Findings derived from overview counts/classifications only (sustained → red, recovered spike → green, invalid/gap → amber, insufficient → neutral). No temperature analysis in React.
- Desktop: city groups in a multi-column grid; multi-fridge cities span two columns; outer card heights equalized across cities in a row via the parent stretch chain; findings sit near the bottom with natural (not forced) status-box height.
- Mobile: compact three-counter row with short labels; full-width cards; natural heights; explicit typography scale; `text-size-adjust: 100%`.
- Cards are not clickable yet (detail view is planned later).

**Still planned (not built):** Initial Setup and Weekly Upload UI screens; fridge detail panel and charts; richer card timestamps once overview exposes them (see Unfinished). Design for the upload workflows remains in `docs/cursor/plan-phase-3.md`.

**Limitation:** an unreported physical move cannot be detected reliably from temperatures. That logger's files keep going to its last known fridge until a move is recorded.

## 3. Questions for Summer before production

1. How does a logger file identify its logger: file name (exact pattern), column, or not at all?
2. Which fridge is each logger in now, and which loggers moved in the historical file, with dates and times?
3. How are physical moves reported to her, and before the next upload?
4. What does a typical week look like: how many files, any with several loggers?
5. Besides TL-0231, are there other Fahrenheit loggers, specifically among the Haifa branch's loggers? The MVP will ask her to confirm the unit of any new Haifa logger rather than assume Celsius.
6. Does the combined historical Excel contain original logger units (so TL-0231 still needs Fahrenheit conversion), or has she already converted temperatures to Celsius in that sheet?
7. Is the 15-minute logging interval the same for every logger?
8. Which day does her reporting week start (Monday is assumed, Sunday is common in Israel), and is 90% observed time the right bar for "no excursion observed"? Both are provisional and easy to change.

## 4. Unfinished, and next steps

**Implemented:**

- Phase 3.1: `app/analysis.py`, `GET /api/lookups`, `/api/overview`, `/api/series/...`.
- Phase 3.2: `app/upload.py`, `POST /api/uploads/review` and `/import`.
- Phase 3.3A: weekly dashboard (header, week selector, summary counters, city-grouped fridge cards).

**Unfinished:**

- React screens for Initial Setup (historical import) and Weekly Upload.
- Fridge detail view and temperature charts.
- Overview fields the mockup wanted but cards omit: excursion start (“First detected”), end/recovery time, duration label, gap start/end/minutes, invalid reading timestamp/raw value. Do not invent these in the UI; extend the API only with approval.

**Tests:** 209 backend tests pass; 16 frontend tests pass (`npm test` in the frontend container).

### With one more hour

With one more hour, I would prioritize implementing and testing the basic end-to-end Weekly Upload UI: select multiple files, review problems, resolve logger mappings, and import valid files. This directly addresses Summer's weekly manual workload. I would defer charts and additional visual polish.

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
