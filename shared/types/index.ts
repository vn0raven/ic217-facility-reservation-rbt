export interface HealthResponse {
  status: "ok";
}

export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } };

export type UserRole = "requester" | "admin";

export interface User {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export interface Facility {
  id: number;
  name: string;
  location: string | null;
  capacity: number | null;
  active: boolean;
}

export interface ScheduleInterval {
  facilityId: number;
  start: number;
  end: number;
}

export type ReservationStatus = "pending" | "confirmed" | "rejected" | "cancelled";

export interface Reservation extends ScheduleInterval {
  id: number;
  userId: number;
  status: ReservationStatus;
}

export interface AcademicScheduleBlock extends ScheduleInterval {
  id: number;
  title: string;
}
