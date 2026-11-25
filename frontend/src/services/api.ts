import type {
  AcademicScheduleBlock,
  ApiResponse,
  AvailabilityCheckResult,
  CreateAcademicBlockInput,
  CreateFacilityInput,
  CreateReservationInput,
  DeleteAcademicBlockInput,
  Facility,
  FacilityScheduleItem,
  FacilityTreeLookupView,
  FacilityTreeSnapshotView,
  HealthResponse,
  Reservation,
  ReservationStatus,
  UpdateFacilityInput,
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

export function createFacility(input: CreateFacilityInput): Promise<Facility> {
  return requestApi<Facility>("/api/facilities", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function updateFacility(id: number, input: UpdateFacilityInput): Promise<Facility> {
  return requestApi<Facility>(`/api/facilities/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function getFacilitySchedule(
  facilityId: number,
  start: number,
  end: number,
): Promise<FacilityScheduleItem[]> {
  const params = new URLSearchParams({ start: String(start), end: String(end) });
  return requestApi<FacilityScheduleItem[]>(`/api/facilities/${facilityId}/schedule?${params.toString()}`);
}

export function getFacilityTree(facilityId: number): Promise<FacilityTreeSnapshotView> {
  return requestApi<FacilityTreeSnapshotView>(`/api/facilities/${facilityId}/tree`);
}

export function lookupFacilityTree(
  facilityId: number,
  start: number,
  end: number,
): Promise<FacilityTreeLookupView> {
  const params = new URLSearchParams({ start: String(start), end: String(end) });
  return requestApi<FacilityTreeLookupView>(
    `/api/facilities/${facilityId}/tree/lookup?${params.toString()}`,
  );
}

export function checkAvailability(
  facilityId: number,
  start: number,
  end: number,
): Promise<AvailabilityCheckResult> {
  const params = new URLSearchParams({
    facilityId: String(facilityId),
    start: String(start),
    end: String(end),
  });
  return requestApi<AvailabilityCheckResult>(`/api/schedule/availability?${params.toString()}`);
}

export function getAcademicBlocks(facilityId?: number): Promise<AcademicScheduleBlock[]> {
  const query = facilityId === undefined ? "" : `?facilityId=${facilityId}`;
  return requestApi<AcademicScheduleBlock[]>(`/api/academic-blocks${query}`);
}

export function createAcademicBlock(input: CreateAcademicBlockInput): Promise<AcademicScheduleBlock> {
  return requestApi<AcademicScheduleBlock>("/api/academic-blocks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export function deleteAcademicBlock(
  id: number,
  input: DeleteAcademicBlockInput,
): Promise<AcademicScheduleBlock> {
  return requestApi<AcademicScheduleBlock>(`/api/academic-blocks/${id}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
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
