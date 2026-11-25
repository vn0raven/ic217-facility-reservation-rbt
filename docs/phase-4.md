# Phase 4 scheduling and integration notes

## Per-facility Red-Black Tree scheduling index

On startup, `createScheduleIndex` reconstructs one `RedBlackTree<ScheduleKey, ScheduledRecord>`
per facility from SQLite using:

- Confirmed reservations (`status = 'confirmed'`) with keys `reservation:<id>`.
- Academic schedule blocks (`academic_schedule_blocks`) with keys `academic:<id>`.

Pending, rejected, and cancelled reservations are excluded from active trees.
During startup and fallback rebuilds, intervals are checked for half-open
`[start, end)` non-overlap and every facility tree is checked with
`verifyInvariants()`.

### Conflict detection and window queries

- **Conflict check (`O(log n)`)**: Probes `{ start, id: "" }` using
  `tree.predecessor(probe)` (`previous.end > start`) and `tree.successor(probe)`
  (`next.start < end`).
- **Schedule window query (`O(log n + k)`)**: Checks `tree.predecessor({ start: windowStart, id: "" })`
  for any interval straddling `windowStart`, then iterates
  `tree.rangeFrom({ start: windowStart, id: "" })` and stops as soon as
  `entry.key.start >= windowEnd`.

## Phase 4 endpoints

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `GET` | `/api/facilities/:id/schedule?start=<ms>&end=<ms>` | Lists active reservations and academic blocks overlapping `[start, end)` in chronological order |
| `GET` | `/api/schedule/availability?facilityId=<id>&start=<ms>&end=<ms>` | Checks whether `[start, end)` is free on an active facility and returns any conflicting item |
| `GET` | `/api/academic-blocks` | Lists academic schedule blocks; optional `facilityId` filter |
| `POST` | `/api/academic-blocks` | Adds an academic schedule block (`personnel` only) and indexes `academic:<id>` in the facility tree |
| `DELETE` | `/api/academic-blocks/:id` | Deletes an academic schedule block (`personnel` only via `{ actorUserId }`) and removes `academic:<id>` from the facility tree |

## Persistence synchronization

Every status transition (`approve`, `cancel`) and academic block write
(`POST` / `DELETE /api/academic-blocks`) commits inside an immediate SQLite
transaction and updates the corresponding facility's `RedBlackTree`. If an
in-memory update or invariant check ever fails, that facility's tree is rebuilt
from SQLite before serving the next request.

## Daily and weekly schedule views

The `#schedule` page renders Daily (`00:00–24:00 Asia/Manila`) and Weekly
(`Mon–Sun Asia/Manila`) schedules per facility, lets Department Personnel add
or remove academic class schedule blocks, and pairs with the **Check availability**
action on `#reservation`.
