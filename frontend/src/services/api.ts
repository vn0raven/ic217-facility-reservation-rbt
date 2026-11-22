import type { ApiResponse, Facility, HealthResponse } from "../../../shared/types/index.ts";

export async function getHealth(): Promise<void> {
  const response = await fetch("/api/health");
  if (!response.ok) throw new Error("API unavailable");
  const health: HealthResponse = await response.json();
  if (health.status !== "ok") throw new Error("Unexpected health response");
}

export async function getFacilities(): Promise<Facility[]> {
  const response = await fetch("/api/facilities");
  const result: ApiResponse<Facility[]> = await response.json();
  if (!result.ok) throw new Error(result.error.message);
  if (!response.ok) throw new Error("Unable to load facilities");
  return result.data;
}
