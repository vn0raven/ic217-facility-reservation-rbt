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

Phase 1 provides the frontend shell, local API, SQLite schema, shared types,
and standalone Red-Black Tree.

## Local setup

Use Node.js 24 LTS and npm. Run these commands from the repository root in
PowerShell. Each package has its own lockfile and TypeScript configuration.

```powershell
npm.cmd ci
npm.cmd --prefix backend ci
npm.cmd --prefix frontend ci
Copy-Item backend/.env.example backend/.env -NoClobber
```

The backend defaults to port 3001 without a local .env. Keep that port for
the default Vite proxy. Run each server in a separate PowerShell window
from the repository root.

```powershell
npm.cmd --prefix backend run dev
```

```powershell
npm.cmd --prefix frontend run dev
```

Open http://127.0.0.1:5173 to see the shell and API connection status.
While both servers are running, request the health endpoint directly and
through the Vite proxy. Both should return a JSON object with status set to ok.

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
Invoke-RestMethod http://127.0.0.1:5173/api/health
```

The frontend build writes static files to frontend/dist. Hosting those
files requires routing /api to Express.

## Verification

```powershell
npm.cmd test
npm.cmd exec -- tsc --noEmit
npm.cmd --prefix backend run typecheck
npm.cmd --prefix backend run db:init
npm.cmd --prefix backend run db:verify
npm.cmd --prefix frontend run build
```

The backend initializes backend/data/ic217.sqlite on startup. Database
verification writes and reads sample rows across all four tables, checks
interval and foreign-key constraints, and rolls back the sample rows.
Both application TypeScript configurations check shared/types/index.ts.

## Team branches

Use feature/red-black-tree for Bon, feature/backend for Rai, and
feature/frontend for Sean. Integrate changes into main through pull requests.

See [the Red-Black Tree integration notes](docs/scheduling-integration.md)
for the scheduling design.
