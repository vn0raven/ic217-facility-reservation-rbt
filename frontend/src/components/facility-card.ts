import type { Facility } from "../../../shared/types/index.ts";

export interface FacilityCardOptions {
  canManage?: boolean;
  onToggleActive?: (facility: Facility, button: HTMLButtonElement) => void;
  onInspectTree?: (facilityId: number) => void;
}

export function createFacilityCard(
  facility: Facility,
  options?: FacilityCardOptions,
): HTMLLIElement {
  const card = document.createElement("li");
  card.className = "panel";

  const header = document.createElement("div");
  header.className = "card-header";

  const heading = document.createElement("h2");
  heading.textContent = facility.name;

  const badge = document.createElement("span");
  badge.className = facility.active ? "badge badge-confirmed" : "badge badge-cancelled";
  badge.textContent = facility.active ? "Active" : "Inactive";

  header.append(heading, badge);

  const details = document.createElement("dl");
  const information = [
    ["Location", facility.location ?? "Unspecified"],
    ["Capacity", facility.capacity?.toString() ?? "Unspecified"],
  ];

  for (const [label, value] of information) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    details.append(term, description);
  }

  card.append(header, details);

  if (options?.onInspectTree || (options?.canManage && options.onToggleActive)) {
    const actionBar = document.createElement("div");
    actionBar.className = "card-actions";

    if (options.onInspectTree) {
      const inspectBtn = document.createElement("button");
      inspectBtn.type = "button";
      inspectBtn.className = "btn-secondary";
      inspectBtn.textContent = "Inspect RBT";
      inspectBtn.addEventListener("click", () => options.onInspectTree!(facility.id));
      actionBar.append(inspectBtn);
    }

    if (options.canManage && options.onToggleActive) {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = facility.active ? "btn-danger" : "";
      toggleBtn.textContent = facility.active ? "Set inactive" : "Activate";
      toggleBtn.addEventListener("click", () => options.onToggleActive!(facility, toggleBtn));
      actionBar.append(toggleBtn);
    }

    card.append(actionBar);
  }

  return card;
}
