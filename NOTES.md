# Engineering Notes — Fridge Temperature Monitor

For the system architecture, data flow, and project structure, see the [Developer Guide](docs/DEVELOPER_GUIDE.md).

## 1. Time spent

Approximately 19 hours, including planning, implementation, testing, debugging and documentation.

## 2. Design decisions and assumptions

Most important first. Summer was unavailable during development, so a few values are assumed and listed as questions in section 3.

1. **High temperatures.** The limit is 5°C (strictly above). A single high reading (an isolated spike that then recovers) is separated from a longer event, because one spike does not necessarily mean the fridge has a serious problem. Two or more consecutive high readings are a sustained event. A one-reading event that ends in a gap, an invalid reading, or the end of recorded data is unconfirmed.

2. **Missing data.** Missing readings do not mean the fridge was safe. A gap of more than 30 minutes, or an `ERR`/invalid value, ends the current high-temperature or warming run. The report shows that information is missing. Unobserved time is never called safe. Coverage is an estimate from sample intervals; “no excursion observed” also requires at least 90% of the week observed (`MIN_COVERAGE=0.90`, provisional).

3. **Event duration.** Duration is how long a high temperature was *recorded*, a lower bound, not how long it is assumed to have lasted. One reading is shown as a single reading. If the run ends in a gap, an invalid value, the week boundary, or the end of recorded data, the label is “at least”. If recordings stop before recovery, the system says recovery was not confirmed.

   `end_of_period` is used only when the last in-week high reading sits at the week boundary *and* a later reading exists in the database. Truncated recordings earlier in the week are `end_of_data` even if a later week has data.

4. **Gradual warming.** A warning is shown when at least four consecutive valid readings all rise, the total rise is at least 1.0°C, and no single step is more than half the total — even if the temperature is still below 5°C. That can flag a fridge that may be starting to fail.

5. **Logger movements.** Loggers and fridges are separate: a logger can move. Each reading keeps the fridge named on that row. Unknown move dates stay NULL and are never invented. When the correct fridge cannot be determined (for example TL-0417 under two undated assignments), the user must confirm it. An unreported physical move cannot be detected from temperatures alone.

6. **File matching.** Filenames are not assumed to contain the correct logger number. A `TL-` token in the name, or one consistent Logger column, is a suggestion. The user reviews and corrects assignments before import. Mixed or conflicting cells stay blocking.

7. **Different Excel formats.** Column name aliases, column order, native Excel datetimes, `YYYY-MM-DD HH:MM`, and day-first `DD/MM/YYYY HH:MM` are supported because files from different branches may not look the same.

8. **Temperature units.** The old Haifa logger TL-0231 is assumed Fahrenheit because its example readings are 38.3 and 39.0. Summer has **not** confirmed this. Reports store and show Celsius. Other Haifa loggers are **not** assumed Fahrenheit: a new Haifa logger other than TL-0231 needs an explicit C/F choice before historical import. New non-Haifa loggers default to Celsius. Units are never guessed from magnitudes.

   Historical **source units** (the numbers in this Excel file) are separate from the logger’s stored native unit. An existing logger’s native unit is never overwritten. Weekly files still convert using the stored native unit.

9. **Duplicate readings.** The unique key is logger and time. An identical repeat is skipped. If values or fridges disagree, the conflict is reported and the first stored reading is kept.

10. **Historical and weekly files.** Initial Setup loads one combined historical file (logger, city, fridge, time, temperature). Weekly Upload loads Time/Temp logger files. Review is a dry run. Historical import is atomic. Weekly import can succeed file by file so one bad logger does not block other branches.

11. **Mobile-friendly design.** A responsive web app, not a native app, because Summer mainly uses her phone. It also works on a computer without a separate install. Docker Compose and PostgreSQL run on a laptop without accounts or paid services and keep imported data after restarts.

12. **Dashboard layout.** Fridges are grouped by branch (A–Z). Branch and week filters, KPI counters, and red/amber/green/neutral findings help find problems quickly. Cards already show timestamps for high-temperature events (start times and recovery wording from the overview `excursions` list). Gradual warming is detected, but its date and time are not yet displayed on the Dashboard cards. Fridge Details (opened from a card, not a third main-nav item) has daily charts. This is a weekly retrospective report, not live monitoring. Navigation uses `useState` (Dashboard / Weekly Upload / Initial Setup), so there are no deep links.

13. **Supported file types.** Uploads are `.xlsx` only. Other formats would need more testing and were not required by the examples.

14. **Sample data.** Only 16 example rows were provided, not the full ~3,000-row file. The sample has 15 unique readings (one in-file duplicate, one `ERR` stored as NULL with the raw text kept). That sample plus extra tests cover other situations. Extreme values such as 150 are stored as given; there is no range filter.

15. **Local setup.** Docker Compose and PostgreSQL, as above. Migrations and the sample seed are manual (`alembic upgrade head`, then `python -m app.seed`). Reporting weeks are ISO 8601 Monday–Sunday (`WEEK_START_DAY=0`), provisional until Summer confirms.

Raw invalid values are preserved (`raw_value`, `raw_timestamp`). `ERR`/blank/NaN become NULL temperature. Commits live in the upload/seed caller, not in the ingestion service.

## 3. Questions for Summer before going live

Summer was unavailable during development. These are questions for **before real-world use**, not blockers that stopped implementation.

1. How often do your temperature loggers take readings? Is it usually every 15 minutes, or does it vary between devices?

2. How long can a fridge stay above 5°C before someone needs to take action? I understand that a brief rise followed by a return to normal is not a problem.

3. When would you consider a fridge to be warming up too much? Should we warn you whenever the temperature keeps rising, even if it is still below 5°C?

4. Do you know when loggers were moved between fridges? This would help us make sure the readings belong to the correct fridge.

5. Does the old logger in Haifa (TL-0231) actually use Fahrenheit? I assumed so based on the example readings, but I'd like to confirm.

6. Have you already converted any temperatures in your Excel files? We want to make sure temperatures are not converted twice.

7. When readings are missing, how long should the gap be before you want to know about it?

8. What does the health inspector usually need to see? Would the temperature history and the times of any problems be enough, or would a downloadable report help?

9. Would you also want alerts when a fridge starts having problems, rather than only reviewing the weekly reports?

10. Would you prefer your weekly reports to start on Sunday or Monday? I currently use Monday.

11. Could you ask branch managers to include the logger number in each weekly Excel filename? For example: `TL-0417_2026-10-12.xlsx`. This would help the app identify the logger automatically, so you would only need to check its fridge assignment when necessary.

## 4. Implemented, remaining limitations, and one more hour

**Implemented:** four-table schema and migration; sample seed; weekly retrospective analysis; read APIs (`/api/lookups`, `/api/overview`, `/api/series/...`); historical and weekly review/import APIs; Weekly Dashboard (week and branch filters, KPI counters, event details including timestamps from overview excursions); Fridge Details with temperature charts; Weekly Upload UI; Initial Setup UI for one combined historical Excel file, including explicit historical source-unit selection separate from native logger units.

**Remaining limitations:**

- Historical import accepts `.xlsx` only.
- Misspelled fridge names cannot be renamed in the app; correct them in Excel and import again.
- A logger seen under more than one fridge may need an explicit move in Weekly Upload before later weekly files can be assigned automatically.
- This is a retrospective weekly report, not live temperature monitoring.
- Week start (Monday) and 90% coverage are provisional.
- A stale Docker `node_modules` volume can omit Vitest until the volume is recreated (`npm ci` with the lockfile is the intended install).

**Tests (last verified):** 274 backend tests (`pytest`); 116 frontend tests (`npm test` / Vitest); frontend production build succeeded.

### Possible Future Improvements

These are future improvements, not implemented features.

1. **Downloadable reports:** Allow Summer to download a report showing temperature history, dates, and durations of problems, so she can share it with the health inspector.

2. **Immediate alerts:** The current app provides weekly reports. In the future, Summer could receive alerts when a fridge starts having problems, instead of waiting for the weekly review.

3. **Configurable reporting rules:** Allow Summer to adjust the reporting week, warming thresholds, and missing-reading rules after confirming what works best for her.

4. **Easier fridge name corrections:** Allow users to correct fridge names directly in the app instead of editing the Excel file and importing it again.

5. **Additional file formats:** Support CSV or older Excel files if branch managers need them. Currently, the app supports `.xlsx` files only.

6. **Easier logger identification:** Branch managers could use consistent filenames, such as `TL-0417_2026-10-12.xlsx`, to reduce manual selection during weekly uploads. Fridge assignments would still need checking when a logger has moved.

7. **Gradual warming timestamps:** Show the actual date and time of gradual warming directly on Dashboard fridge cards, so Summer can quickly see when it happened without opening Fridge Details.

### With one more hour

My priority would be to add a downloadable historical temperature report for the health inspector, making it easier for Summer to share the exact dates, times and durations of problems.

## 5. AI tools and lessons learned

### How I Worked with AI

I used ChatGPT and Cursor to help with planning, writing code, creating tests, and debugging.

I divided the project into small phases and gave the AI clear, focused tasks instead of asking it to build everything at once.

I reviewed its suggestions, made the important design decisions myself, and rejected assumptions that were not supported by Summer's requirements.

I used automated tests and manual testing, including on mobile, to check that the application actually worked. When I found problems, I fixed them and added regression tests where needed.

I also managed Git commits and pushes myself to keep control over the changes.

AI helped me work faster, but I remained responsible for the decisions and final result.

**1. PostgreSQL healthcheck (AI-generated, found in logs).** The AI wrote `pg_isready -U $POSTGRES_USER`. Without `-d`, Postgres probes a database named after the user, which does not exist, yet the container still reported healthy.

**Detection:** Postgres logs showed `FATAL: database "fridge_monitor" does not exist` about 100 times.

**Correction:** `docker-compose.yml` uses `-d $${POSTGRES_DB}`. Evidence: commit `7bf242d`.

**2. Real-time monitoring proposal (AI planning, caught in review).** When asked to redesign the Phase 3 dashboard around fridges, the AI invented a real-time “current status” model: `FRESH_MAX_MIN` of 120 minutes, a server `?now=` parameter, and statuses like `active_excursion` and `stale`. Summer’s workflow is a weekly upload reviewed after the fact.

**Detection:** plan review — the next instruction required weekly retrospective monitoring, not real-time.

**Correction:** the Phase 3 plan uses a weekly report (`WEEK_START_DAY`, `MIN_COVERAGE`, week selector, `excursion_observed` / `warming_observed` / `insufficient_data` / `no_excursion_observed`). **Record:** the mistaken version was introduced and corrected before any commit, so Git does not preserve it. The plan was committed once in `370418c` without a freshness clock.

**3. Unsupported Celsius assumption (AI planning, caught in review).** Phase 2 reasonably treated TL-0231 as Fahrenheit from 38.3 and 39 (`git show 370418c:NOTES.md`). When Phase 3 added historical units, the AI treated every other logger — including other Haifa loggers — as Celsius, without evidence.

**Detection:** review required not assuming extra Haifa loggers are Celsius, and one-time verification for unknown units.

**Correction:** Celsius default applies only to a **new non-Haifa** logger; a new Haifa logger other than TL-0231 needs an explicit C/F choice. **Record:** the blanket Celsius rule was never committed. Checkable facts are the Phase 2 note (`git show 370418c:NOTES.md`) and the final plan’s “units only where there is evidence” Haifa carve-out.

**4. Truncated-week event wording (bug found in manual testing).** A Monday-last high-temperature event was described as continuing through Sunday. The backend used `end_of_period` whenever any later-week data existed, even when this week’s recordings had already stopped.

**Correction:** `end_of_data` vs `end_of_period` as in section 2; frontend wording updated; backend and frontend regression tests added. Evidence: commit `fd7efc8`.

**5. Multi-file upload index (bug found in tests).** After remove or partial import, selections keyed by file index could attach the previous file’s logger to the next slot.

**Correction:** remaining files are remapped by identity; regression tests cover it.

**6. Docker / Vitest (environment).** A stale `node_modules` volume omitted Vitest. `npm ci` with `package-lock.json` is the intended install; an old volume can still need recreating.

**Startup UX:** skeleton placeholders (no fake readings) and a few short retries for proxy connection failures; application 500s still show the error and Try again.
