import type {
  Facility,
  Reservation,
  ReservationAction,
  User,
} from "../../../shared/types/index.ts";
import { formatManilaRange, formatRoleLabel, formatStatusLabel } from "../services/time.ts";

export interface ReservationCardContext {
  reservation: Reservation;
  facility: Facility | undefined;
  requester: User | undefined;
  actor: User | undefined;
  onAction: (reservationId: number, action: ReservationAction, buttons: HTMLButtonElement[]) => void;
}

export function createReservationCard(context: ReservationCardContext): HTMLLIElement {
  const { reservation, facility, requester, actor, onAction } = context;
  const card = document.createElement("li");
  card.className = "panel reservation-card";

  const header = document.createElement("div");
  header.className = "card-header";

  const heading = document.createElement("h2");
  heading.textContent = facility?.name ?? `Facility #${reservation.facilityId}`;

  const badge = document.createElement("span");
  badge.className = `badge badge-${reservation.status}`;
  badge.textContent = formatStatusLabel(reservation.status);

  header.append(heading, badge);

  const details = document.createElement("dl");
  const requesterLabel = requester
    ? `${requester.name} (${formatRoleLabel(requester.role)}${requester.department ? ` · ${requester.department}` : ""})`
    : `User #${reservation.userId}`;

  const rows: ReadonlyArray<[string, string]> = [
    ["Schedule", formatManilaRange(reservation.start, reservation.end)],
    ["Requester", requesterLabel],
    ["Purpose", reservation.purpose],
  ];

  for (const [termText, descText] of rows) {
    const term = document.createElement("dt");
    term.textContent = termText;
    const desc = document.createElement("dd");
    desc.textContent = descText;
    details.append(term, desc);
  }

  card.append(header, details);

  const actions = getAvailableActions(reservation, actor);
  if (actions.length > 0) {
    const actionBar = document.createElement("div");
    actionBar.className = "card-actions";
    const buttons: HTMLButtonElement[] = [];

    for (const spec of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = spec.variant;
      button.textContent = spec.label;
      button.addEventListener("click", () => onAction(reservation.id, spec.action, buttons));
      buttons.push(button);
      actionBar.append(button);
    }

    card.append(actionBar);
  }

  return card;
}

function getAvailableActions(
  reservation: Reservation,
  actor: User | undefined,
): Array<{ action: ReservationAction; label: string; variant: string }> {
  if (!actor) return [];

  const available: Array<{ action: ReservationAction; label: string; variant: string }> = [];
  const isPersonnel = actor.role === "personnel";
  const isOwner = actor.id === reservation.userId;

  if (isPersonnel && reservation.status === "pending") {
    available.push({ action: "approve", label: "Approve", variant: "btn-primary" });
    available.push({ action: "reject", label: "Reject", variant: "btn-danger" });
  }

  if (
    (reservation.status === "pending" && isOwner) ||
    (reservation.status === "confirmed" && (isOwner || isPersonnel))
  ) {
    available.push({ action: "cancel", label: "Cancel reservation", variant: "btn-secondary" });
  }

  return available;
}
