# Red-Black Tree operations

The canonical implementation is `src/structures/red-black-tree.ts`. It
accepts a comparator that defines a total order and stores one entry per key.
Keys must remain immutable while stored. Inserting a duplicate returns
`false` and preserves the existing entry.

Use `ScheduleKey` and `compareScheduleKeys` for scheduling. Keys sort first
by finite UTC epoch milliseconds, then by the unique string ID in JavaScript
string order. Prefix IDs with the record kind to distinguish records from
different tables that share a numeric ID.

| Operation | Worst-case time | Auxiliary space |
| --- | --- | --- |
| Size | O(1) | O(1) |
| Insert, search, and delete | O(log n) | O(1) |
| Predecessor, successor, and lower bound | O(log n) | O(1) |
| Ordered range iteration (`k` yielded entries) | O(log n + k) | O(log n) |
| Full in-order iteration | O(n) | O(log n) |
| Snapshot export (`exportSnapshot`) | O(n) | O(n) |
| Invariant verification | O(n) | O(n) |

The bounds assume constant-time key comparisons and a valid tree with
`n` entries. The tree stores O(n) nodes. Rotations take constant time.
Insertion and deletion fixups use rotations and recoloring while following a
path up the tree. The invariant checker tracks visited nodes to detect cycles
and also checks parent links, key ordering, the black root and NIL sentinel,
red parent-child rules, equal black heights, and the recorded entry count.

`predecessor` and `successor` return strict neighbors even for absent keys.
`lowerBound` returns the first entry at or above the probe. All three return
`undefined` if there is no qualifying entry.

From the repository root, run `npm.cmd test` with Node.js 24. The suite
checks balancing during insertion and deletion, duplicate behavior, ordered
iteration, scheduling-key boundaries, and mixed updates against a sorted
reference over 6,000 deterministic random operations.
