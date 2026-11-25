import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import type { UserRole } from "../../shared/types/index.ts";

const dataDirectory = new URL("../data/", import.meta.url);
const databasePath = fileURLToPath(new URL("ic217.sqlite", dataDirectory));

const DEMO_USERS: ReadonlyArray<{
  name: string;
  email: string;
  role: UserRole;
  department: string;
}> = [
  {
    name: "Maria Santos",
    email: "maria.santos@usep.edu.ph",
    role: "student",
    department: "College of Information and Computing",
  },
  {
    name: "Prof. Marco Reyes",
    email: "marco.reyes@usep.edu.ph",
    role: "faculty",
    department: "College of Information and Computing",
  },
  {
    name: "Engr. Carla Lim",
    email: "carla.lim@usep.edu.ph",
    role: "visitor",
    department: "College of Engineering",
  },
  {
    name: "Elena Cruz",
    email: "elena.cruz@usep.edu.ph",
    role: "personnel",
    department: "CIC Department Office",
  },
];

const DEMO_FACILITIES: ReadonlyArray<{
  name: string;
  location: string;
  capacity: number;
  active: 0 | 1;
}> = [
  { name: "IC Lecture Room 101", location: "IC Building, 1st Floor", capacity: 45, active: 1 },
  { name: "Programming Laboratory 1", location: "IC Building, 2nd Floor", capacity: 40, active: 1 },
  { name: "Networking & Cisco Laboratory", location: "IC Building, 2nd Floor", capacity: 35, active: 1 },
  { name: "CIC Conference Room", location: "IC Building, 3rd Floor", capacity: 20, active: 1 },
  { name: "Audio-Visual Room", location: "IC Building, Ground Floor", capacity: 80, active: 0 },
];

export function openDatabase(filename = databasePath): Database.Database {
  if (filename === databasePath) mkdirSync(dataDirectory, { recursive: true });
  const db = new Database(filename);

  try {
    const initialVersion = db.pragma("user_version", { simple: true });
    if (typeof initialVersion !== "number" || ![0, 1, 2].includes(initialVersion)) {
      throw new Error(`Unsupported database schema version: ${String(initialVersion)}`);
    }

    if (initialVersion < 2) {
      const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
      db.pragma("foreign_keys = OFF");
      try {
        db.transaction(() => {
          let version = db.pragma("user_version", { simple: true }) as number;
          if (version === 0) {
            db.exec(schema);
            db.exec(`
              ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'requester'
                CHECK (role IN ('requester', 'admin'));
              ALTER TABLE facilities ADD COLUMN location TEXT CHECK (length(trim(location)) > 0);
              ALTER TABLE facilities ADD COLUMN capacity INTEGER
                CHECK (capacity BETWEEN 1 AND 9007199254740991);
              ALTER TABLE facilities ADD COLUMN active INTEGER NOT NULL DEFAULT 1
                CHECK (active IN (0, 1));
              CREATE INDEX reservations_by_facility_start ON reservations (facility_id, start_ms, id);
              PRAGMA user_version = 1;
            `);
            version = 1;
          }

          if (version === 1) {
            db.exec(`
              CREATE TABLE users_v2 (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                email TEXT NOT NULL COLLATE NOCASE UNIQUE CHECK (length(trim(email)) > 0),
                role TEXT NOT NULL DEFAULT 'student'
                  CHECK (role IN ('student', 'faculty', 'visitor', 'personnel')),
                department TEXT CHECK (department IS NULL OR length(trim(department)) > 0)
              ) STRICT;

              INSERT INTO users_v2 (id, name, email, role, department)
              SELECT
                id,
                name,
                email,
                CASE role
                  WHEN 'admin' THEN 'personnel'
                  WHEN 'requester' THEN 'student'
                  ELSE role
                END,
                NULL
              FROM users;

              DROP TABLE users;
              ALTER TABLE users_v2 RENAME TO users;

              CREATE TABLE reservations_v2 (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id),
                facility_id INTEGER NOT NULL REFERENCES facilities(id),
                purpose TEXT NOT NULL CHECK (length(trim(purpose)) BETWEEN 1 AND 250),
                start_ms INTEGER NOT NULL,
                end_ms INTEGER NOT NULL CHECK (end_ms > start_ms),
                status TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'confirmed', 'rejected', 'cancelled')),
                created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0)
              ) STRICT;

              INSERT INTO reservations_v2 (
                id, user_id, facility_id, purpose, start_ms, end_ms, status, created_at_ms
              )
              SELECT
                id,
                user_id,
                facility_id,
                'Legacy reservation',
                start_ms,
                end_ms,
                status,
                CASE WHEN start_ms >= 0 THEN start_ms ELSE 0 END
              FROM reservations;

              DROP TABLE reservations;
              ALTER TABLE reservations_v2 RENAME TO reservations;

              CREATE INDEX reservations_by_facility_start ON reservations (facility_id, start_ms, id);
              CREATE INDEX reservations_by_user_start ON reservations (user_id, start_ms, id);
              PRAGMA user_version = 2;
            `);
          }

          const violations = db.pragma("foreign_key_check") as unknown[];
          if (violations.length > 0) {
            throw new Error("Foreign key integrity check failed during database migration.");
          }
        }).immediate();
      } finally {
        db.pragma("foreign_keys = ON");
      }
    } else {
      db.pragma("foreign_keys = ON");
    }

    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export function seedDemoData(db: Database.Database): void {
  const insertUser = db.prepare(`
    INSERT INTO users (name, email, role, department)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO NOTHING
  `);
  const insertFacility = db.prepare(`
    INSERT INTO facilities (name, location, capacity, active)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(name) DO NOTHING
  `);

  db.transaction(() => {
    for (const user of DEMO_USERS) {
      insertUser.run(user.name, user.email, user.role, user.department);
    }
    for (const facility of DEMO_FACILITIES) {
      insertFacility.run(facility.name, facility.location, facility.capacity, facility.active);
    }
  }).immediate();
}

export function initializeDatabase(verify = false, seed = false): void {
  const db = openDatabase(process.env.SQLITE_PATH);
  try {
    if (seed) seedDemoData(db);
    if (!verify) return;

    db.exec("BEGIN");
    try {
      const marker = `Phase 3 check ${randomUUID()}`;
      const user = db.prepare(
        "INSERT INTO users (name, email, role, department) VALUES (?, ?, ?, ?)",
      ).run(marker, `${randomUUID()}@example.invalid`, "student", "CIC").lastInsertRowid;
      const facility = db.prepare(
        "INSERT INTO facilities (name, location, capacity, active) VALUES (?, ?, ?, ?)",
      ).run(marker, "IC Building", 30, 1).lastInsertRowid;
      const reservation = db.prepare(`
        INSERT INTO reservations (user_id, facility_id, purpose, start_ms, end_ms, created_at_ms)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(user, facility, "Capstone group review", 1000, 2000, 900).lastInsertRowid;
      const block = db.prepare(`
        INSERT INTO academic_schedule_blocks (facility_id, title, start_ms, end_ms)
        VALUES (?, ?, ?, ?)
      `).run(facility, marker, 2000, 3000).lastInsertRowid;

      assert.deepEqual(db.prepare(`
        SELECT u.name, u.role, f.name AS facility, r.purpose, r.status, b.title
        FROM reservations r
        JOIN users u ON u.id = r.user_id
        JOIN facilities f ON f.id = r.facility_id
        JOIN academic_schedule_blocks b ON b.facility_id = f.id
        WHERE r.id = ? AND b.id = ?
      `).get(reservation, block), {
        name: marker,
        role: "student",
        facility: marker,
        purpose: "Capstone group review",
        status: "pending",
        title: marker,
      });

      assert.throws(() => db.prepare(`
        INSERT INTO users (name, email, role) VALUES (?, ?, 'invalid_role')
      `).run(marker, `${randomUUID()}@example.invalid`), { code: "SQLITE_CONSTRAINT_CHECK" });

      assert.throws(() => db.prepare(`
        INSERT INTO academic_schedule_blocks (facility_id, title, start_ms, end_ms)
        VALUES (?, ?, 2000, 2000)
      `).run(facility, marker), { code: "SQLITE_CONSTRAINT_CHECK" });

      assert.throws(() => db.prepare(`
        INSERT INTO reservations (user_id, facility_id, purpose, start_ms, end_ms, created_at_ms)
        VALUES (
          (SELECT coalesce(max(id), 0) + 1 FROM users), ?, 'Check FK', 1000, 2000, 900
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
  const seed = process.argv.includes("--seed");
  const target = process.env.SQLITE_PATH ?? databasePath;
  initializeDatabase(verify, seed);
  const actions = [
    "initialized",
    ...(seed ? ["demo data seeded"] : []),
    ...(verify ? ["read/write verified (sample rows rolled back)"] : []),
  ];
  console.log(`SQLite ${actions.join(", ")} at ${target}`);
}
