# Fridge Temperature Monitor

Fridge Temperature Monitor is a from-scratch full-stack project built with a React + TypeScript (Vite) frontend, a FastAPI backend, and a PostgreSQL database (connected to the backend via SQLAlchemy), all orchestrated with Docker Compose.

## Prerequisites

- Docker
- Docker Compose (bundled with modern Docker Desktop as `docker compose`)

## Setup

```bash
cp .env.example .env
docker compose up --build
```

This builds and starts three containers:

| Service    | Description                     | URL                             |
| ---------- | -------------------------------- | -------------------------------- |
| `frontend` | React + Vite dev server          | http://localhost:5173            |
| `backend`  | FastAPI app                      | http://localhost:8000            |
| `backend`  | FastAPI auto-generated API docs  | http://localhost:8000/docs       |
| `db`       | PostgreSQL 16                    | (internal only, port 5432)       |

### LAN / mobile access

The frontend's port (`5173`) is published on all host network interfaces, and the Vite dev server proxies both `/health` and `/api` requests to the backend container over the internal Docker network. This means any other device on the same Wi-Fi/LAN (e.g. a phone) can reach the full app at:

```
http://<your-machine's-LAN-ip>:5173
```

with no extra configuration — the frontend never needs to know the backend's address, because all API calls use relative paths that are resolved by the Vite dev server itself, not the browser.

## Database connectivity and `/health`

The backend connects to PostgreSQL with SQLAlchemy (`psycopg2-binary` driver). The connection string is read from the `DATABASE_URL` environment variable, which `docker-compose.yml` builds from the `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` values in your `.env` file (the host is the Docker service name `db`). You don't need to set `DATABASE_URL` yourself.

`GET /health` is database-aware: it runs a `SELECT 1` against PostgreSQL.

| Database state | HTTP status | Response body                                         |
| -------------- | ----------- | ----------------------------------------------------- |
| Reachable      | `200`       | `{"status": "ok", "database": "connected"}`           |
| Unreachable    | `503`       | `{"status": "error", "database": "unreachable"}`      |

```bash
curl -i http://localhost:8000/health
```

The backend's Docker healthcheck calls this endpoint, so the `backend` container is reported `unhealthy` if the database can't be reached.

## Running tests

Backend tests use Pytest and run inside the running `backend` container, where the `db` hostname and `DATABASE_URL` are available:

```bash
docker compose up -d --build                      # make sure the stack is running
docker compose exec backend pytest                # all backend tests (4)
docker compose exec backend pytest -m "not integration"   # unit tests only (no database needed)
docker compose exec backend pytest -m integration         # integration tests against the real database
```

- **Unit tests** (`tests/test_health.py`) mock the database check and cover both the `200` and `503` responses of `/health`.
- **Integration tests** (`tests/test_database.py`, marked `integration`) connect to the real PostgreSQL container.
- Pytest exits with code `5` if it collects no tests. Treat that as a failure, not a pass.

Frontend tests (Vitest + React Testing Library) are not set up yet.

## Hot reload

- **Backend**: `./backend/app` is bind-mounted into the container, and `uvicorn` runs with `--reload`. Edits to Python files under `backend/app/` take effect immediately, no restart needed.
- **Frontend**: the whole `./frontend` directory is bind-mounted (with an anonymous volume over `node_modules` so the container's own installed packages aren't shadowed by the host mount). `vite` runs with its dev server, and `CHOKIDAR_USEPOLLING=true` is set so file-watching works reliably inside Docker on macOS.

## Tearing down

```bash
docker compose down      # stop and remove containers, keep the postgres_data volume
docker compose down -v   # also delete the postgres_data volume (destroys DB data)
```

## Current status / what's implemented so far

The repository has the initial scaffold plus backend database connectivity. There are no business features yet.

- ✅ Three-container Docker Compose setup (`db`, `backend`, `frontend`), all with working health checks and hot reload.
- ✅ Backend connected to PostgreSQL through SQLAlchemy, configured via environment variables.
- ✅ Database-aware `GET /health` endpoint (`200` when connected, `503` when the database is unreachable) and a trivial `GET /` welcome route.
- ✅ The `db` (Postgres) container persists data via a named volume.
- ✅ A minimal React + TypeScript + Vite frontend that fetches `/health` through the dev-server proxy and displays the result.
- ✅ Backend Pytest suite: 4 tests (2 unit, 2 integration against the real database).

Not yet implemented (planned for later phases — see `NOTES.md` and the approved plan):

- ❌ Database tables and models (no schema or business data yet).
- ❌ Any `/api/*` business endpoints, including `/api/status`.
- ❌ Frontend tests (Vitest + React Testing Library).
- ❌ Authentication.
