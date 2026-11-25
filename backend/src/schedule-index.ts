import { compareScheduleKeys, RedBlackTree } from "../../src/structures/red-black-tree.ts";
import type { ScheduleKey, TreeSnapshot } from "../../src/structures/red-black-tree.ts";
import type {
  AcademicScheduleBlock,
  FacilityTreeLookupView,
  FacilityTreeOperationEntry,
  Reservation,
} from "../../shared/types/index.ts";
import type { createRepositories } from "./repositories.ts";

const MAX_OPERATION_HISTORY = 20;

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
  const operationLogs = new Map<number, FacilityTreeOperationEntry[]>();
  let sequence = 0;

  function appendLog(
    facilityId: number,
    operation: FacilityTreeOperationEntry["operation"],
    keyId: string,
    summary: string,
    steps: ReadonlyArray<string>,
  ): void {
    let list = operationLogs.get(facilityId);
    if (!list) {
      list = [];
      operationLogs.set(facilityId, list);
    }
    list.push({
      sequence: ++sequence,
      timestamp: Date.now(),
      operation,
      keyId,
      summary,
      steps: [...steps],
    });
    if (list.length > MAX_OPERATION_HISTORY) {
      list.splice(0, list.length - MAX_OPERATION_HISTORY);
    }
  }

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

    const collectedSteps: string[] = [];
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
      collectedSteps.push(...tree.getLastOperationSteps());
      previousEnd = record.end;
    }

    if (!tree.verifyInvariants()) {
      throw new Error(`Red-Black Tree invariant check failed for facility ${facilityId}.`);
    }
    trees.set(facilityId, tree);
    appendLog(
      facilityId,
      "rebuild",
      `facility:${facilityId}`,
      records.length === 0
        ? "Initialized empty Red-Black Tree from SQLite"
        : `Reconstructed Red-Black Tree from SQLite with ${records.length} active interval(s)`,
      collectedSteps.length > 0 ? collectedSteps : ["Tree empty; black NIL sentinel active"],
    );
    return tree;
  }

  function rebuildAll(): void {
    trees.clear();
    operationLogs.clear();
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

    const next = tree.successor(probe);
    if (next && next.value.start < end) return next.value;

    return undefined;
  }

  function queryWindow(
    facilityId: number,
    windowStart: number,
    windowEnd: number,
  ): ScheduledRecord[] {
    const tree = trees.get(facilityId);
    if (!tree || tree.size === 0 || windowEnd <= windowStart) return [];

    const items: ScheduledRecord[] = [];
    const probe: ScheduleKey = { start: windowStart, id: "" };
    const previous = tree.predecessor(probe);
    if (previous && previous.value.end > windowStart) {
      items.push(previous.value);
    }
    for (const entry of tree.rangeFrom(probe)) {
      if (entry.key.start >= windowEnd) break;
      items.push(entry.value);
    }
    return items;
  }

  function insertRecord(record: ScheduledRecord): void {
    const tree = ensureTree(record.facilityId);
    const key = toScheduleKey(record.kind, record.recordId, record.start);
    try {
      if (findConflict(record.facilityId, record.start, record.end)) {
        throw new Error(`Schedule conflict while indexing ${record.kind}:${record.recordId}.`);
      }
      const inserted = tree.insert(key, Object.freeze(record));
      if (!inserted || !tree.verifyInvariants()) {
        throw new Error(`Failed to update schedule tree for ${record.kind}:${record.recordId}.`);
      }
      appendLog(
        record.facilityId,
        "insert",
        key.id,
        `Inserted ${key.id} into facility tree (size = ${tree.size})`,
        tree.getLastOperationSteps(),
      );
    } catch (error) {
      buildFacilityTree(record.facilityId);
      throw error;
    }
  }

  function removeRecord(
    kind: "reservation" | "academic",
    facilityId: number,
    recordId: number,
    start: number,
  ): void {
    const tree = trees.get(facilityId);
    if (!tree) return;
    const key = toScheduleKey(kind, recordId, start);
    const removed = tree.delete(key);
    if (!removed || !tree.verifyInvariants()) {
      buildFacilityTree(facilityId);
      return;
    }
    appendLog(
      facilityId,
      "delete",
      key.id,
      `Deleted ${key.id} from facility tree (size = ${tree.size})`,
      tree.getLastOperationSteps(),
    );
  }

  function exportFacilitySnapshot(facilityId: number): {
    snapshot: TreeSnapshot<ScheduleKey, ScheduledRecord>;
    operations: FacilityTreeOperationEntry[];
  } {
    const tree = ensureTree(facilityId);
    const history = operationLogs.get(facilityId) ?? [];
    return {
      snapshot: tree.exportSnapshot(),
      operations: [...history].reverse(),
    };
  }

  function inspectProbe(
    facilityId: number,
    probeStart: number,
    probeEnd: number,
  ): FacilityTreeLookupView {
    const tree = ensureTree(facilityId);
    const probe: ScheduleKey = { start: probeStart, id: "" };
    const previous = tree.predecessor(probe);
    const next = tree.successor(probe);
    const lower = tree.lowerBound(probe);
    const conflict = findConflict(facilityId, probeStart, probeEnd);

    return {
      facilityId,
      probeStart,
      probeEnd,
      predecessorId: previous?.key.id ?? null,
      successorId: next?.key.id ?? null,
      lowerBoundId: lower?.key.id ?? null,
      conflictId: conflict ? `${conflict.kind}:${conflict.recordId}` : null,
      available: !conflict,
    };
  }

  rebuildAll();

  return {
    findConflict,
    queryWindow,
    exportFacilitySnapshot,
    inspectProbe,
    registerFacility(facilityId: number): void {
      buildFacilityTree(facilityId);
    },
    insertConfirmedReservation(reservation: Reservation): void {
      insertRecord({
        kind: "reservation",
        recordId: reservation.id,
        facilityId: reservation.facilityId,
        start: reservation.start,
        end: reservation.end,
      });
    },
    removeConfirmedReservation(reservation: Pick<Reservation, "id" | "facilityId" | "start">): void {
      removeRecord("reservation", reservation.facilityId, reservation.id, reservation.start);
    },
    insertAcademicBlock(block: AcademicScheduleBlock): void {
      insertRecord({
        kind: "academic",
        recordId: block.id,
        facilityId: block.facilityId,
        start: block.start,
        end: block.end,
      });
    },
    removeAcademicBlock(block: Pick<AcademicScheduleBlock, "id" | "facilityId" | "start">): void {
      removeRecord("academic", block.facilityId, block.id, block.start);
    },
    rebuildFacility: (facilityId: number) => {
      buildFacilityTree(facilityId);
    },
    rebuildAll,
    hasReservation(facilityId: number, reservationId: number, start: number): boolean {
      return Boolean(trees.get(facilityId)?.search(toScheduleKey("reservation", reservationId, start)));
    },
    hasAcademicBlock(facilityId: number, blockId: number, start: number): boolean {
      return Boolean(trees.get(facilityId)?.search(toScheduleKey("academic", blockId, start)));
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
