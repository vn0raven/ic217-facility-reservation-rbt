# Scheduling integration design

Use the canonical `RedBlackTree` and `compareScheduleKeys` from
`src/structures/red-black-tree.ts`. Build one tree per facility from SQLite
at startup. Insert confirmed reservations and academic schedule blocks.
Keep pending requests in SQLite until confirmation. Use UTC epoch
milliseconds for start and end. Prefix each key ID with its record kind
so a reservation and academic block can share the same database ID.

Use half-open intervals `[start, end)` so adjacent bookings are allowed.
Maintain and verify the non-overlap invariant per facility when loading
from SQLite. Search for the candidate start with an empty key ID, which
sorts before the stored IDs at that start. Use `predecessor` for the nearest
earlier start and `successor` for the first start at or after the candidate.
Reject if the predecessor ends after the candidate starts or the successor
starts before the candidate ends. The two-neighbor check relies on the
non-overlap invariant.

Serialize the availability check and write for each facility. SQLite is
the source of truth. Update the tree after commit, and if that fails,
rebuild it from SQLite before serving another check. Export a read-only
tree snapshot for visualization in a later phase.
