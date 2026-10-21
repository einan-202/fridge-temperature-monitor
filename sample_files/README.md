# Sample Excel files

These folders hold **synthetic test workbooks**. They are not real bakery measurements.

Each file under `00_first_set`, `01_supported_now`, `02_aliases_after_change`, and `03_reject_safely` is a **separate weekly logger export**. Use those in **Weekly Upload**, not Initial Setup (Initial Setup expects one combined historical file). A larger historical demo file for Initial Setup is in `historical/` (see below).

**Importing files changes your local database.** Review first. Import only files you intend to keep. Do not run the sample seed command against these weekly files.

`00_first_set/TEST_GUIDE.txt` is kept as extra notes for that folder.

---

## Weekly Upload vs review-only

| Folder | Use |
| --- | --- |
| `00_first_set` | Suitable for Weekly Upload (review, then import if the file is ready). |
| `01_supported_now` | Suitable for Weekly Upload. |
| `02_aliases_after_change` | Suitable for Weekly Upload. |
| `03_reject_safely` | **REVIEW ONLY.** Use these to check that the app rejects unsafe files. **Do not import them.** |
| `historical` | Combined historical demo for **Initial Setup**, not Weekly Upload. |

---

## `00_first_set` — 8 Excel files + `TEST_GUIDE.txt`

Week around 12–18 October 2026. Header row is row 1.

| File | Headers in the workbook | What it is for |
| --- | --- | --- |
| `01_TL-0388_Rishon_Time_Temp.xlsx` | Time, Temp | Existing logger TL-0388 from the filename. Gradual warming and high temperatures. |
| `02_TL-0512_Jerusalem_Temp_Time.xlsx` | Temp, Time | Reversed columns. Includes an `ERR` value. |
| `03_TL-0231_Haifa_Fahrenheit.xlsx` | Time, Temp | Existing Haifa logger TL-0231. Raw values in the Fahrenheit range, plus an `ERR`. |
| `04_logger_in_column_generic_filename.xlsx` | Temp, Logger, Time | Generic filename. Logger TL-0388 is in a Logger column. |
| `05_no_logger_anywhere.xlsx` | Time, Temp | No logger code in the filename or the sheet. You must choose a logger by hand. |
| `06_TL-0417_TelAviv_Display2_extra_columns.xlsx` | Fridge, Branch, Temp, Time, Logger | Moved logger TL-0417, plus extra columns (fridge and branch). |
| `07_TL-0777_Haifa_NEW_Temp_Time.xlsx` | Temp, Time | New Haifa logger TL-0777. Confirm units before import. |
| `08_TL-0512_duplicates_and_conflict.xlsx` | Logger, Time, Temp | Same logger twice at `2026-10-16 12:00` (same temperature) and twice at `2026-10-16 12:45` (different temperatures). |

See `TEST_GUIDE.txt` in this folder for row counts and review notes.

---

## `01_supported_now` — 6 Excel files

Common weekly layouts the app is meant to accept after review.

| File | Headers in the workbook | What it is for |
| --- | --- | --- |
| `01_TL-0388_standard_Time_Temp.xlsx` | Time, Temp | Standard Time/Temp columns. |
| `02_TL-0388_reversed_Temp_Time.xlsx` | Temp, Time | Reversed Temp/Time columns. |
| `03_TL-0512_Timestamp_Temperature.xlsx` | Timestamp, Temperature | Timestamp/Temperature headers. |
| `04_generic_name_logger_column.xlsx` | Logger, Time, Temp | Generic filename; logger TL-0388 identified from a column. |
| `05_TL-0512_case_whitespace.xlsx` | `  TEMPERATURE `, ` time ` | Differences in letter case and whitespace. |
| `06_TL-0512_extra_columns.xlsx` | Battery %, Temp, Notes, Time | Additional irrelevant columns. |

---

## `02_aliases_after_change` — 4 Excel files

Other header names for time, temperature, logger, and Fahrenheit.

| File | Headers in the workbook | What it is for |
| --- | --- | --- |
| `07_TL-0512_DateTime_TemperatureC.xlsx` | DateTime, Temperature (°C) | DateTime + Celsius temperature header. |
| `08_TL-0512_DateSlashTime_TempC.xlsx` | Date/Time, Temp C | Date/Time + Temp C. |
| `09_generic_logger_id_header.xlsx` | Logger ID, Timestamp, Temperature | Logger ID header (generic filename; logger TL-0388 in the column). |
| `10_TL-0231_Fahrenheit_header.xlsx` | Time, Temperature (°F) | Explicit Fahrenheit temperature header for TL-0231. |

---

## `03_reject_safely` — 4 Excel files — REVIEW ONLY

These files are meant to fail review. **Do not import them.** They still change nothing until you import, but they are not safe weekly data.

| File | Headers in the workbook | What it is for |
| --- | --- | --- |
| `11_TL-0388_unit_conflict_F.xlsx` | Time, Temperature (°F) | Temperature unit conflict (Fahrenheit header on logger TL-0388). |
| `12_TL-0388_unknown_headers.xlsx` | Recorded At, Value | Unsupported column headers. |
| `13_TL-0388_ambiguous_temperature_headers.xlsx` | Time, Temp, Temperature | Two temperature columns with different values. |
| `14_TL-0512_date_only.xlsx` | Date, Temperature | Date-only values without reading times. |

---

## Historical Demo Dataset

[`historical/fridge_seed_alternative_oct2026.xlsx`](historical/fridge_seed_alternative_oct2026.xlsx) is a **larger synthetic dataset for demonstration**. It is **optional** and separate from the original 16-row seed used in first-time setup.

Use it in **Initial Setup**, not Weekly Upload. The workbook is one combined historical file with columns Logger, Branch, Fridge, Time, and Temp.

After review, it can be used to demonstrate temperature charts, high-temperature events, and missing readings on the Dashboard and Fridge Details. Confirm each logger’s temperature units before importing.

Importing this file changes your local database. It does not replace the seed command.
