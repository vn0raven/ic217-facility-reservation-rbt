# Campus Facility Reservation and Scheduling Management System

IC 217 – Data Structures

University of Southeastern Philippines

## Team

- Bon – Data Structures and Algorithms
- Rai – Backend Development
- Sean – Frontend Development

## Technology

- Vite + TypeScript
- Node.js + Express
- SQLite via better-sqlite3
- Custom Red-Black Tree

## Status

Phase 3 implements the reservation lifecycle: demonstration campus roles
(`student`, `faculty`, `visitor`, `personnel`), reservation request submission
in Philippine time (`Asia/Manila` stored as UTC epoch milliseconds), personnel
approval and rejection, requester/personnel cancellation, and automatic
insertion/removal of approved (`confirmed`) reservations in per-facility
Red-Black Trees with half-open `[start, end)` conflict checks.

## Local setup

Use Node.js 24 LTS (or newer) and npm. Run these commands from the repository
root in PowerShell. Each package has its own lockfile and TypeScript
configuration.

```powershell
npm.cmd ci
npm.cmd --prefix backend ci
npm.cmd --prefix frontend ci
if (-not (Test-Path backend/.env)) { Copy-Item backend/.env.example backend/.env }
npm.cmd --prefix backend run db:seed
```

`db:seed` idempotently populates four demonstration campus users (one per role)
and five sample IC facilities so you can submit, approve, reject, and cancel
reservations immediately.

The backend defaults to port 3001 without a local `.env`. Keep that port for
the default Vite proxy. Run each server in a separate PowerShell window from
the repository root.

```powershell
npm.cmd --prefix backend run dev
```

```powershell
npm.cmd --prefix frontend run dev
```

Open http://127.0.0.1:5173 to reach the dashboard, facility directory,
reservation request form, and reservation management view. Switch demonstration
roles in the header selector to test Student, Faculty, Visitor, and Department
Personnel workflows.

While both servers are running, request the health and data endpoints directly
and through the Vite proxy:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
Invoke-RestMethod http://127.0.0.1:5173/api/health
Invoke-RestMethod http://127.0.0.1:5173/api/users
Invoke-RestMethod http://127.0.0.1:5173/api/facilities
Invoke-RestMethod http://127.0.0.1:3001/api/reservations
```

The frontend build writes static files to `frontend/dist`. Hosting those files
requires routing `/api` to Express.

## Verification

```powershell
npm.cmd test
npm.cmd exec -- tsc --noEmit
npm.cmd --prefix backend run typecheck
npm.cmd --prefix backend test
npm.cmd --prefix backend run db:init
npm.cmd --prefix backend run db:verify
npm.cmd --prefix backend run db:seed
npm.cmd --prefix frontend run build
```

The backend initializes and migrates `backend/data/ic217.sqlite` to schema v2
on startup, upgrading Phase 1 (`v0`) and Phase 2 (`v1`) databases in a
transaction without losing existing rows. Database verification writes and
reads sample rows across all four tables, checks role, interval, and
foreign-key constraints, and rolls back the sample rows.

For a disposable database, set `$env:SQLITE_PATH` to an absolute file path
before starting the backend or running database scripts.

See [Phase 3 workflow notes](docs/phase-3.md), [Phase 2 API notes](docs/phase-2.md),
and [Red-Black Tree complexity](docs/red-black-tree.md) for contract and
algorithm details.

## Team branches

Use `feature/red-black-tree` for Bon, `feature/backend` for Rai, and
`feature/frontend` for Sean. Integrate changes into `main` through pull
requests (for example via `dev/phase3-integration`).

See [the Red-Black Tree integration notes](docs/scheduling-integration.md)
for the scheduling design.
