# Phase 2 development notes

The Phase 1 health response remains `{"status":"ok"}`. The data endpoints
return `{ "ok": true, "data": ... }`. Errors return
`{ "ok": false, "error": { "code": "...", "message": "..." } }`.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/facilities` | Lists all facilities, including inactive ones, by name |
| `GET /api/facilities/:id` | Looks up a facility by positive safe integer ID |
| `GET /api/reservations` | Lists stored reservations ordered by start and ID |
| `GET /api/reservations?facilityId=1` | Filters reservations by facility ID |

Invalid IDs and query parameters return 400. A missing facility on a
detail request returns 404. A reservation filter with no matching rows
returns an empty list. Unexpected database failures return a generic 500.

Facility active status describes whether a facility can be selected in
the form. It is independent of time-slot availability. The form checks
the facility, date, time range, and purpose locally and saves no record.
SQLite intervals remain integer epoch milliseconds. Later scheduling
integration can pair the start with a namespaced record ID, as verified
in the backend tests.
