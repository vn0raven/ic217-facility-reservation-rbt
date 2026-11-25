import type { Facility } from "../../../shared/types/index.ts";
import { showFieldError } from "../components/form-field.ts";
import { createReservation } from "../services/api.ts";
import type { ActorSession } from "../services/session.ts";
import { formatRoleLabel, manilaToUtcMs } from "../services/time.ts";

export async function initializeReservationForm(
  facilitiesRequest: Promise<Facility[]>,
  session: ActorSession,
  onCreated: () => Promise<void>,
): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("#reservation-form")!;
  const requesterNote = document.querySelector<HTMLParagraphElement>("#form-requester")!;
  const facility = document.querySelector<HTMLSelectElement>("#facility")!;
  const date = document.querySelector<HTMLInputElement>("#date")!;
  const start = document.querySelector<HTMLInputElement>("#start")!;
  const end = document.querySelector<HTMLInputElement>("#end")!;
  const purpose = document.querySelector<HTMLTextAreaElement>("#purpose")!;
  const feedback = document.querySelector<HTMLParagraphElement>("#form-status")!;
  const button = form.querySelector<HTMLButtonElement>("button[type='submit']")!;

  let activeFacilityCount = 0;
  let submitting = false;

  function syncFormState(): void {
    const actor = session.getActor();
    if (actor) {
      requesterNote.textContent = `Submitting as: ${actor.name} (${formatRoleLabel(actor.role)})`;
    } else {
      requesterNote.textContent = "No demonstration user available. Seed demo data on the backend first.";
    }
    button.disabled = submitting || activeFacilityCount === 0 || !actor;
  }

  session.subscribe(() => syncFormState());

  form.addEventListener("input", () => {
    end.setCustomValidity("");
    purpose.setCustomValidity("");
    feedback.textContent = "";
    delete feedback.dataset.tone;
  });

  form.addEventListener("invalid", event => {
    const field = event.target;
    if (
      field instanceof HTMLInputElement ||
      field instanceof HTMLSelectElement ||
      field instanceof HTMLTextAreaElement
    ) {
      feedback.dataset.tone = "error";
      feedback.textContent = field.validationMessage;
    }
  }, true);

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const actor = session.getActor();
    if (!actor) {
      feedback.dataset.tone = "error";
      feedback.textContent = "Select a demonstration user before submitting a reservation.";
      return;
    }

    const startMs = manilaToUtcMs(date.value, start.value);
    const endMs = manilaToUtcMs(date.value, end.value);
    const invalidInterval =
      startMs === undefined || endMs === undefined || endMs <= startMs
        ? "End time must be after start time."
        : "";
    if (!showFieldError(end, invalidInterval)) return;

    const trimmedPurpose = purpose.value.trim();
    if (!showFieldError(purpose, trimmedPurpose ? "" : "Enter a reservation purpose.")) return;

    submitting = true;
    syncFormState();
    feedback.dataset.tone = "info";
    feedback.textContent = "Submitting reservation request…";

    try {
      await createReservation({
        userId: actor.id,
        facilityId: Number(facility.value),
        start: startMs!,
        end: endMs!,
        purpose: trimmedPurpose,
      });
      form.reset();
      feedback.dataset.tone = "success";
      feedback.textContent = "Reservation request submitted as Pending. Open Reservations to track or review it.";
      await onCreated();
    } catch (error) {
      feedback.dataset.tone = "error";
      feedback.textContent = error instanceof Error ? error.message : "Unable to submit reservation.";
    } finally {
      submitting = false;
      syncFormState();
    }
  });

  try {
    const active = (await facilitiesRequest).filter(item => item.active);
    activeFacilityCount = active.length;
    facility.options[0].text = active.length ? "Choose a facility" : "No active facilities";
    facility.append(...active.map(item => new Option(item.name, String(item.id))));
    syncFormState();
  } catch {
    facility.options[0].text = "Facilities unavailable";
    feedback.dataset.tone = "error";
    feedback.textContent = "Unable to load facilities. Refresh the page to try again.";
    syncFormState();
  }
}
