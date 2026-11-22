import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const dataDirectory = new URL("../data/", import.meta.url);
const databasePath = fileURLToPath(new URL("ic217.sqlite", dataDirectory));

export function initializeDatabase(verify = false): void {
  mkdirSync(dataDirectory, { recursive: true });
  const db = new Database(databasePath);

  try {
    db.pragma("foreign_keys = ON");
    const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
    db.transaction(() => db.exec(schema))();

    if (!verify) return;

    db.exec("BEGIN");
    try {
      const marker = `Phase 1 check ${randomUUID()}`;
      const user = db.prepare("INSERT INTO users (name, email) VALUES (?, ?)")
        .run(marker, `${randomUUID()}@example.invalid`).lastInsertRowid;
      const facility = db.prepare("INSERT INTO facilities (name) VALUES (?)")
        .run(marker).lastInsertRowid;
      const reservation = db.prepare(`
        INSERT INTO reservations (user_id, facility_id, start_ms, end_ms)
        VALUES (?, ?, ?, ?)
      `).run(user, facility, 1000, 2000).lastInsertRowid;
      const block = db.prepare(`
        INSERT INTO academic_schedule_blocks (facility_id, title, start_ms, end_ms)
        VALUES (?, ?, ?, ?)
      `).run(facility, marker, 2000, 3000).lastInsertRowid;

      assert.deepEqual(db.prepare(`
        SELECT u.name, f.name AS facility, r.status, b.title
        FROM reservations r
        JOIN users u ON u.id = r.user_id
        JOIN facilities f ON f.id = r.facility_id
        JOIN academic_schedule_blocks b ON b.facility_id = f.id
        WHERE r.id = ? AND b.id = ?
      `).get(reservation, block), {
        name: marker, facility: marker, status: "pending", title: marker,
      });

      assert.throws(() => db.prepare(`
        INSERT INTO academic_schedule_blocks (facility_id, title, start_ms, end_ms)
        VALUES (?, ?, 2000, 2000)
      `).run(facility, marker), { code: "SQLITE_CONSTRAINT_CHECK" });

      assert.throws(() => db.prepare(`
        INSERT INTO reservations (user_id, facility_id, start_ms, end_ms)
        VALUES (
          (SELECT coalesce(max(id), 0) + 1 FROM users), ?, 1000, 2000
        )
      `).run(facility), { code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
    } finally {
      db.exec("ROLLBACK");
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const verify = process.argv.includes("--verify");
  initializeDatabase(verify);
  console.log(`SQLite ${verify ? "read/write verified (sample rows rolled back)" : "initialized"} at ${databasePath}`);
}
