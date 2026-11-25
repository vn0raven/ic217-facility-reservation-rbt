import type Database from "better-sqlite3";
import type {
  AcademicScheduleBlock,
  CreateReservationInput,
  Facility,
  Reservation,
  ReservationStatus,
  User,
} from "../../shared/types/index.ts";

type FacilityRow = Omit<Facility, "active"> & { active: 0 | 1 };

export interface ReservationFilters {
  facilityId?: number;
  userId?: number;
  status?: ReservationStatus;
}

function toFacility(row: FacilityRow): Facility {
  return { ...row, active: row.active === 1 };
}

export function createRepositories(db: Database.Database) {
  const facilities = db.prepare<[], FacilityRow>(
    "SELECT id, name, location, capacity, active FROM facilities ORDER BY name, id",
  );
  const facility = db.prepare<[number], FacilityRow>(
    "SELECT id, name, location, capacity, active FROM facilities WHERE id = ?",
  );
  const facilityByName = db.prepare<[string], FacilityRow>(
    "SELECT id, name, location, capacity, active FROM facilities WHERE name = ?",
  );
  const insertFacility = db.prepare<[string, string | null, number | null, 0 | 1]>(
    "INSERT INTO facilities (name, location, capacity, active) VALUES (?, ?, ?, ?)",
  );
  const updateFacilityRow = db.prepare<[string | null, number | null, 0 | 1, number]>(
    "UPDATE facilities SET location = ?, capacity = ?, active = ? WHERE id = ?",
  );

  const users = db.prepare<[], User>(
    "SELECT id, name, email, role, department FROM users ORDER BY id",
  );
  const user = db.prepare<[number], User>(
    "SELECT id, name, email, role, department FROM users WHERE id = ?",
  );

  const reservationColumns = `
    id,
    user_id AS userId,
    facility_id AS facilityId,
    purpose,
    start_ms AS start,
    end_ms AS end,
    status,
    created_at_ms AS createdAt
  `;
  const reservationById = db.prepare<[number], Reservation>(
    `SELECT ${reservationColumns} FROM reservations WHERE id = ?`,
  );
  const insertReservation = db.prepare<[number, number, string, number, number, number]>(
    `INSERT INTO reservations (user_id, facility_id, purpose, start_ms, end_ms, created_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const updateStatus = db.prepare<[ReservationStatus, number]>(
    "UPDATE reservations SET status = ? WHERE id = ?",
  );

  const academicColumns = "id, facility_id AS facilityId, title, start_ms AS start, end_ms AS end";
  const allAcademicBlocks = db.prepare<[], AcademicScheduleBlock>(
    `SELECT ${academicColumns} FROM academic_schedule_blocks ORDER BY start_ms, id`,
  );
  const facilityAcademicBlocks = db.prepare<[number], AcademicScheduleBlock>(
    `SELECT ${academicColumns} FROM academic_schedule_blocks WHERE facility_id = ? ORDER BY start_ms, id`,
  );
  const academicBlockById = db.prepare<[number], AcademicScheduleBlock>(
    `SELECT ${academicColumns} FROM academic_schedule_blocks WHERE id = ?`,
  );
  const insertAcademicBlock = db.prepare<[number, string, number, number]>(
    `INSERT INTO academic_schedule_blocks (facility_id, title, start_ms, end_ms)
     VALUES (?, ?, ?, ?)`,
  );
  const removeAcademicBlock = db.prepare<[number]>(
    "DELETE FROM academic_schedule_blocks WHERE id = ?",
  );

  return {
    listUsers: () => users.all(),
    getUser: (id: number) => user.get(id),
    listFacilities: () => facilities.all().map(toFacility),
    getFacility(id: number) {
      const row = facility.get(id);
      return row && toFacility(row);
    },
    getFacilityByName(name: string) {
      const row = facilityByName.get(name);
      return row && toFacility(row);
    },
    createFacility(input: {
      name: string;
      location: string | null;
      capacity: number | null;
      active: boolean;
    }): Facility {
      const info = insertFacility.run(
        input.name.trim(),
        input.location === null ? null : input.location.trim(),
        input.capacity,
        input.active ? 1 : 0,
      );
      return toFacility(facility.get(Number(info.lastInsertRowid))!);
    },
    updateFacility(
      id: number,
      patch: { location?: string | null; capacity?: number | null; active?: boolean },
    ): Facility | undefined {
      const current = facility.get(id);
      if (!current) return undefined;
      const nextLocation = patch.location !== undefined
        ? (patch.location === null ? null : patch.location.trim())
        : current.location;
      const nextCapacity = patch.capacity !== undefined ? patch.capacity : current.capacity;
      const nextActive: 0 | 1 = patch.active !== undefined ? (patch.active ? 1 : 0) : current.active;
      updateFacilityRow.run(nextLocation, nextCapacity, nextActive, id);
      return toFacility(facility.get(id)!);
    },
    getReservation: (id: number) => reservationById.get(id),
    listReservations(filter?: number | ReservationFilters): Reservation[] {
      const normalized: ReservationFilters =
        typeof filter === "number" ? { facilityId: filter } : (filter ?? {});
      const clauses: string[] = [];
      const params: Array<number | string> = [];

      if (normalized.facilityId !== undefined) {
        clauses.push("facility_id = ?");
        params.push(normalized.facilityId);
      }
      if (normalized.userId !== undefined) {
        clauses.push("user_id = ?");
        params.push(normalized.userId);
      }
      if (normalized.status !== undefined) {
        clauses.push("status = ?");
        params.push(normalized.status);
      }

      const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
      return db
        .prepare<Array<number | string>, Reservation>(
          `SELECT ${reservationColumns} FROM reservations ${where} ORDER BY start_ms, id`,
        )
        .all(...params);
    },
    createReservation(input: CreateReservationInput & { createdAt?: number }): Reservation {
      const createdAt = input.createdAt ?? Date.now();
      const info = insertReservation.run(
        input.userId,
        input.facilityId,
        input.purpose.trim(),
        input.start,
        input.end,
        createdAt,
      );
      return reservationById.get(Number(info.lastInsertRowid))!;
    },
    updateReservationStatus(id: number, status: ReservationStatus): Reservation | undefined {
      const result = updateStatus.run(status, id);
      if (result.changes === 0) return undefined;
      return reservationById.get(id);
    },
    getAcademicBlock: (id: number) => academicBlockById.get(id),
    listAcademicBlocks: (facilityId?: number) =>
      facilityId === undefined ? allAcademicBlocks.all() : facilityAcademicBlocks.all(facilityId),
    createAcademicBlock(input: {
      facilityId: number;
      title: string;
      start: number;
      end: number;
    }): AcademicScheduleBlock {
      const info = insertAcademicBlock.run(
        input.facilityId,
        input.title.trim(),
        input.start,
        input.end,
      );
      return academicBlockById.get(Number(info.lastInsertRowid))!;
    },
    deleteAcademicBlock(id: number): AcademicScheduleBlock | undefined {
      const existing = academicBlockById.get(id);
      if (!existing) return undefined;
      const result = removeAcademicBlock.run(id);
      return result.changes > 0 ? existing : undefined;
    },
    runInTransaction<T>(operation: () => T): T {
      return db.transaction(operation).immediate();
    },
  };
}
