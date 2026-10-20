# Fridge Temperature Monitor

A full-stack app for monitoring fridge temperature loggers: a React + TypeScript (Vite) frontend, a FastAPI backend, and a PostgreSQL database, run together with Docker Compose.

> **Status:** the stack, the database schema, data ingestion (XLSX) and the sample seed work. Upload endpoints, logger moves, the dashboard and the temperature analysis are **not implemented yet**. See [How to Use](#how-to-use) and [NOTES.md](NOTES.md).

## Prerequisites

- Docker with Docker Compose (`docker compose`)

## Quick Start

```bash
cp .env.example .env
docker compose up --build
```

In a second terminal, once the containers are healthy, create the tables and load the sample data:

```bash
docker compose exec backend alembic upgrade head
docker compose exec backend python -m app.seed
```

The seed reads the single `.xlsx` in `sample_data/` (or a path you pass) and is safe to run again: a second run inserts nothing.

The services are available at:

| Service  | URL                        |
| -------- | -------------------------- |
| Frontend | http://localhost:5173      |
| Backend  | http://localhost:8000      |
| API docs | http://localhost:8000/docs |

To stop: `docker compose down` (add `-v` to also delete the database volume).

## How to Use

**Works today**

- Open http://localhost:5173. The page shows the backend status.
- `curl -i http://localhost:8000/health` returns `200` with `{"status": "ok", "database": "connected"}`, or `503` if PostgreSQL is unreachable.
- The seed command above loads the 16 sample rows into the database (inspect them with `psql` or any SQL client).
- Other devices on the same network can open `http://<your-machine-ip>:5173`.

**Not implemented yet**

- Uploading XLSX files, recording logger moves, the dashboard, and the temperature analysis (excursions above 5 °C, durations, warming trends, data gaps). The planned design is in [docs/cursor/plan-phase-3.md](docs/cursor/plan-phase-3.md).

## Run Tests

Backend tests run inside the running `backend` container:

```bash
docker compose exec backend pytest                         # all backend tests
docker compose exec backend pytest -m "not integration"    # unit tests only, no database needed
docker compose exec backend pytest -m integration          # database tests
```

Integration tests use a separate `*_test` database and never touch your data. There are no frontend tests yet.

## More

Design decisions, trade-offs, open questions and AI usage are in [NOTES.md](NOTES.md).
