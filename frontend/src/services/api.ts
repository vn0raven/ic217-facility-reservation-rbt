import type {
  ApiResponse,
  CreateReservationInput,
  Facility,
  HealthResponse,
  Reservation,
  ReservationStatus,
  UpdateReservationStatusInput,
  User,
} from "../../../shared/types/index.ts";

async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const result = (await response.json()) as ApiResponse<T>;
  if (!result.ok) throw new Error(result.error.message);
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return result.data;
}

export async function getHealth(): Promise<void> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error("API unavailable");
  const health = (await response.json()) as HealthResponse;
  if (health.status !== "ok") throw new Error("Unexpected health response");
}

export function getUsers(): Promise<User[]> {
  return requestApi<User[]>("/api/users");
}

export function getFacilities(): Promise<Facility[]> {
  return requestApi<Facility[]>("/api/facilities");
}

export function getReservations(filters?: {
  facilityId?: number;
  userId?: number;
  status?: ReservationStatus;
}): Promise<Reservation[]> {
  const params = new URLSearchParams();
  if (filters?.facilityId !== undefined) params.set("facilityId", String(filters.facilityId));
  if (filters?.userId !== undefined) params.set("userId", String(filters.userId));
  if (filters?.status !== undefined) params.set("status", filters.status);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return requestApi<Reservation[]>(`/api/reservations${query}`);
}

export function createReservation(input: CreateReservationInput): Promise<Reservation> {
  return requestApi<Reservation>("/api/reservations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateReservationStatus(
  id: number,
  input: UpdateReservationStatusInput,
): Promise<Reservation> {
  return requestApi<Reservation>(`/api/reservations/${id}/status`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}
