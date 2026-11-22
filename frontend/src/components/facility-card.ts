import type { Facility } from "../../../shared/types/index.ts";

export function createFacilityCard(facility: Facility): HTMLLIElement {
  const card = document.createElement("li");
  card.className = "panel";

  const heading = document.createElement("h2");
  heading.textContent = facility.name;
  const details = document.createElement("dl");
  const information = [
    ["Location", facility.location ?? "Unspecified"],
    ["Capacity", facility.capacity?.toString() ?? "Unspecified"],
    ["Status", facility.active ? "Active" : "Inactive"],
  ];

  for (const [label, value] of information) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    details.append(term, description);
  }
  card.append(heading, details);
  return card;
}
