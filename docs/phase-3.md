# Phase 3 workflow notes

## Schema v2 migration

On startup, `openDatabase` upgrades SQLite schemas from `user_version = 0` or
`1` to `user_version = 2` inside an atomic transaction:

- `users`: upgrades `role` to `'student' | 'faculty' | 'visitor' | 'personnel'`
  (mapping legacy `'requester'` to `'student'` and `'admin'` to `'personnel'`)
  and adds nullable `department`.
- `reservations`: adds required `purpose` (`1..250` trimmed characters) and
  `created_at_ms` (`INTEGER >= 0`), preserving existing rows.
- `npm.cmd --prefix backend run db:seed` idempotently inserts four demonstration
  campus users (one per role) and five sample IC facilities (four active, one
  inactive).

## Status values and UI labels

SQLite and `ReservationStatus` retain `'pending' | 'confirmed' | 'rejected' | 'cancelled'`
for backward compatibility with Phase 1–2 contracts and scheduling docs. The
frontend displays `'confirmed'` as **Approved**.

## Endpoints

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `GET` | `/api/users` | Lists demonstration users ordered by ID |
| `GET` | `/api/reservations` | Lists reservations; optional `facilityId`, `userId`, and `status` filters |
| `GET` | `/api/reservations/:id` | Retrieves one reservation by positive safe integer ID |
| `POST` | `/api/reservations` | Submits a `pending` reservation for an active facility |
| `PATCH` | `/api/reservations/:id/status` | Applies `approve`, `reject`, or `cancel` for `actorUserId` |

### Role and transition rules

- **Submit (`POST /api/reservations`)**: Any registered user may submit a
  request for an active facility when `end > start`, `purpose` is 1–250
  characters, and `[start, end)` does not already overlap an active academic
  schedule block or approved reservation (`409 SCHEDULE_CONFLICT`). Pending
  requests remain outside the Red-Black Tree.
- **Approve (`action: "approve"`)**: Restricted to `personnel` (`403 FORBIDDEN`
  otherwise). Requires `pending` status (`409 INVALID_STATUS_TRANSITION`), an
  active facility (`409 FACILITY_INACTIVE`), and no half-open `[start, end)`
  conflict in the facility's `RedBlackTree` (`409 SCHEDULE_CONFLICT`). Updates
  SQLite to `'confirmed'` and inserts `reservation:<id>` into the facility's
  `RedBlackTree`.
- **Reject (`action: "reject"`)**: Restricted to `personnel`. Transitions
  `pending -> rejected`.
- **Cancel (`action: "cancel"`)**: Allowed for the owning requester on
  `pending` or `confirmed` reservations, and for `personnel` on `confirmed` (or
  own `pending`) reservations. Transitions status to `'cancelled'` and removes
  `reservation:<id>` from the facility's `RedBlackTree` when previously
  `confirmed`.

## Timezone handling

The frontend converts Philippine local date and time inputs (`Asia/Manila`,
`UTC+08:00`) into canonical UTC epoch milliseconds before calling
`POST /api/reservations`, and formats stored timestamps back in `Asia/Manila`.
