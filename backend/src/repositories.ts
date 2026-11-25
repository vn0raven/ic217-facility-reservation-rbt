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
  const academicBlocks = db.prepare<[number], AcademicScheduleBlock>(`
    SELECT id, facility_id AS facilityId, title, start_ms AS start, end_ms AS end
    FROM academic_schedule_blocks WHERE facility_id = ? ORDER BY start_ms, id
  `);

  return {
    listUsers: () => users.all(),
    getUser: (id: number) => user.get(id),
    listFacilities: () => facilities.all().map(toFacility),
    getFacility(id: number) {
      const row = facility.get(id);
      return row && toFacility(row);
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
    listAcademicBlocks: (facilityId: number) => academicBlocks.all(facilityId),
    runInTransaction<T>(operation: () => T): T {
      return db.transaction(operation).immediate();
    },
  };
}
