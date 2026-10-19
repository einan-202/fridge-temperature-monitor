# Fridge Temperature Monitor

Fridge Temperature Monitor is a from-scratch full-stack project scaffolded with a React + TypeScript (Vite) frontend, a FastAPI backend, and a PostgreSQL database, all orchestrated with Docker Compose.

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

## Hot reload

- **Backend**: `./backend/app` is bind-mounted into the container, and `uvicorn` runs with `--reload`. Edits to Python files under `backend/app/` take effect immediately, no restart needed.
- **Frontend**: the whole `./frontend` directory is bind-mounted (with an anonymous volume over `node_modules` so the container's own installed packages aren't shadowed by the host mount). `vite` runs with its dev server, and `CHOKIDAR_USEPOLLING=true` is set so file-watching works reliably inside Docker on macOS.

## Tearing down

```bash
docker compose down      # stop and remove containers, keep the postgres_data volume
docker compose down -v   # also delete the postgres_data volume (destroys DB data)
```

## Current status / what's implemented so far

This repository is currently at the **initial scaffold** stage only:

- ✅ Three-container Docker Compose setup (`db`, `backend`, `frontend`), all with working health checks and hot reload.
- ✅ A minimal FastAPI backend with an app-level `GET /health` endpoint (`{"status": "ok"}`) and a trivial `GET /` welcome route. **No database queries happen yet.**
- ✅ A minimal React + TypeScript + Vite frontend that fetches `/health` through the dev-server proxy and displays the result.
- ✅ The `db` (Postgres) container runs and persists data via a named volume, but the backend does **not** connect to it yet.

Not yet implemented (planned for later phases — see `NOTES.md` and the approved plan):

- ❌ Backend database connectivity (SQLAlchemy engine, connection checks).
- ❌ Any `/api/*` business endpoints.
- ❌ Automated tests (Pytest / Vitest).
- ❌ Authentication.
