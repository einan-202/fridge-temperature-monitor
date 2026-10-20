# Fridge Temperature Monitor

A weekly fridge temperature report for bakery operations: React frontend, FastAPI backend, and PostgreSQL, all run with Docker Compose.

**Current status:** you can start the stack, load sample data, and open the weekly fridge dashboard. Upload screens in the UI and fridge detail charts are not built yet.

## Prerequisites

- Docker
- Docker Compose (`docker compose`)

## First-Time Setup

From the project root, run these commands in order (one terminal is enough):

```bash
cp .env.example .env
docker compose up -d --build
```

Wait until the containers are healthy (`docker compose ps` should show them as running/healthy), then:

```bash
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.seed
```

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

- Open http://localhost:5173 for the weekly temperature report: fridge cards by city, a week selector, and summary counters.
- The seeded sample data is a small demo week so you can evaluate the dashboard immediately.
- Other devices on the same network can use `http://<your-machine-ip>:5173`.

## Current Limitations

- No upload screens in the UI yet (historical import and weekly bulk upload APIs exist for developers).
- No fridge detail view or temperature charts.
- Dashboard cards use summary fields from the overview API; some event timestamps shown in design mockups are not available there yet and are omitted rather than guessed.

## Developer Tests (optional)

```bash
docker compose exec backend pytest
docker compose exec frontend npm test
```

More design notes: [NOTES.md](NOTES.md). Planned Phase 3 design: [docs/cursor/plan-phase-3.md](docs/cursor/plan-phase-3.md).
