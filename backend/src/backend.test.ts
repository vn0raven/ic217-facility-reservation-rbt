import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { createApp } from "./app.ts";
import { openDatabase, seedDemoData } from "./db.ts";
import { createRepositories } from "./repositories.ts";
import { createScheduleIndex } from "./schedule-index.ts";
import { compareScheduleKeys, RedBlackTree } from "../../src/structures/red-black-tree.ts";
import type { ScheduleKey } from "../../src/structures/red-black-tree.ts";
import type { Reservation } from "../../shared/types/index.ts";

test("upgrades existing Phase 1 and Phase 2 databases without losing rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "ic217-migration-"));
  const v0File = join(directory, "legacy-v0.sqlite");
  const v1File = join(directory, "legacy-v1.sqlite");
  try {
    const legacyV0 = new Database(v0File);
    try {
      legacyV0.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
      legacyV0.exec(`
        INSERT INTO users (id, name, email) VALUES (1, 'Legacy Student', 'legacy@example.invalid');
        INSERT INTO facilities (id, name) VALUES (1, 'Legacy Hall');
        INSERT INTO reservations (user_id, facility_id, start_ms, end_ms) VALUES (1, 1, 1000, 2000);
      `);
    } finally {
      legacyV0.close();
    }

    const legacyV1 = new Database(v1File);
    try {
      legacyV1.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
      legacyV1.exec(`
        ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'requester' CHECK (role IN ('requester', 'admin'));
        ALTER TABLE facilities ADD COLUMN location TEXT CHECK (length(trim(location)) > 0);
        ALTER TABLE facilities ADD COLUMN capacity INTEGER CHECK (capacity BETWEEN 1 AND 9007199254740991);
        ALTER TABLE facilities ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1));
        PRAGMA user_version = 1;
        INSERT INTO users (id, name, email, role) VALUES
          (1, 'Phase 2 Requester', 'req@example.invalid', 'requester'),
          (2, 'Phase 2 Admin', 'admin@example.invalid', 'admin');
        INSERT INTO facilities (id, name, location, capacity, active) VALUES (1, 'Lab 1', 'IC Bldg', 40, 1);
        INSERT INTO reservations (user_id, facility_id, start_ms, end_ms, status)
          VALUES (1, 1, 3000, 4000, 'confirmed');
      `);
    } finally {
      legacyV1.close();
    }

    for (let attempt = 0; attempt < 2; attempt++) {
      const db0 = openDatabase(v0File);
      try {
        const repos = createRepositories(db0);
        assert.equal(repos.getUser(1)?.role, "student");
        assert.equal(repos.getUser(1)?.department, null);
        assert.deepEqual(repos.getFacility(1), {
          id: 1, name: "Legacy Hall", location: null, capacity: null, active: true,
        });
        assert.equal(repos.listReservations(1)[0]?.purpose, "Legacy reservation");
      } finally {
        db0.close();
      }

      const db1 = openDatabase(v1File);
      try {
        const repos = createRepositories(db1);
        assert.equal(repos.getUser(1)?.role, "student");
        assert.equal(repos.getUser(2)?.role, "personnel");
        assert.equal(repos.listReservations(1)[0]?.status, "confirmed");
      } finally {
        db1.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("seedDemoData populates the four campus roles and sample facilities idempotently", () => {
  const db = openDatabase(":memory:");
  try {
    seedDemoData(db);
    seedDemoData(db);
    const repos = createRepositories(db);
    const users = repos.listUsers();
    assert.deepEqual(
      users.map(user => user.role).sort(),
      ["faculty", "personnel", "student", "visitor"],
    );
    const facilities = repos.listFacilities();
    assert.equal(facilities.length, 5);
    assert.equal(facilities.some(item => !item.active), true);
  } finally {
    db.close();
  }
});

test("repositories, constraints, and Phase 2 read HTTP endpoints remain backward-compatible", async () => {
  const db = openDatabase(":memory:");
  try {
    const repositories = createRepositories(db);
    const user = { id: 1, name: "Test User", email: "test@example.invalid", role: "student" as const, department: "CIC" };
    const facility = { id: 1, name: "Test Hall", location: "Main Campus", capacity: 45, active: true };
    const reservation: Reservation = {
      id: 1,
      userId: 1,
      facilityId: 1,
      purpose: "Data structures lecture",
      start: 1000,
      end: 2000,
      status: "confirmed",
      createdAt: 500,
    };
    const block = { id: 1, facilityId: 1, title: "Class", start: 2000, end: 3000 };

    db.prepare("INSERT INTO users (name, email, role, department) VALUES (?, ?, ?, ?)")
      .run(user.name, user.email, user.role, user.department);
    const insertFacility = db.prepare("INSERT INTO facilities (name, location, capacity, active) VALUES (?, ?, ?, ?)");
    insertFacility.run(facility.name, facility.location, facility.capacity, 1);
    insertFacility.run("Closed Hall", null, null, 0);
    assert.throws(() => insertFacility.run("Invalid Capacity", null, 0, 1), { code: "SQLITE_CONSTRAINT_CHECK" });
    db.prepare(`
      INSERT INTO reservations (user_id, facility_id, purpose, start_ms, end_ms, status, created_at_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      reservation.userId,
      reservation.facilityId,
      reservation.purpose,
      reservation.start,
      reservation.end,
      reservation.status,
      reservation.createdAt,
    );
    db.prepare(`
      INSERT INTO academic_schedule_blocks (facility_id, title, start_ms, end_ms)
      VALUES (?, ?, ?, ?)
    `).run(block.facilityId, block.title, block.start, block.end);

    assert.deepEqual(repositories.getUser(1), user);
    assert.deepEqual(repositories.getFacility(1), facility);
    assert.equal(repositories.getFacility(2)?.active, false);
    assert.deepEqual(repositories.listAcademicBlocks(1), [block]);

    const tree = new RedBlackTree<ScheduleKey, Reservation>(compareScheduleKeys);
    const value = repositories.listReservations(1)[0];
    const key = { start: value.start, id: `reservation:${value.id}` };
    assert.equal(tree.insert(key, value), true);
    assert.deepEqual(tree.search(key)?.value, reservation);
    assert.equal(tree.verifyInvariants(), true);

    const server = createApp(repositories).listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert(address && typeof address !== "string");
      const { port } = address;
      async function get(path: string, status: number) {
        const response = await fetch(`http://127.0.0.1:${port}/api/${path}`);
        assert.equal(response.status, status, path);
        return response.json();
      }

      assert.deepEqual(await get("health", 200), { status: "ok" });
      assert.deepEqual(await get("users", 200), { ok: true, data: [user] });
      assert.deepEqual(await get("facilities", 200), { ok: true, data: repositories.listFacilities() });
      assert.deepEqual(await get("facilities/1", 200), { ok: true, data: facility });
      for (const path of ["reservations", "reservations?facilityId=1", "reservations?userId=1", "reservations?status=confirmed"]) {
        assert.deepEqual(await get(path, 200), { ok: true, data: [reservation] });
      }
      assert.deepEqual(await get("reservations/1", 200), { ok: true, data: reservation });
      assert.deepEqual(await get("reservations?facilityId=2", 200), { ok: true, data: [] });
      for (const id of ["0", "-1", "1.5", "abc", "9007199254740992", "%ZZ"]) {
        assert.equal((await get(`facilities/${id}`, 400)).error.code, "INVALID_ID");
      }
      for (const path of [
        "users?x=1",
        "facilities?x=1",
        "facilities/1?x=1",
        "reservations?facilityId=1&facilityId=2",
        "reservations?facilityId=",
        "reservations?status=approved",
        "reservations?x=1",
      ]) {
        assert.equal((await get(path, 400)).error.code, "INVALID_QUERY");
      }
      assert.equal((await get("facilities/99", 404)).error.code, "FACILITY_NOT_FOUND");
      assert.equal((await get("reservations/99", 404)).error.code, "RESERVATION_NOT_FOUND");
      assert.equal((await get("missing", 404)).error.code, "NOT_FOUND");

      db.close();
      const response = await get("facilities", 500);
      assert.deepEqual(response, {
        ok: false,
        error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." },
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    if (db.open) db.close();
  }
});

test("enforces Phase 3 reservation workflow, role permissions, conflicts, and Red-Black Tree sync", async () => {
  const db = openDatabase(":memory:");
  try {
    seedDemoData(db);
    const repositories = createRepositories(db);
    const users = repositories.listUsers();
    const student = users.find(u => u.role === "student")!;
    const faculty = users.find(u => u.role === "faculty")!;
    const visitor = users.find(u => u.role === "visitor")!;
    const personnel = users.find(u => u.role === "personnel")!;

    const facilities = repositories.listFacilities();
    const activeLab = facilities.find(f => f.active)!;
    const secondRoom = facilities.find(f => f.active && f.id !== activeLab.id)!;
    const inactiveRoom = facilities.find(f => !f.active)!;

    // Seed one academic block [8000, 9000) on activeLab to verifystartup indexing & conflict protection.
    db.prepare(`
      INSERT INTO academic_schedule_blocks (facility_id, title, start_ms, end_ms)
      VALUES (?, ?, ?, ?)
    `).run(activeLab.id, "IC 217 Lab Class", 8000, 9000);

    const scheduleIndex = createScheduleIndex(repositories);
    assert.equal(scheduleIndex.getFacilityTreeSize(activeLab.id), 1);
    assert.equal(scheduleIndex.verifyAllInvariants(), true);

    const server = createApp(repositories, scheduleIndex).listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}/api`;

      async function request(method: string, path: string, body?: unknown) {
        const res = await fetch(`${base}/${path}`, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, json: await res.json() };
      }

      // Validation & inactive/academic-block checks on submission
      assert.equal(
        (await request("POST", "reservations", {
          userId: student.id, facilityId: activeLab.id, start: 2000, end: 1000, purpose: "Bad interval",
        })).json.error.code,
        "INVALID_INTERVAL",
      );
      assert.equal(
        (await request("POST", "reservations", {
          userId: student.id, facilityId: activeLab.id, start: 1000, end: 2000, purpose: "   ",
        })).json.error.code,
        "INVALID_PURPOSE",
      );
      assert.equal(
        (await request("POST", "reservations", {
          userId: student.id, facilityId: inactiveRoom.id, start: 1000, end: 2000, purpose: "Closed room",
        })).json.error.code,
        "FACILITY_INACTIVE",
      );
      assert.equal(
        (await request("POST", "reservations", {
          userId: student.id, facilityId: activeLab.id, start: 8500, end: 9500, purpose: "Overlaps class",
        })).json.error.code,
        "SCHEDULE_CONFLICT",
      );

      // Two competing pending requests on [1000, 2000) and [1500, 2500)
      const firstSub = await request("POST", "reservations", {
        userId: student.id,
        facilityId: activeLab.id,
        start: 1000,
        end: 2000,
        purpose: "  Algorithm study session  ",
      });
      assert.equal(firstSub.status, 201);
      assert.equal(firstSub.json.data.status, "pending");
      assert.equal(firstSub.json.data.purpose, "Algorithm study session");
      const firstId: number = firstSub.json.data.id;

      // Pending requests must stay outside the Red-Black Tree
      assert.equal(scheduleIndex.hasReservation(activeLab.id, firstId, 1000), false);

      const overlappingSub = await request("POST", "reservations", {
        userId: faculty.id,
        facilityId: activeLab.id,
        start: 1500,
        end: 2500,
        purpose: "Faculty consultation",
      });
      assert.equal(overlappingSub.status, 201);
      const overlappingId: number = overlappingSub.json.data.id;

      // Role rules: non-personnel cannot approve or reject
      for (const actor of [student, faculty, visitor]) {
        const attempt = await request("PATCH", `reservations/${firstId}/status`, {
          actorUserId: actor.id,
          action: "approve",
        });
        assert.equal(attempt.status, 403);
        assert.equal(attempt.json.error.code, "FORBIDDEN");
      }

      // Personnel approves firstId -> confirmed + inserted into facility Red-Black Tree
      const approved = await request("PATCH", `reservations/${firstId}/status`, {
        actorUserId: personnel.id,
        action: "approve",
      });
      assert.equal(approved.status, 200);
      assert.equal(approved.json.data.status, "confirmed");
      assert.equal(scheduleIndex.hasReservation(activeLab.id, firstId, 1000), true);
      assert.equal(scheduleIndex.getFacilityTreeSize(activeLab.id), 2);
      assert.equal(scheduleIndex.verifyAllInvariants(), true);

      // Personnel cannot approve overlappingId while firstId is confirmed
      const conflictApproval = await request("PATCH", `reservations/${overlappingId}/status`, {
        actorUserId: personnel.id,
        action: "approve",
      });
      assert.equal(conflictApproval.status, 409);
      assert.equal(conflictApproval.json.error.code, "SCHEDULE_CONFLICT");

      // Adjacent [2000, 3000) on same facility AND [1000, 2000) on different facility both succeed
      const adjacentSub = await request("POST", "reservations", {
        userId: visitor.id,
        facilityId: activeLab.id,
        start: 2000,
        end: 3000,
        purpose: "Inter-department seminar prep",
      });
      assert.equal(adjacentSub.status, 201);
      const adjacentApproved = await request("PATCH", `reservations/${adjacentSub.json.data.id}/status`, {
        actorUserId: personnel.id,
        action: "approve",
      });
      assert.equal(adjacentApproved.status, 200);

      const otherFacilitySub = await request("POST", "reservations", {
        userId: visitor.id,
        facilityId: secondRoom.id,
        start: 1000,
        end: 2000,
        purpose: "Parallel meeting in another room",
      });
      assert.equal(otherFacilitySub.status, 201);
      const otherFacilityApproved = await request("PATCH", `reservations/${otherFacilitySub.json.data.id}/status`, {
        actorUserId: personnel.id,
        action: "approve",
      });
      assert.equal(otherFacilityApproved.status, 200);
      assert.equal(scheduleIndex.hasReservation(secondRoom.id, otherFacilitySub.json.data.id, 1000), true);

      // Non-owner requester cannot cancel student's reservation
      const wrongCancel = await request("PATCH", `reservations/${firstId}/status`, {
        actorUserId: visitor.id,
        action: "cancel",
      });
      assert.equal(wrongCancel.status, 403);

      // Student cancels their own confirmed reservation -> removed from Red-Black Tree!
      const ownerCancel = await request("PATCH", `reservations/${firstId}/status`, {
        actorUserId: student.id,
        action: "cancel",
      });
      assert.equal(ownerCancel.status, 200);
      assert.equal(ownerCancel.json.data.status, "cancelled");
      assert.equal(scheduleIndex.hasReservation(activeLab.id, firstId, 1000), false);
      assert.equal(scheduleIndex.verifyAllInvariants(), true);

      // Now overlappingId [1500, 2000? wait: 1500..2500 overlaps adjacentApproved 2000..3000! Let's verify!]
      assert.equal(
        (await request("PATCH", `reservations/${overlappingId}/status`, {
          actorUserId: personnel.id,
          action: "approve",
        })).json.error.code,
        "SCHEDULE_CONFLICT",
      );

      // Personnel rejects overlappingId, and rejecting/cancelling again fails with INVALID_STATUS_TRANSITION
      const rejected = await request("PATCH", `reservations/${overlappingId}/status`, {
        actorUserId: personnel.id,
        action: "reject",
      });
      assert.equal(rejected.status, 200);
      assert.equal(rejected.json.data.status, "rejected");

      const invalidCancel = await request("PATCH", `reservations/${overlappingId}/status`, {
        actorUserId: personnel.id,
        action: "cancel",
      });
      assert.equal(invalidCancel.status, 409);
      assert.equal(invalidCancel.json.error.code, "INVALID_STATUS_TRANSITION");

      // Newly freed [1000, 2000) slot can now be requested and approved
      const replacementSub = await request("POST", "reservations", {
        userId: faculty.id,
        facilityId: activeLab.id,
        start: 1000,
        end: 2000,
        purpose: "Replacement lab review",
      });
      assert.equal(replacementSub.status, 201);
      const replacementApproved = await request("PATCH", `reservations/${replacementSub.json.data.id}/status`, {
        actorUserId: personnel.id,
        action: "approve",
      });
      assert.equal(replacementApproved.status, 200);
      assert.equal(scheduleIndex.hasReservation(activeLab.id, replacementSub.json.data.id, 1000), true);

      // Simulated backend restart reconstructs identical tree state from SQLite
      const restartedIndex = createScheduleIndex(repositories);
      assert.equal(restartedIndex.verifyAllInvariants(), true);
      assert.equal(restartedIndex.getFacilityTreeSize(activeLab.id), 3);
      assert.equal(restartedIndex.hasReservation(activeLab.id, replacementSub.json.data.id, 1000), true);
      assert.equal(restartedIndex.hasReservation(activeLab.id, firstId, 1000), false);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    db.close();
  }
});

test("supports Phase 4 academic schedule blocking, availability checks, and RBT window queries", async () => {
  const db = openDatabase(":memory:");
  try {
    const referenceMs = Date.parse("2026-11-30T08:00:00+08:00");
    seedDemoData(db, { seedScheduleBlocks: true, referenceTimeMs: referenceMs });
    seedDemoData(db, { seedScheduleBlocks: true, referenceTimeMs: referenceMs });

    const repositories = createRepositories(db);
    assert.equal(repositories.listAcademicBlocks().length, 5);

    const users = repositories.listUsers();
    const student = users.find(u => u.role === "student")!;
    const personnel = users.find(u => u.role === "personnel")!;
    const facilities = repositories.listFacilities();
    const room = facilities.find(f => f.name === "CIC Conference Room")!;
    const inactive = facilities.find(f => !f.active)!;

    const scheduleIndex = createScheduleIndex(repositories);
    assert.equal(scheduleIndex.verifyAllInvariants(), true);

    const server = createApp(repositories, scheduleIndex).listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}/api`;

      async function request(method: string, path: string, body?: unknown) {
        const res = await fetch(`${base}/${path}`, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, json: await res.json() };
      }

      const dayStart = Date.parse("2026-12-01T00:00:00+08:00");
      const morningStart = Date.parse("2026-12-01T08:00:00+08:00");
      const morningEnd = Date.parse("2026-12-01T10:00:00+08:00");
      const midStart = Date.parse("2026-12-01T10:00:00+08:00");
      const midEnd = Date.parse("2026-12-01T12:00:00+08:00");
      const dayEnd = Date.parse("2026-12-02T00:00:00+08:00");

      // Non-personnel cannot create academic blocks
      assert.equal(
        (await request("POST", "academic-blocks", {
          actorUserId: student.id,
          facilityId: room.id,
          title: "Unauthorized block",
          start: morningStart,
          end: morningEnd,
        })).status,
        403,
      );

      // Inactive facility rejected
      assert.equal(
        (await request("POST", "academic-blocks", {
          actorUserId: personnel.id,
          facilityId: inactive.id,
          title: "Maintenance room class",
          start: morningStart,
          end: morningEnd,
        })).json.error.code,
        "FACILITY_INACTIVE",
      );

      // Personnel creates an academic schedule block [08:00, 10:00)
      const createdBlock = await request("POST", "academic-blocks", {
        actorUserId: personnel.id,
        facilityId: room.id,
        title: "  IC 217 Departmental Defense  ",
        start: morningStart,
        end: morningEnd,
      });
      assert.equal(createdBlock.status, 201);
      assert.equal(createdBlock.json.data.title, "IC 217 Departmental Defense");
      const blockId: number = createdBlock.json.data.id;
      assert.equal(scheduleIndex.hasAcademicBlock(room.id, blockId, morningStart), true);
      assert.equal(scheduleIndex.verifyAllInvariants(), true);

      // Availability check detects conflict on [09:00, 10:30) and reports open on adjacent [10:00, 12:00)
      const busyCheck = await request(
        "GET",
        `schedule/availability?facilityId=${room.id}&start=${morningStart + 3_600_000}&end=${morningEnd + 1_800_000}`,
      );
      assert.equal(busyCheck.status, 200);
      assert.equal(busyCheck.json.data.available, false);
      assert.equal(busyCheck.json.data.conflict.kind, "academic");
      assert.equal(busyCheck.json.data.conflict.id, blockId);

      const freeCheck = await request(
        "GET",
        `schedule/availability?facilityId=${room.id}&start=${midStart}&end=${midEnd}`,
      );
      assert.equal(freeCheck.status, 200);
      assert.equal(freeCheck.json.data.available, true);
      assert.equal(freeCheck.json.data.conflict, null);

      // Submit & approve adjacent reservation [10:00, 12:00), plus a pending reservation [13:00, 14:00)
      const subConfirmed = await request("POST", "reservations", {
        userId: student.id,
        facilityId: room.id,
        start: midStart,
        end: midEnd,
        purpose: "Thesis consultation",
      });
      assert.equal(subConfirmed.status, 201);
      await request("PATCH", `reservations/${subConfirmed.json.data.id}/status`, {
        actorUserId: personnel.id,
        action: "approve",
      });

      const subPending = await request("POST", "reservations", {
        userId: student.id,
        facilityId: room.id,
        start: midEnd + 3_600_000,
        end: midEnd + 7_200_000,
        purpose: "Pending request outside tree",
      });
      assert.equal(subPending.status, 201);

      // Personnel cannot add an academic block overlapping the confirmed reservation [10:00, 12:00)
      const conflictBlock = await request("POST", "academic-blocks", {
        actorUserId: personnel.id,
        facilityId: room.id,
        title: "Overlapping class",
        start: midStart + 1_800_000,
        end: midEnd + 1_800_000,
      });
      assert.equal(conflictBlock.status, 409);
      assert.equal(conflictBlock.json.error.code, "SCHEDULE_CONFLICT");

      // Query facility schedule window [09:00, 24:00) -> includes straddling 08:00–10:00 block + 10:00–12:00 reservation, excludes pending
      const windowRes = await request(
        "GET",
        `facilities/${room.id}/schedule?start=${morningStart + 3_600_000}&end=${dayEnd}`,
      );
      assert.equal(windowRes.status, 200);
      assert.deepEqual(
        windowRes.json.data.map((item: { kind: string; id: number }) => `${item.kind}:${item.id}`),
        [`academic:${blockId}`, `reservation:${subConfirmed.json.data.id}`],
      );

      // Non-personnel cannot delete academic block; personnel can delete it and free the slot
      assert.equal(
        (await request("DELETE", `academic-blocks/${blockId}`, { actorUserId: student.id })).status,
        403,
      );
      const deletedBlock = await request("DELETE", `academic-blocks/${blockId}`, {
        actorUserId: personnel.id,
      });
      assert.equal(deletedBlock.status, 200);
      assert.equal(scheduleIndex.hasAcademicBlock(room.id, blockId, morningStart), false);
      assert.equal(scheduleIndex.verifyAllInvariants(), true);

      const freedCheck = await request(
        "GET",
        `schedule/availability?facilityId=${room.id}&start=${morningStart}&end=${morningEnd}`,
      );
      assert.equal(freedCheck.json.data.available, true);

      // Restart reconstruction preserves remaining confirmed reservation and seeded blocks
      const rebuilt = createScheduleIndex(repositories);
      assert.equal(rebuilt.verifyAllInvariants(), true);
      assert.equal(rebuilt.getFacilityTreeSize(room.id), 1);
      assert.equal((await request("GET", `facilities/${ dayStart ? room.id : 0 }/schedule?start=${dayStart}&end=${dayEnd}`)).json.data.length, 1);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    db.close();
  }
});

test("supports Phase 5 facility management, live RBT snapshot export, and neighbor lookup", async () => {
  const db = openDatabase(":memory:");
  try {
    seedDemoData(db);
    const repositories = createRepositories(db);
    const users = repositories.listUsers();
    const student = users.find(u => u.role === "student")!;
    const personnel = users.find(u => u.role === "personnel")!;

    const scheduleIndex = createScheduleIndex(repositories);
    const server = createApp(repositories, scheduleIndex).listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}/api`;

      async function request(method: string, path: string, body?: unknown) {
        const res = await fetch(`${base}/${path}`, {
          method,
          headers: body === undefined ? undefined : { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: res.status, json: await res.json() };
      }

      // Non-personnel cannot create facilities
      assert.equal(
        (await request("POST", "facilities", {
          actorUserId: student.id,
          name: "Unauthorized Lab",
          location: "IC Bldg",
          capacity: 30,
        })).status,
        403,
      );

      // Personnel creates a new facility; duplicate name returns 409
      const createdFacility = await request("POST", "facilities", {
        actorUserId: personnel.id,
        name: "  AI Research Studio  ",
        location: "  IC Building, 3rd Floor  ",
        capacity: 25,
      });
      assert.equal(createdFacility.status, 201);
      assert.equal(createdFacility.json.data.name, "AI Research Studio");
      assert.equal(createdFacility.json.data.active, true);
      const studioId: number = createdFacility.json.data.id;

      assert.equal(
        (await request("POST", "facilities", {
          actorUserId: personnel.id,
          name: "ai research studio",
          location: null,
          capacity: 25,
        })).json.error.code,
        "FACILITY_EXISTS",
      );

      // Deactivating blocks new requests; reactivating re-enables them
      const deactivated = await request("PATCH", `facilities/${studioId}`, {
        actorUserId: personnel.id,
        active: false,
      });
      assert.equal(deactivated.status, 200);
      assert.equal(deactivated.json.data.active, false);

      assert.equal(
        (await request("POST", "reservations", {
          userId: student.id,
          facilityId: studioId,
          start: 1000,
          end: 2000,
          purpose: "Blocked while inactive",
        })).json.error.code,
        "FACILITY_INACTIVE",
      );

      const reactivated = await request("PATCH", `facilities/${studioId}`, {
        actorUserId: personnel.id,
        active: true,
        capacity: 30,
      });
      assert.equal(reactivated.status, 200);
      assert.equal(reactivated.json.data.active, true);
      assert.equal(reactivated.json.data.capacity, 30);

      // Populate 4 ordered slots (2 academic blocks + 2 approved reservations) to trigger rotation + recoloring
      const b1 = await request("POST", "academic-blocks", {
        actorUserId: personnel.id,
        facilityId: studioId,
        title: "Slot 1",
        start: 1000,
        end: 2000,
      });
      const r2 = await request("POST", "reservations", {
        userId: student.id,
        facilityId: studioId,
        start: 2000,
        end: 3000,
        purpose: "Slot 2",
      });
      await request("PATCH", `reservations/${r2.json.data.id}/status`, {
        actorUserId: personnel.id,
        action: "approve",
      });
      const b3 = await request("POST", "academic-blocks", {
        actorUserId: personnel.id,
        facilityId: studioId,
        title: "Slot 3",
        start: 3000,
        end: 4000,
      });
      const r4 = await request("POST", "reservations", {
        userId: student.id,
        facilityId: studioId,
        start: 5000,
        end: 6000,
        purpose: "Slot 4",
      });
      await request("PATCH", `reservations/${r4.json.data.id}/status`, {
        actorUserId: personnel.id,
        action: "approve",
      });

      const treeRes = await request("GET", `facilities/${studioId}/tree`);
      assert.equal(treeRes.status, 200);
      const tree = treeRes.json.data;
      assert.equal(tree.size, 4);
      assert.equal(tree.height, 3);
      assert.equal(tree.blackHeight, 2);
      assert.equal(tree.invariantsValid, true);
      assert.equal(tree.rootId, `reservation:${r2.json.data.id}`);
      assert.equal(tree.nodes.some((n: { color: string }) => n.color === "red"), true);
      assert.equal(tree.nodes.some((n: { color: string }) => n.color === "black"), true);
      assert.equal(tree.operations.length >= 5, true);

      // Neighbor probe in open gap [4000, 5000) vs conflicting [2500, 3500)
      const gapLookup = await request("GET", `facilities/${studioId}/tree/lookup?start=4000&end=5000`);
      assert.equal(gapLookup.status, 200);
      assert.deepEqual(gapLookup.json.data, {
        facilityId: studioId,
        probeStart: 4000,
        probeEnd: 5000,
        predecessorId: `academic:${b3.json.data.id}`,
        successorId: `reservation:${r4.json.data.id}`,
        lowerBoundId: `reservation:${r4.json.data.id}`,
        conflictId: null,
        available: true,
      });

      const hitLookup = await request("GET", `facilities/${studioId}/tree/lookup?start=2500&end=3500`);
      assert.equal(hitLookup.status, 200);
      assert.equal(hitLookup.json.data.available, false);
      assert.equal(hitLookup.json.data.predecessorId, `reservation:${r2.json.data.id}`);
      assert.equal(hitLookup.json.data.conflictId, `reservation:${r2.json.data.id}`);
      assert.equal(b1.status, 201);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    db.close();
  }
});
