import type {
  Facility,
  Reservation,
  ReservationAction,
  ReservationStatus,
  User,
} from "../../../shared/types/index.ts";
import { createReservationCard } from "../components/reservation-card.ts";
import { getReservations, updateReservationStatus } from "../services/api.ts";
import type { ActorSession } from "../services/session.ts";
import { formatRoleLabel, formatStatusLabel } from "../services/time.ts";

export interface ReservationsController {
  refresh(): Promise<void>;
}

export async function initializeReservationsPage(
  facilitiesRequest: Promise<Facility[]>,
  session: ActorSession,
  onSummaryChange: (reservations: Reservation[]) => void,
): Promise<ReservationsController> {
  const actorBanner = document.querySelector<HTMLParagraphElement>("#reservations-actor-hint")!;
  const facilityFilter = document.querySelector<HTMLSelectElement>("#filter-facility")!;
  const statusFilter = document.querySelector<HTMLSelectElement>("#filter-status")!;
  const refreshButton = document.querySelector<HTMLButtonElement>("#refresh-reservations")!;
  const feedback = document.querySelector<HTMLParagraphElement>("#reservations-status")!;
  const list = document.querySelector<HTMLUListElement>("#reservation-list")!;

  let facilitiesById = new Map<number, Facility>();
  let latestReservations: Reservation[] = [];

  try {
    const facilities = await facilitiesRequest;
    facilitiesById = new Map(facilities.map(item => [item.id, item]));
    facilityFilter.append(...facilities.map(item => new Option(item.name, String(item.id))));
  } catch {
    // Facility filter remains at "All facilities" if initial fetch failed.
  }

  function updateActorBanner(): void {
    const actor = session.getActor();
    if (!actor) {
      actorBanner.textContent = "No demonstration user selected.";
      return;
    }
    actorBanner.textContent = actor.role === "personnel"
      ? `Acting as ${actor.name} (${formatRoleLabel(actor.role)}) — you may approve or reject pending requests and cancel approved bookings.`
      : `Acting as ${actor.name} (${formatRoleLabel(actor.role)}) — you may view schedules and cancel your own pending or approved requests.`;
  }

  function renderList(): void {
    const usersById = new Map<number, User>(session.getUsers().map(user => [user.id, user]));
    const actor = session.getActor();
    const selectedFacility = facilityFilter.value ? Number(facilityFilter.value) : undefined;
    const selectedStatus = (statusFilter.value || undefined) as ReservationStatus | undefined;

    const filtered = latestReservations.filter(item => {
      if (selectedFacility !== undefined && item.facilityId !== selectedFacility) return false;
      if (selectedStatus !== undefined && item.status !== selectedStatus) return false;
      return true;
    });

    list.replaceChildren(
      ...filtered.map(reservation =>
        createReservationCard({
          reservation,
          facility: facilitiesById.get(reservation.facilityId),
          requester: usersById.get(reservation.userId),
          actor,
          onAction: handleAction,
        }),
      ),
    );

    if (filtered.length === 0) {
      feedback.dataset.tone = "info";
      feedback.textContent = latestReservations.length === 0
        ? "No reservations have been submitted yet."
        : "No reservations match the selected filters.";
    } else if (feedback.dataset.tone === "info") {
      feedback.textContent = "";
      delete feedback.dataset.tone;
    }
  }

  async function handleAction(
    reservationId: number,
    action: ReservationAction,
    buttons: HTMLButtonElement[],
  ): Promise<void> {
    const actor = session.getActor();
    if (!actor) return;

    for (const btn of buttons) btn.disabled = true;
    feedback.dataset.tone = "info";
    feedback.textContent = "Updating reservation status…";

    try {
      const updated = await updateReservationStatus(reservationId, {
        actorUserId: actor.id,
        action,
      });
      await refresh();
      feedback.dataset.tone = "success";
      feedback.textContent = `Reservation #${updated.id} is now ${formatStatusLabel(updated.status)}.`;
    } catch (error) {
      for (const btn of buttons) btn.disabled = false;
      feedback.dataset.tone = "error";
      feedback.textContent = error instanceof Error ? error.message : "Unable to update reservation.";
    }
  }

  async function refresh(): Promise<void> {
    try {
      latestReservations = await getReservations();
      onSummaryChange(latestReservations);
      renderList();
    } catch {
      feedback.dataset.tone = "error";
      feedback.textContent = "Unable to load reservations. Check that the backend server is running.";
    }
  }

  facilityFilter.addEventListener("change", renderList);
  statusFilter.addEventListener("change", renderList);
  refreshButton.addEventListener("click", () => {
    feedback.textContent = "";
    delete feedback.dataset.tone;
    void refresh();
  });

  session.subscribe(() => {
    updateActorBanner();
    renderList();
  });

  await refresh();
  return { refresh };
}
