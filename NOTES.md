# Engineering Notes — Fridge Temperature Monitor

This document captures the reasoning behind the choices made in the current **initial scaffold** step. For the full, approved multi-step plan this step is drawn from (including the later DB connectivity, `/api/status` endpoint, and test suite steps), see `/Users/sagit/.cursor/plans/triolla_phase_1_scaffold_277514b6.plan.md`.

## Stack choices

- **Backend: FastAPI + Uvicorn.** Lightweight, async-capable, has excellent auto-generated docs (`/docs`) out of the box, and is a natural fit for a small API-first service. `uvicorn[standard]` pulls in the extras needed for good dev-mode behavior (e.g. `watchfiles` for `--reload`, `httptools`/`uvloop` where available).
- **Frontend: React + TypeScript + Vite.** Vite's dev server gives fast HMR and, importantly for this project, a built-in reverse-proxy capability (`server.proxy`) that's central to the LAN/mobile-access design below.
- **Database: PostgreSQL 16 (Alpine image).** Standard, well-supported, and the Alpine variant is small and ships useful CLI tooling (`pg_isready`) out of the box.
- **Orchestration: Docker Compose.** Three services (`db`, `backend`, `frontend`) with explicit health checks and `depends_on: condition: service_healthy` chains so the stack comes up in a well-defined order.

## Why database logic is deliberately deferred

The `db` container is already wired into `docker-compose.yml` — it starts, runs its own health check (`pg_isready`), and persists data via the `postgres_data` named volume — but the **backend does not connect to it yet**. This is intentional, not an oversight:

- This step is scoped to proving the *scaffold* works: three containers building and starting cleanly, health checks passing, hot reload working, and the frontend/backend/proxy chain working end-to-end for a trivial payload.
- Adding `SQLAlchemy`/`psycopg2`/a `database.py` connection layer, a DB-backed health check, and an `/api/status` endpoint doing a real round trip is explicitly the **next** step in the approved plan. Keeping it separate means each step has a small, independently verifiable diff, rather than conflating "does the container network/compose setup work" with "does the DB driver/connection-pooling/query logic work."
- `requirements.txt` is kept to just `fastapi` and `uvicorn[standard]` for the same reason — no `sqlalchemy`, `psycopg2-binary`, or `pydantic-settings` yet, since there's no code that would use them.
- The `.env` / `.env.example` already define `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` (consumed by the `db` service today) and a commented-out `DATABASE_URL` shape, so the next step can wire up the backend connection without touching the environment/config surface at all.

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

- **`db` (`postgres:16-alpine`)**: `pg_isready -U $POSTGRES_USER` — ships built into the official Postgres image. No install needed.
- **`frontend` (`node:20-alpine`)**: `wget --spider -q http://localhost:5173/` — Alpine's busybox includes a minimal `wget`, so this works with zero extra installs.
- **`backend` (`python:3.12-slim`)**: `curl -f http://localhost:8000/health` — but `python:3.12-slim` is a Debian-slim image that does **not** include `curl` by default. The Dockerfile explicitly installs it:
  ```dockerfile
  RUN apt-get update \
      && apt-get install -y --no-install-recommends curl \
      && rm -rf /var/lib/apt/lists/*
  ```
  This is the one base image in the stack that required an explicit extra install to make its healthcheck work — a deliberate, verified choice rather than an assumption that `curl` would "just be there."

### Deviation found during verification: `127.0.0.1` instead of `localhost` for the frontend healthcheck

While verifying the stack, the `frontend` container's healthcheck initially failed (`wget: can't connect to remote host: Connection refused`) even though `vite --host 0.0.0.0` was clearly running and serving requests. Root cause: BusyBox `wget` (in `node:20-alpine`) resolves `localhost` via `/etc/hosts`, which lists `::1` (IPv6) before `127.0.0.1` (IPv4); it tries `::1` first, and since Vite's dev server only binds the IPv4 `0.0.0.0` address, that first attempt is refused and `wget` does not fall back to IPv4. Confirmed with `docker compose exec frontend wget -O- http://127.0.0.1:5173/` (works) vs. the same command against `http://localhost:5173/` (fails). The fix was to point the healthcheck at `127.0.0.1` explicitly instead of `localhost`, which sidesteps DNS/hosts resolution order entirely.

## What's deliberately NOT yet implemented (and why)

- **Database connectivity/queries** — no SQLAlchemy engine, no `database.py`, no DB-backed endpoints. Deferred to the next step in the approved plan so this scaffold step stays small and independently verifiable (see above).
- **`/api/*` business endpoints** — only the proxy path is reserved (`/api` forwards to the backend in `vite.config.ts`); no backend route exists at `/api/*` yet. This comes with the `/api/status` step in the plan.
- **Automated tests** — no Pytest files, no Vitest/RTL files, no test dependencies in `requirements.txt` or `package.json`. The approved plan calls for tests to be written *alongside* each feature (health, DB connectivity, status endpoint, frontend API client) rather than retrofitted — since none of those features exist yet in this step, there's nothing meaningful to test beyond "does the app boot," which the health checks and manual `curl` verification already cover.
- **Authentication** — out of scope for the entire Phase 1 plan, not just this step; there's no business functionality yet that would need to be protected.

Each of these is picked up in a subsequent, explicitly-scoped step of the approved plan rather than being bundled into this scaffold.
