import assert from "node:assert/strict";
import { test } from "node:test";
import { compareScheduleKeys, RedBlackTree } from "./red-black-tree.ts";
import type { ScheduleKey } from "./red-black-tree.ts";

const key = (start: number, id = "reservation"): ScheduleKey => ({ start, id });
const makeTree = () => new RedBlackTree<ScheduleKey, string>(compareScheduleKeys);

function insertStarts(starts: number[]) {
  const tree = makeTree();
  for (const start of starts) {
    assert.equal(tree.insert(key(start), String(start)), true);
    assert.equal(tree.verifyInvariants(), true, `after inserting ${start}`);
  }
  return tree;
}

test("empty tree operations", () => {
  const tree = makeTree();
  assert.equal(tree.size, 0);
  assert.equal(tree.search(key(1)), undefined);
  assert.equal(tree.delete(key(1)), false);
  assert.equal(tree.predecessor(key(1)), undefined);
  assert.equal(tree.successor(key(1)), undefined);
  assert.equal(tree.lowerBound(key(1)), undefined);
  assert.deepEqual([...tree.inOrder()], []);
  assert.equal(tree.verifyInvariants(), true);
});

test("insert, find, and delete a single node", () => {
  const tree = insertStarts([10]);
  assert.equal(tree.size, 1);
  assert.deepEqual(tree.search(key(10)), { key: key(10), value: "10" });
  assert.equal(tree.delete(key(10)), true);
  assert.equal(tree.delete(key(10)), false);
  assert.equal(tree.search(key(10)), undefined);
  assert.equal(tree.size, 0);
  assert.deepEqual([...tree.inOrder()], []);
  assert.equal(tree.verifyInvariants(), true);
  assert.equal(tree.insert(key(20), "new root"), true);
  assert.equal(tree.verifyInvariants(), true);
});

for (const starts of [[3, 2, 1], [1, 2, 3], [3, 1, 2], [1, 3, 2]]) {
  test(`balances insertion order ${starts.join(", ")}`, () => {
    const tree = insertStarts(starts);
    assert.deepEqual([...tree.inOrder()].map(({ key }) => key.start), [1, 2, 3]);
  });
}

test("recolors with a red uncle on either side and across multiple levels", () => {
  for (const direction of [1, -1]) {
    const starts = [10, 5, 15, 2, 7, 1, 3, 4, 6, 8, 9].map(start => start * direction);
    const tree = insertStarts(starts);
    assert.deepEqual([...tree.inOrder()].map(({ key }) => key.start), starts.sort((a, b) => a - b));
  }
});

for (const [label, starts, target] of [
  ["root with one child", [2, 1], 2],
  ["red leaf", [2, 1, 3], 1],
  ["black leaf", [2, 1, 3, 4], 1],
  ["root with two children and direct successor", [2, 1, 3], 2],
  ["node with two children and deeper successor", [8, 4, 12, 2, 6, 10, 14, 5, 7], 4],
] as const) {
  test(`deletes a ${label}`, () => {
    const tree = insertStarts([...starts]);
    assert.equal(tree.delete(key(target)), true);
    assert.equal(tree.search(key(target)), undefined);
    assert.equal(tree.size, starts.length - 1);
    assert.equal(tree.verifyInvariants(), true);
    assert.deepEqual(
      [...tree.inOrder()].map(({ key }) => key.start),
      starts.filter(start => start !== target).sort((a, b) => a - b),
    );
  });
}

test("orders by timestamp and then ID, rejecting exact duplicate keys", () => {
  const tree = makeTree();
  const keys = [key(20, "a"), key(10, "b"), key(10, "a"), key(5, "z")];
  for (const entryKey of keys) {
    assert.equal(tree.insert(entryKey, "original"), true);
    assert.equal(tree.verifyInvariants(), true);
  }
  assert.equal(tree.insert(key(10, "b"), "replacement"), false);
  assert.equal(tree.search(key(10, "b"))?.value, "original");
  assert.equal(tree.size, 4);
  assert.deepEqual([...tree.inOrder()].map(entry => entry.key), [keys[3], keys[2], keys[1], keys[0]]);
  assert.equal(tree.verifyInvariants(), true);
});

test("neighbors and lower bound handle present keys, gaps, ties, and boundaries", () => {
  const tree = makeTree();
  for (const entryKey of [key(30, "a"), key(10, "c"), key(10, "a")]) {
    tree.insert(entryKey, entryKey.id);
    assert.equal(tree.verifyInvariants(), true);
  }
  assert.equal(tree.predecessor(key(10, "a")), undefined);
  assert.equal(tree.successor(key(30, "a")), undefined);
  assert.deepEqual(tree.successor(key(10, "a"))?.key, key(10, "c"));
  assert.deepEqual(tree.predecessor(key(10, "c"))?.key, key(10, "a"));
  assert.deepEqual(tree.predecessor(key(10, "b"))?.key, key(10, "a"));
  assert.deepEqual(tree.successor(key(10, "b"))?.key, key(10, "c"));
  assert.deepEqual(tree.lowerBound(key(10, ""))?.key, key(10, "a"));
  assert.deepEqual(tree.lowerBound(key(10, "a"))?.key, key(10, "a"));
  assert.deepEqual(tree.lowerBound(key(20))?.key, key(30, "a"));
  assert.equal(tree.lowerBound(key(40)), undefined);
});

test("scheduling keys order equal timestamps by namespaced ID and delete independently", () => {
  const tree = makeTree();
  const start = Date.UTC(2026, 10, 26, 1);
  const academic = key(start, "academic:12");
  const reservation = key(start, "reservation:12");
  const later = key(start + 1, "academic:1");

  for (const entryKey of [reservation, later, academic]) {
    assert.equal(tree.insert(entryKey, entryKey.id), true);
    assert.equal(tree.verifyInvariants(), true);
  }

  assert.equal(tree.search(key(start, "reservation:13")), undefined);
  assert.deepEqual([...tree.inOrder()].map(entry => entry.key), [academic, reservation, later]);
  assert.deepEqual(tree.lowerBound(key(start, ""))?.key, academic);
  assert.deepEqual(tree.successor(key(start, ""))?.key, academic);
  assert.equal(tree.delete(academic), true);
  assert.equal(tree.verifyInvariants(), true);
  assert.deepEqual(tree.lowerBound(key(start, ""))?.key, reservation);
  assert.deepEqual(tree.predecessor(later)?.key, reservation);
});

test("rebalances during consecutive deletions from either end of the tree", () => {
  const starts = Array.from({ length: 63 }, (_, index) => index + 1);
  for (const direction of [1, -1]) {
    const tree = insertStarts(starts);
    const remaining = [...starts];
    const removals = direction === 1 ? starts : [...starts].reverse();

    for (const target of removals) {
      if (direction === 1) remaining.shift();
      else remaining.pop();

      assert.equal(tree.delete(key(target)), true);
      assert.equal(tree.search(key(target)), undefined);
      assert.equal(tree.verifyInvariants(), true, `direction ${direction}, after deleting ${target}`);
      assert.equal(tree.size, remaining.length);
      assert.deepEqual([...tree.inOrder()].map(entry => entry.key.start), remaining);
    }
  }
});

test("matches a sorted reference after 6,000 seeded random insertions and deletions", () => {
  for (const seed of [7, 42, 2026]) {
    let state = seed;
    const random = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const tree = makeTree();
    const reference = new Map<string, { key: ScheduleKey; value: string }>();
    for (let step = 0; step < 2000; step++) {
      const candidate = key(Math.floor(random() * 32), String(Math.floor(random() * 5)));
      const label = JSON.stringify(candidate);
      const context = `seed ${seed}, step ${step}`;

      if (random() < 0.52) {
        const value = String(step);
        const isNew = !reference.has(label);
        assert.equal(tree.insert(candidate, value), isNew, context);
        if (isNew) reference.set(label, { key: candidate, value });
      } else {
        assert.equal(tree.delete(candidate), reference.delete(label), context);
      }

      const sorted = [...reference.values()].sort((a, b) => compareScheduleKeys(a.key, b.key));
      assert.equal(tree.verifyInvariants(), true, context);
      assert.equal(tree.size, reference.size, context);
      assert.deepEqual([...tree.inOrder()], sorted, context);
      assert.deepEqual(tree.search(candidate), reference.get(label), context);
      assert.deepEqual(tree.predecessor(candidate), sorted.findLast(entry =>
        entry.key.start < candidate.start ||
        (entry.key.start === candidate.start && entry.key.id < candidate.id)), context);
      assert.deepEqual(tree.successor(candidate), sorted.find(entry =>
        entry.key.start > candidate.start ||
        (entry.key.start === candidate.start && entry.key.id > candidate.id)), context);
      assert.deepEqual(tree.lowerBound(candidate), sorted.find(entry =>
        entry.key.start > candidate.start ||
        (entry.key.start === candidate.start && entry.key.id >= candidate.id)), context);
    }

    for (const { key: remaining } of reference.values()) {
      assert.equal(tree.delete(remaining), true);
      assert.equal(tree.verifyInvariants(), true);
    }
    assert.equal(tree.size, 0);
  }
});

test("validates finite timestamps and freezes stored ScheduleKey objects", () => {
  const tree = makeTree();
  const mutable = { start: 1000, id: "reservation:1" };
  assert.equal(tree.insert(mutable, "approved"), true);
  assert.equal(Object.isFrozen(mutable), true);
  assert.throws(() => {
    (mutable as { start: number }).start = 9999;
  }, TypeError);

  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => compareScheduleKeys(key(invalid), key(1000)), RangeError);
    assert.throws(() => compareScheduleKeys(key(1000), key(invalid)), RangeError);
    assert.throws(() => tree.insert(key(invalid), "bad"), RangeError);
  }
  assert.equal(tree.verifyInvariants(), true);
});

test("supports half-open interval conflict checks and cancellation removal for approved reservations", () => {
  const tree = new RedBlackTree<ScheduleKey, { start: number; end: number }>(compareScheduleKeys);
  const hasConflict = (start: number, end: number): boolean => {
    const probe = key(start, "");
    const previous = tree.predecessor(probe);
    if (previous && previous.value.end > start) return true;
    const next = tree.lowerBound(probe);
    return Boolean(next && next.value.start < end);
  };

  assert.equal(tree.insert(key(9_00, "reservation:1"), { start: 9_00, end: 10_00 }), true);
  assert.equal(tree.insert(key(11_00, "academic:4"), { start: 11_00, end: 12_00 }), true);
  assert.equal(tree.verifyInvariants(), true);

  assert.equal(hasConflict(9_30, 10_30), true);
  assert.equal(hasConflict(10_00, 11_00), false);
  assert.equal(hasConflict(10_30, 11_30), true);

  assert.equal(tree.delete(key(9_00, "reservation:1")), true);
  assert.equal(hasConflict(9_30, 10_30), false);
  assert.equal(tree.verifyInvariants(), true);
});
