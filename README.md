# Fridge Temperature Monitor

A weekly fridge temperature report for bakery operations: React frontend, FastAPI backend, and PostgreSQL, all run with Docker Compose.

**Current status:** the app includes a weekly Dashboard (branch and week filters, KPI counters, high-temperature event details), Fridge Details with temperature charts, Weekly Upload for logger Excel files, and Initial Setup for a historical combined Excel file.

## Prerequisites

- Docker
- Docker Compose (`docker compose`)

## First-Time Setup

Open a terminal and run these commands in order:

```bash
git clone https://github.com/einan-202/fridge-temperature-monitor.git
cd fridge-temperature-monitor
cp .env.example .env
```

Optional — if Docker Desktop is installed but not running:

```bash
docker desktop start
```

You can also launch Docker Desktop manually if this command is unavailable. Docker Desktop must be running before Docker Compose.

```bash
docker compose up -d --build
```

Wait until the containers are healthy (`docker compose ps` should show them as running/healthy), then run the required Alembic migrations:

```bash
docker compose exec backend alembic upgrade head
```

Seeding is optional and only loads demo data. Skip it if you prefer to import data later in Initial Setup (Initial Setup works without seed after migrations):

```bash
docker compose exec backend python -m app.seed
```

The seed command is manual (it does not run when Docker starts). It loads the bundled 16-row Excel sample (15 unique readings) so the Dashboard has demonstration data. A separate historical Excel file can be imported later in Initial Setup.

Open the app: [http://localhost:5173](http://localhost:5173)

| Service  | URL                   |
| -------- | --------------------- |
| Frontend | http://localhost:5173 |
| Backend  | http://localhost:8000 |
| API docs | http://localhost:8000/docs |

## Starting the App Again

```bash
docker compose up -d
```

You do not need to migrate or seed again unless you removed the database volume.

## Stopping the App

```bash
docker compose down
```

WARNING: `docker compose down -v` permanently deletes the database volume and all stored data.

## How to Use

- **Dashboard:** open http://localhost:5173 for the weekly fridge report. Filter by week and branch, read the KPI counters, and open a fridge card for high-temperature event details. Seeded sample data is a small demo week.
- **Fridge details:** tap a fridge card for that week’s temperature charts and findings.
- **Weekly Upload:** review and import this week’s logger Excel files (`.xlsx`).
- **Initial Setup:** review and import one historical combined Excel file (logger, city, fridge, time, temperature), and confirm each logger’s temperature units before importing.

### Opening the App on Your Phone

1. Make sure the app is running on your computer.
2. Connect your computer and phone to the same Wi-Fi network.
3. Find your computer's local IP address:
   - Mac: System Settings → Wi-Fi → Details → IP Address.
   - Windows: Open Command Prompt, run `ipconfig`, and find "IPv4 Address" under the Wi-Fi adapter.
4. Open a browser on your phone and enter:

   `http://YOUR-COMPUTER-IP:5173`

   Example: `http://192.168.1.23:5173`

No mobile app installation is required.

## Current Limitations

- Historical import accepts `.xlsx` files only (not PDF, CSV, `.xls`, or Google Sheets).
- Misspelled fridge names cannot be renamed in the app; correct them in Excel and import again.
- A logger that appeared under more than one fridge may need an explicit move recorded in Weekly Upload before later weekly files can be assigned automatically.
- This is a retrospective weekly report, not live temperature monitoring.

## Developer Tests (optional)

```bash
docker compose exec backend pytest
docker compose exec frontend npm test
docker compose exec frontend npm run build
```

`npm test` runs the frontend Vitest suite. `npm run build` type-checks and builds the production frontend.

## Developer Guide

For a quick overview of the architecture, data flow, project structure, and where to make changes, see the [Developer Guide](docs/DEVELOPER_GUIDE.md).

More design notes: [NOTES.md](NOTES.md). Plans: [docs/cursor/plan-phase-1-scaffold.md](docs/cursor/plan-phase-1-scaffold.md), [docs/cursor/plan-phase-2.md](docs/cursor/plan-phase-2.md), [docs/cursor/plan-phase-3.md](docs/cursor/plan-phase-3.md), [docs/cursor/plan-phase-4.md](docs/cursor/plan-phase-4.md).

## Sample Excel Files

Additional synthetic Excel files for testing Weekly Upload, including different formats and invalid inputs, are available in [sample_files/](sample_files/README.md).

For a more realistic demonstration, you can import the larger synthetic historical Excel file through Initial Setup. See [sample_files/README.md](sample_files/README.md) for details. The file is [sample_files/historical/fridge_seed_alternative_oct2026.xlsx](sample_files/historical/fridge_seed_alternative_oct2026.xlsx). First-time setup still loads the original 16-row seed (15 unique readings).
