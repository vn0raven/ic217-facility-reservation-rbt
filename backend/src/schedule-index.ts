import { compareScheduleKeys, RedBlackTree } from "../../src/structures/red-black-tree.ts";
import type { ScheduleKey } from "../../src/structures/red-black-tree.ts";
import type { Reservation } from "../../shared/types/index.ts";
import type { createRepositories } from "./repositories.ts";

export interface ScheduledRecord {
  readonly kind: "reservation" | "academic";
  readonly recordId: number;
  readonly facilityId: number;
  readonly start: number;
  readonly end: number;
}

export function toScheduleKey(
  kind: "reservation" | "academic",
  recordId: number,
  start: number,
): ScheduleKey {
  return { start, id: `${kind}:${recordId}` };
}

export function createScheduleIndex(repositories: ReturnType<typeof createRepositories>) {
  const trees = new Map<number, RedBlackTree<ScheduleKey, ScheduledRecord>>();

  function ensureTree(facilityId: number): RedBlackTree<ScheduleKey, ScheduledRecord> {
    let tree = trees.get(facilityId);
    if (!tree) {
      tree = new RedBlackTree<ScheduleKey, ScheduledRecord>(compareScheduleKeys);
      trees.set(facilityId, tree);
    }
    return tree;
  }

  function buildFacilityTree(facilityId: number): RedBlackTree<ScheduleKey, ScheduledRecord> {
    const tree = new RedBlackTree<ScheduleKey, ScheduledRecord>(compareScheduleKeys);
    const records: ScheduledRecord[] = [
      ...repositories.listReservations({ facilityId, status: "confirmed" }).map(item => ({
        kind: "reservation" as const,
        recordId: item.id,
        facilityId: item.facilityId,
        start: item.start,
        end: item.end,
      })),
      ...repositories.listAcademicBlocks(facilityId).map(block => ({
        kind: "academic" as const,
        recordId: block.id,
        facilityId: block.facilityId,
        start: block.start,
        end: block.end,
      })),
    ].sort((a, b) => compareScheduleKeys(
      toScheduleKey(a.kind, a.recordId, a.start),
      toScheduleKey(b.kind, b.recordId, b.start),
    ));

    let previousEnd = Number.NEGATIVE_INFINITY;
    for (const record of records) {
      if (record.start < previousEnd) {
        throw new Error(`Overlapping active schedule records detected in SQLite for facility ${facilityId}.`);
      }
      const inserted = tree.insert(
        toScheduleKey(record.kind, record.recordId, record.start),
        Object.freeze(record),
      );
      if (!inserted) {
        throw new Error(`Duplicate schedule key ${record.kind}:${record.recordId} for facility ${facilityId}.`);
      }
      previousEnd = record.end;
    }

    if (!tree.verifyInvariants()) {
      throw new Error(`Red-Black Tree invariant check failed for facility ${facilityId}.`);
    }
    trees.set(facilityId, tree);
    return tree;
  }

  function rebuildAll(): void {
    trees.clear();
    for (const facility of repositories.listFacilities()) {
      buildFacilityTree(facility.id);
    }
  }

  function findConflict(facilityId: number, start: number, end: number): ScheduledRecord | undefined {
    const tree = trees.get(facilityId);
    if (!tree || tree.size === 0) return undefined;

    const probe: ScheduleKey = { start, id: "" };
    const previous = tree.predecessor(probe);
    if (previous && previous.value.end > start) return previous.value;

    const next = tree.lowerBound(probe);
    if (next && next.value.start < end) return next.value;

    return undefined;
  }

  function insertConfirmedReservation(reservation: Reservation): void {
    const tree = ensureTree(reservation.facilityId);
    const key = toScheduleKey("reservation", reservation.id, reservation.start);
    try {
      if (findConflict(reservation.facilityId, reservation.start, reservation.end)) {
        throw new Error(`Schedule conflict while indexing reservation ${reservation.id}.`);
      }
      const inserted = tree.insert(key, Object.freeze({
        kind: "reservation",
        recordId: reservation.id,
        facilityId: reservation.facilityId,
        start: reservation.start,
        end: reservation.end,
      }));
      if (!inserted || !tree.verifyInvariants()) {
        throw new Error(`Failed to update schedule tree for reservation ${reservation.id}.`);
      }
    } catch (error) {
      buildFacilityTree(reservation.facilityId);
      throw error;
    }
  }

  function removeConfirmedReservation(
    reservation: Pick<Reservation, "id" | "facilityId" | "start">,
  ): void {
    const tree = trees.get(reservation.facilityId);
    if (!tree) return;
    const key = toScheduleKey("reservation", reservation.id, reservation.start);
    const removed = tree.delete(key);
    if (!removed || !tree.verifyInvariants()) {
      buildFacilityTree(reservation.facilityId);
    }
  }

  rebuildAll();

  return {
    findConflict,
    insertConfirmedReservation,
    removeConfirmedReservation,
    rebuildFacility: (facilityId: number) => {
      buildFacilityTree(facilityId);
    },
    rebuildAll,
    hasReservation(facilityId: number, reservationId: number, start: number): boolean {
      const tree = trees.get(facilityId);
      return Boolean(tree?.search(toScheduleKey("reservation", reservationId, start)));
    },
    getFacilityTreeSize(facilityId: number): number {
      return trees.get(facilityId)?.size ?? 0;
    },
    verifyAllInvariants(): boolean {
      for (const tree of trees.values()) {
        if (!tree.verifyInvariants()) return false;
      }
      return true;
    },
  };
}
