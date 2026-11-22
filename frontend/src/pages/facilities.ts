import type { Facility } from "../../../shared/types/index.ts";
import { createFacilityCard } from "../components/facility-card.ts";

export async function renderFacilities(request: Promise<Facility[]>): Promise<void> {
  const status = document.querySelector<HTMLParagraphElement>("#facility-status")!;
  const list = document.querySelector<HTMLUListElement>("#facility-list")!;

  try {
    const facilities = await request;
    list.replaceChildren(...facilities.map(createFacilityCard));
    status.textContent = facilities.length === 0 ? "No facilities are listed yet." : "";
  } catch {
    status.textContent = "Unable to load facilities. Refresh the page to try again.";
  }
}
