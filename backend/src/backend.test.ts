import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";
import { createRepositories } from "./repositories.ts";
import { compareScheduleKeys, RedBlackTree } from "../../src/structures/red-black-tree.ts";
import type { ScheduleKey } from "../../src/structures/red-black-tree.ts";
import type { Reservation } from "../../shared/types/index.ts";

test("upgrades an existing Phase 1 database without losing rows", () => {
  const directory = mkdtempSync(join(tmpdir(), "ic217-migration-"));
  const filename = join(directory, "legacy.sqlite");
  try {
    const legacy = new Database(filename);
    try {
      legacy.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
      legacy.exec(`
        INSERT INTO users (id, name, email) VALUES (1, 'Legacy', 'legacy@example.invalid');
        INSERT INTO facilities (id, name) VALUES (1, 'Legacy Hall');
      `);
      legacy.prepare(`
        INSERT INTO reservations (user_id, facility_id, start_ms, end_ms)
        VALUES (1, 1, 1000, 2000)
      `).run();
    } finally {
      legacy.close();
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const db = openDatabase(filename);
      try {
        const repositories = createRepositories(db);
        assert.equal(repositories.getUser(1)?.role, "requester");
        assert.deepEqual(repositories.getFacility(1), {
          id: 1, name: "Legacy Hall", location: null, capacity: null, active: true,
        });
        assert.equal(repositories.listReservations(1).length, 1);
      } finally {
        db.close();
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("repositories, constraints, and HTTP endpoints use isolated SQLite records", async () => {
  const db = openDatabase(":memory:");
  try {
    const repositories = createRepositories(db);
    const user = { id: 1, name: "Test User", email: "test@example.invalid", role: "requester" };
    const facility = { id: 1, name: "Test Hall", location: "Main Campus", capacity: 45, active: true };
    const reservation: Reservation = { id: 1, userId: 1, facilityId: 1, start: 1000, end: 2000, status: "confirmed" };
    const block = { id: 1, facilityId: 1, title: "Class", start: 2000, end: 3000 };

    db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run(user.name, user.email);
    const insertFacility = db.prepare("INSERT INTO facilities (name, location, capacity, active) VALUES (?, ?, ?, ?)");
    insertFacility.run(facility.name, facility.location, facility.capacity, 1);
    insertFacility.run("Closed Hall", null, null, 0);
    assert.throws(() => insertFacility.run("Invalid Capacity", null, 0, 1), { code: "SQLITE_CONSTRAINT_CHECK" });
    db.prepare(`
      INSERT INTO reservations (user_id, facility_id, start_ms, end_ms, status)
      VALUES (?, ?, ?, ?, ?)
    `).run(reservation.userId, reservation.facilityId, reservation.start, reservation.end, reservation.status);
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
      assert.deepEqual(await get("facilities", 200), { ok: true, data: repositories.listFacilities() });
      assert.deepEqual(await get("facilities/1", 200), { ok: true, data: facility });
      for (const path of ["reservations", "reservations?facilityId=1"]) {
        assert.deepEqual(await get(path, 200), { ok: true, data: [reservation] });
      }
      assert.deepEqual(await get("reservations?facilityId=2", 200), { ok: true, data: [] });
      for (const id of ["0", "-1", "1.5", "abc", "9007199254740992", "%ZZ"]) {
        assert.equal((await get(`facilities/${id}`, 400)).error.code, "INVALID_ID");
      }
      for (const path of ["facilities?x=1", "facilities/1?x=1", "reservations?facilityId=1&facilityId=2", "reservations?facilityId=", "reservations?x=1"]) {
        assert.equal((await get(path, 400)).error.code, "INVALID_QUERY");
      }
      assert.equal((await get("facilities/99", 404)).error.code, "FACILITY_NOT_FOUND");
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
