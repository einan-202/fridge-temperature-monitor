---
name: Fridge Temperature Monitor Phase 1 Scaffold
overview: Scaffold a clean Docker Compose project (React+TS+Vite frontend, FastAPI backend, PostgreSQL) with verified health checks on all 3 containers, a Vite dev-server proxy for LAN/mobile access, hot reload, persistent storage proven with real data, and automated tests (Pytest / Vitest+RTL) built alongside each feature — no auth or business logic yet.
todos:
  - id: scaffold-files
    content: Create docker-compose.yml, .env.example, .gitignore, directory skeleton, and test tooling config (pytest.ini, vitest setup)
    status: pending
  - id: backend-health
    content: Implement GET /health (app-level) + unit test test_health.py
    status: pending
  - id: backend-db
    content: Implement database.py connectivity layer + integration test test_database.py; extend /health with DB check
    status: pending
  - id: backend-status
    content: Implement GET /api/status (DB round trip) + integration test test_status.py
    status: pending
  - id: frontend-api
    content: Implement api.ts + App.tsx calling backend via relative /api path (Vite proxy to backend:8000, LAN/mobile-accessible), with mocked-fetch Vitest/RTL tests
    status: pending
  - id: compose-wiring
    content: Wire docker-compose.yml health checks for all 3 services with real utilities (curl installed in backend image, wget built into frontend base image, pg_isready built into postgres image); install test dependencies in both Dockerfiles; configure Vite proxy + 0.0.0.0 binding
    status: pending
  - id: docs
    content: Write README.md (setup + how to run tests) and NOTES.md (engineering decisions)
    status: pending
  - id: verify
    content: Run docker compose up --build, confirm all 3 containers report healthy, run backend/frontend test suites (asserting non-zero tests collected), verify DB persistence by inserting real data and querying it again after a restart
    status: pending
isProject: false
---

# Fridge Temperature Monitor Take-Home — Phase 1 Plan

## Context

The repo currently only contains a placeholder `README.md` ("Fridge Temperature Monitor") from the old project and no other files, so this is a true from-scratch build. The existing `README.md` will be overwritten with the new project's setup instructions.

## Goals for Phase 1

- `docker compose up --build` brings up 3 containers: `frontend`, `backend`, `db` — and each reports Docker-level `healthy`, using utilities actually present in their images (verified, not assumed).
- Backend (FastAPI) connects to Postgres; a health endpoint reports both app and DB status.
- Frontend (React/Vite) fetches from the backend through the Vite dev-server proxy (relative `/api/*` path) and displays the result — proves the full chain works end-to-end and works from phones/other devices on the same LAN, not just `localhost`.
- Postgres data survives `docker compose down` / `up` via a named volume, confirmed by inserting real rows and reading them back after a restart (not just checking the volume exists).
- Code changes in `backend/` and `frontend/` hot-reload inside the containers.
- Automated tests (Pytest; Vitest + React Testing Library) are written **alongside each feature**, not retrofitted at the end, including integration tests for API ↔ PostgreSQL connectivity.
- `README.md` (setup + test commands) and `NOTES.md` (engineering decisions) are written.
- Deliberately excluded: auth, ORM models/business tables, CI pipelines, nginx/prod build, e2e/browser testing — these are future-phase concerns.

## Project Structure

```
fridge-temperature-monitor/
├── docker-compose.yml
├── .env.example
├── .gitignore
├── README.md
├── NOTES.md
├── backend/
│   ├── Dockerfile              # installs curl (healthcheck) + requirements.txt + requirements-dev.txt
│   ├── requirements.txt
│   ├── requirements-dev.txt   # pytest, httpx
│   ├── pytest.ini             # markers (integration), test paths
│   ├── .dockerignore
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py            # FastAPI app, CORS, router registration
│   │   ├── config.py          # env-based settings (pydantic-settings)
│   │   ├── database.py        # SQLAlchemy engine + connection check helper
│   │   └── routers/
│   │       ├── __init__.py
│   │       └── health.py      # GET /health, GET /api/status
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py        # TestClient fixture, DB-availability fixture
│       ├── test_health.py     # unit: app is up (no DB required)
│       ├── test_database.py   # integration: real connection to Postgres
│       └── test_status.py     # integration: /api/status round-trips through DB
└── frontend/
    ├── Dockerfile              # plain `npm install` (keeps devDependencies: vitest, RTL)
    ├── .dockerignore
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts         # server.proxy '/api' -> http://backend:8000; server.host 0.0.0.0; test block (jsdom, setupFiles)
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx            # calls backend via relative /api path, renders status
        ├── api.ts             # fetch wrapper, calls relative "/api/status" (proxied by Vite)
        ├── App.css
        ├── test/
        │   └── setup.ts       # jest-dom matchers registration
        └── __tests__/
            ├── api.test.ts    # unit: mocked fetch, response parsing
            └── App.test.tsx   # unit: loading/success/error render states
```

## Key Design Decisions (will be captured in `NOTES.md`)

- **DB access**: SQLAlchemy (sync engine) + `psycopg2-binary`. No ORM models yet — only a `SELECT 1` / `SELECT now()` connectivity check — but the engine setup makes adding models trivial in Phase 2.
- **Frontend-backend wiring (Vite proxy, LAN/mobile-friendly)**: the frontend code calls a relative path, `/api/status` — never an absolute `localhost` URL. `vite.config.ts` configures `server.proxy: { "/api": { target: "http://backend:8000", changeOrigin: true } }` and `server.host = "0.0.0.0"`. The Vite dev server (running inside the `frontend` container) forwards `/api/*` to `backend:8000` over the Docker network server-side. This means any device that can reach the published `5173` port — including a phone on the same Wi-Fi hitting `http://<host-LAN-ip>:5173` — gets working API calls, with no need to know the backend's address/port and no `VITE_API_URL` env var. CORS on FastAPI is therefore not required for the app's own flow (no cross-origin browser request ever happens); `/health` and `/api/*` remain directly reachable on `:8000` for `curl`/debugging.
- **Minimal E2E proof**: `GET /api/status` returns `{status: "ok", db_time: <timestamp from Postgres>}`. The frontend fetches this once on mount and renders it. This exercises frontend → backend → DB without introducing real business logic.
- **Hot reload**: backend bind-mounts `./backend/app` and runs `uvicorn --reload`; frontend bind-mounts `./frontend` (with an anonymous volume over `node_modules`) and runs `vite --host 0.0.0.0`. `CHOKIDAR_USEPOLLING=true` / `vite.config.ts` `server.watch.usePolling` set for reliable file-watching in Docker on macOS.
- **Persistence**: named volume `postgres_data` mounted at `/var/lib/postgresql/data`. Proven with real inserted data surviving a restart, not just checking the volume exists (see Verification Steps).
- **Health checks — verified utilities, not assumptions**: all three containers get a real, working Docker `healthcheck`, using tools confirmed present in their actual base images:
  - `db` (`postgres:16-alpine`): `pg_isready -U $POSTGRES_USER` — built into the official Postgres image, no install needed.
  - `backend` (`python:3.12-slim`): `python:slim` does **not** ship `curl` by default, so the Dockerfile explicitly installs it (`apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*`) before the healthcheck `curl -f http://localhost:8000/health` is usable. `depends_on: db: condition: service_healthy`.
  - `frontend` (`node:20-alpine`): `wget` ships via busybox in Alpine, so `wget --spider -q http://localhost:5173/ || exit 1` works with no extra install. This is a mandatory check (not optional) — Vite returning the index HTML on `/` confirms the dev server is alive. `depends_on: backend: condition: service_healthy`.
- **Config**: single `.env` (git-ignored, with `.env.example` committed) supplies `POSTGRES_USER/PASSWORD/DB`, consumed by both `db` and `backend` (backend builds `DATABASE_URL` from the same vars).
- **Testing philosophy**: tests are split into **unit** (no external dependencies — app logic, request/response shape, component rendering with mocked fetch) and **integration** (real Postgres connectivity, run against the `db` service already defined in compose — no extra test containers, no `testcontainers` dependency, to avoid overengineering). Integration tests are marked with `@pytest.mark.integration` so they can be run selectively.
- **Where tests run, and that dependencies are actually installed**: backend tests run inside the `backend` container via `docker compose exec backend pytest`, since that's the only place `DATABASE_URL`/network name resolution to `db` is guaranteed to work the same as the app. The backend `Dockerfile` installs **both** `requirements.txt` and `requirements-dev.txt` so `pytest`/`httpx` exist in the running container, not just hypothetically. Frontend tests mock `fetch` entirely, so they run equally well via `docker compose exec frontend npm run test` or locally; the frontend `Dockerfile` uses a plain `npm install` (dev image, not a production build) so `vitest`/`@testing-library/*` devDependencies are kept, not stripped.
- **"Zero tests collected" is never treated as a pass**: `pytest` exits with code `5` when it collects zero tests. This is explicitly *not* reported as success anywhere in this plan. During the scaffold step (before any test file exists) we only confirm the runners are installed and invocable (e.g. `pytest --version`); the first real pass/fail signal arrives in Step 2 once `test_health.py` exists, and later verification checks collected-test count `> 0` in addition to exit code `0`.

## Docker Compose Sketch

```yaml
services:
  db:
    image: postgres:16-alpine
    env_file: .env
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend   # Dockerfile installs curl + requirements.txt + requirements-dev.txt
    env_file: .env
    volumes:
      - ./backend/app:/app/app
      - ./backend/tests:/app/tests
    ports: ["8000:8000"]
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 5s
      timeout: 5s
      retries: 5

  frontend:
    build: ./frontend   # Dockerfile runs plain `npm install` (keeps devDependencies)
    volumes:
      - ./frontend:/app
      - /app/node_modules
    ports: ["5173:5173"]   # published on all host interfaces -> reachable from LAN/mobile
    depends_on:
      backend:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:5173/"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  postgres_data:
```

No `VITE_API_URL` is needed: the proxy target (`http://backend:8000`) is set directly in `vite.config.ts` since it's always the same Docker-network address.

## Implementation Steps, Tests & Acceptance Criteria

### 1. Scaffold & tooling

- Create `docker-compose.yml`, `.env.example`, `.gitignore`, directory skeleton.
- Backend: `Dockerfile` installs OS `curl` (for the healthcheck) plus `requirements.txt` (fastapi, uvicorn, sqlalchemy, psycopg2-binary, pydantic-settings) and `requirements-dev.txt` (pytest, httpx); `pytest.ini` registers an `integration` marker.
- Frontend: Vite React-TS scaffold, `Dockerfile` using plain `npm install` (devDependencies retained: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`), `test` block in `vite.config.ts`, `src/test/setup.ts`, and `server.proxy`/`server.host` config (see Step 5).
- **Acceptance**: `docker compose build` succeeds for all services; `pytest --version` and `npm run test -- --version` (or equivalent) succeed inside their containers, confirming the tools are installed and invocable. **No test suite exists yet at this step, so no pass/fail claim is made here** — in particular, `pytest`'s exit code `5` ("no tests collected") is expected and must not be reported as a passing suite; real pass/fail verification starts in Step 2.

### 2. Backend — app-level health (`GET /health`)

- Implement `main.py` + `routers/health.py` with a minimal `GET /health` returning `{"status": "ok"}` (no DB check yet at this step).
- Test: `tests/test_health.py` — unit test using FastAPI `TestClient`, asserts `200` and body shape. No DB required.
- **Acceptance**: `pytest tests/test_health.py` passes without the `db` service running.

### 3. Backend — database connectivity layer

- Implement `database.py`: SQLAlchemy engine from `DATABASE_URL`, `check_connection()` helper running `SELECT 1`.
- Extend `/health` to call `check_connection()` and report `{"status": "ok", "database": "connected" | "unreachable"}`.
- Tests:
  - `tests/test_database.py` (`@pytest.mark.integration`) — connects to the real `db` service, asserts `check_connection()` succeeds.
  - Extend `tests/test_health.py` with a unit case that monkeypatches `check_connection()` to simulate a DB failure and asserts `/health` reports `database: unreachable` (keeps this path unit-testable without a real DB).
- **Acceptance**: `pytest -m integration` passes when `db` is healthy; `pytest -m "not integration"` passes with `db` stopped.

### 4. Backend — status endpoint (DB round trip)

- Implement `GET /api/status` returning `{"status": "ok", "db_time": <ISO timestamp from Postgres>}`.
- Test: `tests/test_status.py` (`@pytest.mark.integration`) — calls the endpoint via `TestClient`, asserts `db_time` is present and parses as a valid timestamp close to "now".
- **Acceptance**: integration test passes against the real `db`; endpoint manually verified with `curl`.

### 5. Frontend — API client + App component

- Configure `vite.config.ts`: `server.host = "0.0.0.0"`, `server.port = 5173`, `server.proxy["/api"] = { target: "http://backend:8000", changeOrigin: true }`.
- Implement `api.ts` (`fetchStatus()` wrapping `fetch("/api/status")` — a **relative** path, proxied by Vite; works identically from `localhost` or a LAN IP/mobile device).
- Implement `App.tsx`: calls `fetchStatus()` on mount, renders loading → success (`db_time`) / error states.
- Tests:
  - `__tests__/api.test.ts` — unit test mocking global `fetch`, asserts `fetchStatus()` parses a successful response and rejects/throws on a non-OK response.
  - `__tests__/App.test.tsx` — RTL test mocking `api.ts`'s `fetchStatus`, asserts the component renders a loading state then the success message, and separately a graceful error message when the mock rejects.
- **Acceptance**: `npm run test` passes; no real backend/network needed (all mocked).

### 6. Compose wiring — health checks, volumes, hot reload

- Finalize `docker-compose.yml` per the sketch above (healthchecks, `depends_on` conditions, `postgres_data` volume, bind mounts for hot reload).
- Confirm each healthcheck's utility is actually installed where it runs: `curl` added via `apt-get` in the backend `Dockerfile`; `wget` confirmed built into `node:20-alpine`; `pg_isready` confirmed built into `postgres:16-alpine`. Run each healthcheck command manually inside its container (`docker compose exec <service> <command>`) before trusting the Compose-level status.
- No new automated tests at this step; verified manually (see Verification Steps).
- **Acceptance**: `docker compose ps` reports `healthy` for **all 3** services (not just "running"), and each healthcheck command, run manually, exits `0`.

### 7. Documentation

- `README.md`: prerequisites, `.env` setup, `docker compose up --build`, service URLs (including LAN URL for mobile access), hot reload notes, **how to run tests** (`docker compose exec backend pytest`, `docker compose exec backend pytest -m "not integration"`, `docker compose exec frontend npm run test`), **how to manually verify health checks and persistence** (the commands from Verification Steps 2 and 6), teardown.
- `NOTES.md`: stack rationale, the design decisions above (Vite proxy for LAN access, per-image health-check utility choices, unit/integration test split, why "0 tests collected" ≠ pass, why persistence is verified manually rather than via pytest), what's deferred to later phases.
- **Acceptance**: a new developer can follow `README.md` alone to get the stack running, all health checks passing, and the test suites passing.

## Verification Steps

1. `docker compose up --build` — all three services start; no crash loops.
2. `docker compose ps` — `db`, `backend`, `frontend` **all three** show `healthy` (not just `running`). Additionally run each healthcheck command manually inside its container to confirm the underlying utility works: `docker compose exec db pg_isready -U $POSTGRES_USER`, `docker compose exec backend curl -f http://localhost:8000/health`, `docker compose exec frontend wget --spider -q http://localhost:5173/`.
3. `curl http://localhost:8000/health` → `{"status":"ok","database":"connected"}`.
4. `curl http://localhost:8000/api/status` → includes a live DB timestamp.
5. Open `http://localhost:5173` on the host — page shows the backend/DB status fetched on load. Then, from another device on the same LAN (e.g. a phone), open `http://<host-LAN-ip>:5173` and confirm the same status renders — proves the Vite proxy (not `localhost`) is what makes the API call work.
6. **Persistence with real data**: insert an actual row, restart, and read it back —

   ```
   docker compose exec db psql -U $POSTGRES_USER -d $POSTGRES_DB -c \
     "CREATE TABLE IF NOT EXISTS persistence_check (id serial PRIMARY KEY, note text); INSERT INTO persistence_check (note) VALUES ('phase1-check');"
   docker compose down            # no -v — volume must survive
   docker compose up -d
   docker compose exec db psql -U $POSTGRES_USER -d $POSTGRES_DB -c "SELECT * FROM persistence_check;"
   ```

   The inserted row must still be present. This is a throwaway table used only for this manual check (not part of the app schema), and is intentionally **not** automated as a pytest integration test — asserting real persistence requires stopping/restarting the container itself, which a test running inside that same container cannot safely orchestrate without overengineering (e.g. a Docker-socket dependency). This decision is documented in `NOTES.md`.

7. Hot reload: edit `backend/app/routers/health.py` message → response updates without manual restart; edit `frontend/src/App.tsx` text → browser updates via HMR without full refresh.
8. `docker compose exec backend pytest` — full backend suite (unit + integration) passes **and** the summary reports more than zero tests collected (e.g. check `pytest --collect-only -q | tail -1` or the "N passed" count) — an exit code of `0` with `0` tests collected must never be read as success.
9. `docker compose exec backend pytest -m "not integration"` — passes (with tests actually collected) even if `db` is stopped, confirming the unit/integration separation is real.
10. `docker compose exec frontend npm run test` — full frontend suite passes with a non-zero test count reported.

