import type { HealthResponse } from "../../shared/types/index.ts";
import "./style.css";

const status = document.querySelector<HTMLParagraphElement>("#api-status");

async function checkApi(): Promise<void> {
  if (!status) return;

  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error("Health request failed");
    const health: HealthResponse = await response.json();
    if (health.status !== "ok") throw new Error("Unexpected health response");
    status.textContent = "API connected";
  } catch {
    status.textContent = "API unavailable";
  }
}

void checkApi();
