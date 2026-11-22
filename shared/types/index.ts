export interface HealthResponse {
  status: "ok";
}

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface Facility {
  id: number;
  name: string;
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
