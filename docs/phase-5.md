# Phase 5 visualization and feature completion notes

## Live Red-Black Tree snapshot export and operation traces

`RedBlackTree.exportSnapshot()` (`src/structures/red-black-tree.ts`) exports an
immutable level-order snapshot directly from each facility's active in-memory
tree, including:

- `size`, `height`, `blackHeight`, `invariantsValid`, and `rootKey`.
- Every real node's `ScheduleKey`, `color` (`'red' | 'black'`), `parentKey`,
  `leftKey`, `rightKey`, `depth`, and `blackDepth`.

`RedBlackTree.getLastOperationSteps()` captures the exact insertion, deletion,
left/right rotation, and recoloring steps executed on each mutation.
`createScheduleIndex` retains up to 20 recent operations per facility so the
visualizer displays authentic structural mutations rather than a simulated tree.

## Phase 5 endpoints

| Method | Endpoint | Behavior |
| --- | --- | --- |
| `POST` | `/api/facilities` | Creates a facility (`personnel` only) and initializes its `RedBlackTree` |
| `PATCH` | `/api/facilities/:id` | Updates facility `location`, `capacity`, or `active` flag (`personnel` only) |
| `GET` | `/api/facilities/:id/tree` | Returns the facility's hydrated `FacilityTreeSnapshotView` and operation trace history |
| `GET` | `/api/facilities/:id/tree/lookup?start=<ms>&end=<ms>` | Probes `predecessor`, `successor`, `lowerBound`, and `conflict` on the live tree |

## Frontend MVP interfaces

- **RBT Visualizer (`#visualizer`)**: Renders an interactive SVG diagram of the
  selected facility's `RedBlackTree` with colored red/black nodes, `L` / `R`
  parent-child edges, optional black `NIL` sentinel leaves, a click/keyboard
  node inspector, an interactive `Asia/Manila` neighbor/conflict probe, and the
  balancing trace feed.
- **Facility management (`#facilities`)**: Allows Department Personnel to add
  new facilities and toggle `Active` / `Inactive` status, plus provides a
  direct **Inspect RBT** shortcut on every facility card.
- **Personal reservation history (`#reservations`)**: Adds an **Only my requests**
  filter alongside facility and status filters.
