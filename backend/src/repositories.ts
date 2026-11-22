import type Database from "better-sqlite3";
import type { AcademicScheduleBlock, Facility, Reservation, User } from "../../shared/types/index.ts";

type FacilityRow = Omit<Facility, "active"> & { active: 0 | 1 };

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
  const user = db.prepare<[number], User>("SELECT id, name, email, role FROM users WHERE id = ?");
  const reservationColumns = "id, user_id AS userId, facility_id AS facilityId, start_ms AS start, end_ms AS end, status";
  const reservations = db.prepare<[], Reservation>(
    `SELECT ${reservationColumns} FROM reservations ORDER BY start_ms, id`,
  );
  const facilityReservations = db.prepare<[number], Reservation>(
    `SELECT ${reservationColumns} FROM reservations WHERE facility_id = ? ORDER BY start_ms, id`,
  );
  const academicBlocks = db.prepare<[number], AcademicScheduleBlock>(`
    SELECT id, facility_id AS facilityId, title, start_ms AS start, end_ms AS end
    FROM academic_schedule_blocks WHERE facility_id = ? ORDER BY start_ms, id
  `);

  return {
    listFacilities: () => facilities.all().map(toFacility),
    getFacility(id: number) {
      const row = facility.get(id);
      return row && toFacility(row);
    },
    getUser: (id: number) => user.get(id),
    listReservations: (facilityId?: number) =>
      facilityId === undefined ? reservations.all() : facilityReservations.all(facilityId),
    listAcademicBlocks: (facilityId: number) => academicBlocks.all(facilityId),
  };
}
