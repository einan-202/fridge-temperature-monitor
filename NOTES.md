# Engineering Notes — Fridge Temperature Monitor

This document captures the reasoning behind the choices made so far: the **initial scaffold** and the **backend database connectivity** step that followed it (both complete). The Phase 2 schema/migrations step is also in place (see below). Ingestion, business endpoints, the `/api/status` endpoint, and frontend tests are still pending. For the full, approved multi-step plan these steps are drawn from, see [docs/cursor/plan-phase-1-scaffold.md](docs/cursor/plan-phase-1-scaffold.md).

## Stack choices

- **Backend: FastAPI + Uvicorn.** Lightweight, async-capable, has excellent auto-generated docs (`/docs`) out of the box, and is a natural fit for a small API-first service. `uvicorn[standard]` pulls in the extras needed for good dev-mode behavior (e.g. `watchfiles` for `--reload`, `httptools`/`uvloop` where available).
- **Frontend: React + TypeScript + Vite.** Vite's dev server gives fast HMR and, importantly for this project, a built-in reverse-proxy capability (`server.proxy`) that's central to the LAN/mobile-access design below.
- **Database: PostgreSQL 16 (Alpine image).** Standard, well-supported, and the Alpine variant is small and ships useful CLI tooling (`pg_isready`) out of the box.
- **Orchestration: Docker Compose.** Three services (`db`, `backend`, `frontend`) with explicit health checks and `depends_on: condition: service_healthy` chains so the stack comes up in a well-defined order.

## Database connectivity first, business logic deferred

**Current state:** the backend connects to PostgreSQL. The four-table schema and its models now exist (see "Phase 2: schema and migrations" below); ingestion, seed, normalization and business endpoints are still deferred.

- `backend/app/database.py` creates a SQLAlchemy engine (`psycopg2-binary` driver, `pool_pre_ping=True`) from the `DATABASE_URL` environment variable, and exposes `check_connection()`, which runs `SELECT 1` and returns `False` on any failure.
- `GET /health` uses it and returns `{"status": "ok", "database": "connected"}`, or HTTP **503** with `{"status": "error", "database": "unreachable"}` when the database can't be reached. The backend's Docker healthcheck calls this endpoint, so a lost database connection shows up as an unhealthy backend.
- `DATABASE_URL` is not hardcoded in app code. `docker-compose.yml` builds it from the `POSTGRES_*` values in `.env`, and `db` is the Docker-network hostname of the database service. `.env` / `.env.example` document this.
- `requirements.txt` now includes `sqlalchemy` and `psycopg2-binary`. Test tooling (`pytest`, `httpx`) lives in `requirements-dev.txt`.
- Pytest covers it: unit tests for `/health` (with `check_connection` mocked, so they pass without a database) and integration tests against the real PostgreSQL container, marked `integration`.

**Why this was split from the scaffold step (original decision, still valid):** the scaffold step was scoped to proving three containers build and start cleanly, health checks pass, hot reload works, and the frontend/backend/proxy chain works end-to-end. Connecting the database was then a separate step with its own small, independently verifiable diff. That keeps "does the container network/compose setup work" apart from "does the DB driver/connection/query logic work."

The tables and models came later, in Phase 2 (see below). What is still pending is listed in "Limitations and next steps" and at the end of this document.

## Testing

The backend has **26 passing Pytest tests** (last full run: `26 passed`; 2 unit and 24 integration), written alongside the features rather than retrofitted:

- **Unit (2), `backend/tests/test_health.py`:** `/health` returns 200 when the database check succeeds, and 503 when it fails. `check_connection` is monkeypatched, so these need no database.
- **Integration (2), `backend/tests/test_database.py`, marked `integration`:** `check_connection()` and `/health` against the real PostgreSQL container, so they exercise the actual connection.
- **Integration (4), `backend/tests/test_migrations.py`:** upgrade creates exactly the four tables (no `branches`), downgrade removes them and upgrade works again (on a throwaway database), the shared test DB is at head, and the expected constraints/indexes exist.
- **Integration (18), `backend/tests/test_models.py`:** the DB-enforced constraints listed below (unique/check/FK/NOT NULL, `NULLS NOT DISTINCT`, case-insensitive fridge identity, NULL and extreme temperatures).

Run them inside the backend container, where the real `db` hostname and `DATABASE_URL` are available:

```
docker compose exec backend pytest                      # all 26
docker compose exec backend pytest -m "not integration" # 2 unit tests, no database needed
docker compose exec backend pytest -m integration       # 24 database tests
```
 Test dependencies are in `requirements-dev.txt`, separate from runtime requirements. When verifying, a run that collects zero tests (Pytest exit code 5) is not counted as a pass.

**Frontend tests (Vitest + React Testing Library) are still pending.**

## Phase 2: schema and migrations

Only the database schema, models, Alembic migration and their tests are done so far. Ingestion, seed, normalization and endpoints are still pending (see "Limitations and next steps" at the end of this section).

### The four tables

- **`fridges`**: `id`, `branch_name`, `name`.
- **`loggers`**: `id`, `code` (unique), `unit` (`C` or `F`, the unit the logger reports in).
- **`logger_assignments`**: `id`, `logger_id`, `fridge_id`, `assigned_from` and `assigned_to` (both nullable).
- **`temperature_readings`**: `id`, `logger_id`, `fridge_id`, `measured_at`, `temperature_c` (nullable), plus the originals `raw_timestamp`, `raw_value`, `source_file`, `source_row`.

### Key design decisions

- **Four tables, no `branches` table.** `fridges`, `loggers`, `logger_assignments`, `temperature_readings`. A branch has no attributes of its own, so it is just `fridges.branch_name`. A fridge is identified by branch plus name (`Dairy` exists in two branches), enforced by a functional unique index on `(lower(branch_name), lower(name))`. Whitespace trimming/collapsing is a later normalization step; the index only handles casing.
- **Invalid readings are `temperature_c IS NULL`, not a status column.** `raw_value` (plus `raw_timestamp`, `source_file`, `source_row`) preserves the original text, so `ERR` is stored as NULL with raw value `ERR` and explains itself.
- **No rejection thresholds.** `temperature_c` is plain `NUMERIC` with no precision limit and no range `CHECK`; 150 or -80 are stored as given. Plausibility is an analytics concern.
- **`UNIQUE (logger_id, measured_at)` is the dedup guarantee.** A logger cannot have two readings at the same instant.
- **Naive local timestamps.** All timestamps are `TIMESTAMP` without time zone; the source data carries no zone, so no timezone or DST logic is invented.
- **Names are stable.** The SQLAlchemy metadata has a `naming_convention`, and constraints are named explicitly (`uq_loggers_code`, `ck_loggers_unit_valid`, ...), so they are the same in the models, the migration and the database. `alembic check` reports no drift between models and migration.
- **Hand-written migration, run manually.** `0001_initial_schema` is written by hand (explicit `upgrade` and a working `downgrade`), not autogenerated. Run it with `docker compose exec backend alembic upgrade head`. It is deliberately not run at container start: that keeps the Dockerfile `CMD`, startup and `/health` unchanged, and keeps schema changes an explicit action rather than a side effect of a restart (including restarts caused by `--reload`). `migrations/` is bind-mounted so revisions created in the container appear on the host; `alembic.ini` and `migrations/` are also copied into the image (changing `alembic.ini` needs `docker compose build backend`).
- **`env.py` URL.** It uses `config.attributes["url"]` if set, else `-x url=...`, else the `DATABASE_URL` environment variable. Tests use the first form.
- **Isolated test database.** Integration tests use `<POSTGRES_DB>_test` (e.g. `fridge_monitor_db_test`), dropped and recreated at the first test that needs it, with the schema built by running the real Alembic migration (never `create_all`). A connection is made to the server's `postgres` database with `AUTOCOMMIT` to do this, and the helper refuses to touch any database not named `*_test`/`*_test_scratch`. Each test gets a session on an outer transaction that is rolled back at the end (`join_transaction_mode="create_savepoint"`), so tests can trigger an `IntegrityError` inside `begin_nested()` and keep going. The up/down/up migration test uses a throwaway `<POSTGRES_DB>_test_scratch` database that is dropped afterwards. The fixtures are lazy, so `pytest -m "not integration"` needs no database at all. After the full run the dev database still had 0 rows in all four tables.

### Logger reassignment and historical fridge association

A logger can move between fridges, and the sample data proves it happens but not when. Logger TL-0417 is reported at Tel Aviv / Walk-in on 2026-09-14 and at Tel Aviv / Display 2 on 2026-09-17, with nothing in between to say when the move happened.

- **Each reading stores the fridge it was reported under** (`temperature_readings.fridge_id`, `NOT NULL`). Reassigning a logger later never rewrites old readings, so history stays correct without any date logic.
- **`logger_assignments` records which loggers belong to which fridges.** Its dates are nullable and mean "unknown"; they are never inferred. Using the last reading at the old fridge or the first at the new one as a boundary would be a guess, so TL-0417 gets two assignments with both dates NULL. How long a logger was seen at a fridge can be derived from its readings (`MIN`/`MAX` of `measured_at`) if needed.
- **`UNIQUE NULLS NOT DISTINCT (logger_id, fridge_id, assigned_from)`** (PostgreSQL 16) makes two NULL `assigned_from` values collide, so an unknown-date pairing can be recorded only once, while the same pair with different known start dates is allowed. A `CHECK` requires `assigned_to > assigned_from` when both are known.
- **When no fridge can be determined unambiguously, the caller must confirm it explicitly.** This rule belongs to the ingestion step, not the schema. Nothing is guessed from "the only assignment on record", because the sample is only part of the real data.

### Limitations and next steps

- **Migrations are manual.** A fresh database has no tables until `docker compose exec backend alembic upgrade head` is run, and `/health` only checks connectivity, not the schema version.
- **Nothing writes to the tables yet.** Pending next steps, in order:
  1. Normalization: names, timestamps (`YYYY-MM-DD HH:MM` and day-first `DD/MM/YYYY HH:MM`), temperature parsing, and Fahrenheit to Celsius using `loggers.unit`.
  2. Ingestion: XLSX reading, deduplication via `ON CONFLICT DO NOTHING`, and the explicit fridge confirmation rule above.
  3. An idempotent seed from the 16 sample rows, expected to give 5 fridges, 4 loggers, 5 assignments, and 15 unique readings (one is the `ERR` row with NULL `temperature_c`).
- **Fridge lookup by time is not implemented.** Because assignment dates are unknown, there is no query yet that answers "which fridge was this logger in at time T" for data without a fridge column.
- **Still out of scope:** API endpoints (including file upload), UI, analytics, and frontend tests.

## Why a Vite dev-server proxy instead of `VITE_API_URL`

The frontend never calls an absolute URL like `http://localhost:8000/...`. Instead, `vite.config.ts` configures:

```ts
server: {
  host: "0.0.0.0",
  proxy: {
    "/health": { target: "http://backend:8000", changeOrigin: true },
    "/api":    { target: "http://backend:8000", changeOrigin: true },
  },
}
```

and `App.tsx` fetches a **relative** path (`fetch("/health")`). The Vite dev server — running *inside* the `frontend` container — forwards these requests to `backend:8000` over the internal Docker network, server-side.

This matters for LAN/mobile access specifically: if the frontend instead used a hardcoded `VITE_API_URL=http://localhost:8000`, that URL would be correct for a browser on the host machine, but **wrong** for a phone on the same Wi-Fi network hitting `http://<host-LAN-ip>:5173` — from the phone's perspective, `localhost` means the phone itself, not the host machine. Using a relative path + server-side proxy means it's the Vite dev server resolving `backend:8000` (a Docker-internal hostname), not the end client's browser resolving anything — so the exact same frontend build works identically whether it's accessed via `localhost`, a LAN IP, or (later) any other hostname. No environment-specific `VITE_API_URL` configuration is needed at all.

`/api` is proxied too even though nothing is served there yet — it's reserved so the next phase's `/api/status` endpoint works without any frontend config changes.

## Why health-check utilities differ per base image

Each container's Docker healthcheck uses whatever utility is actually present in its base image, rather than assuming a common tool or installing something new everywhere:

- **`db` (`postgres:16-alpine`)**: `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB` — ships built into the official Postgres image. No install needed.
- **`frontend` (`node:20-alpine`)**: `wget --spider -q http://127.0.0.1:5173/` — Alpine's busybox includes a minimal `wget`, so this works with zero extra installs. It uses `127.0.0.1` rather than `localhost`; see the deviation note below.
- **`backend` (`python:3.12-slim`)**: `curl -f http://localhost:8000/health` — but `python:3.12-slim` is a Debian-slim image that does **not** include `curl` by default. The Dockerfile explicitly installs it:
  ```dockerfile
  RUN apt-get update \
      && apt-get install -y --no-install-recommends curl \
      && rm -rf /var/lib/apt/lists/*
  ```
  This is the one base image in the stack that required an explicit extra install to make its healthcheck work — a deliberate, verified choice rather than an assumption that `curl` would "just be there."

### Deviation found during verification: `127.0.0.1` instead of `localhost` for the frontend healthcheck

While verifying the stack, the `frontend` container's healthcheck initially failed (`wget: can't connect to remote host: Connection refused`) even though `vite --host 0.0.0.0` was clearly running and serving requests. Root cause: BusyBox `wget` (in `node:20-alpine`) resolves `localhost` via `/etc/hosts`, which lists `::1` (IPv6) before `127.0.0.1` (IPv4); it tries `::1` first, and since Vite's dev server only binds the IPv4 `0.0.0.0` address, that first attempt is refused and `wget` does not fall back to IPv4. Confirmed with `docker compose exec frontend wget -O- http://127.0.0.1:5173/` (works) vs. the same command against `http://localhost:5173/` (fails). The fix was to point the healthcheck at `127.0.0.1` explicitly instead of `localhost`, which sidesteps DNS/hosts resolution order entirely.

### Bug found in Docker logs: `pg_isready` was missing `-d`

The original `db` healthcheck was `pg_isready -U $${POSTGRES_USER}` with no database argument. `pg_isready` defaults the database name to the *user name*, so every probe checked for a database called `fridge_monitor` (the user) instead of `fridge_monitor_db` (`POSTGRES_DB`). The probe still reported "accepting connections", so the container was marked `healthy` and nothing looked broken. The problem only showed up in the logs: `docker compose logs db` had a repeated `FATAL:  database "fridge_monitor" does not exist` line, one for every probe (about 100 by the time it was noticed).

The fix, in `docker-compose.yml`, was to pass both the user and the database explicitly:

```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
```

After restarting the `db` service, the log showed no further `FATAL` lines. The `$$` escapes the variable from Compose, so it is expanded inside the container from `.env`.

## What's deliberately NOT yet implemented (and why)

- **Ingestion, seed, normalization and business queries** — connectivity and the four schema tables/models exist, but nothing reads spreadsheets, normalizes names/timestamps/units, seeds data, or queries the tables for business logic yet. Deferred so each step stays small and independently verifiable (see above).
- **`/api/*` business endpoints** — only the proxy path is reserved (`/api` forwards to the backend in `vite.config.ts`); no backend route exists at `/api/*` yet. This comes with the `/api/status` step in the plan.
- **Frontend tests** — no Vitest/React Testing Library files or dependencies in `package.json` yet. The approved plan calls for tests to be written *alongside* each feature rather than retrofitted, so the frontend API client tests will arrive with that feature. Backend tests are in place (see "Testing" above).
- **Authentication** — out of scope for the entire Phase 1 plan, not just this step; there's no business functionality yet that would need to be protected.

Each of these is picked up in a subsequent, explicitly-scoped step of the approved plan rather than being bundled into earlier steps.
