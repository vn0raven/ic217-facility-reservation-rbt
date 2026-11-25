import type { Facility } from "../../../shared/types/index.ts";
import { showFieldError } from "../components/form-field.ts";
import { checkAvailability, createReservation } from "../services/api.ts";
import type { ActorSession } from "../services/session.ts";
import {
  formatManilaRange,
  formatRoleLabel,
  manilaToUtcMs,
  todayManilaDateString,
} from "../services/time.ts";

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
  const checkButton = document.querySelector<HTMLButtonElement>("#check-availability")!;
  const submitButton = form.querySelector<HTMLButtonElement>("button[type='submit']")!;

  if (!date.value) date.value = todayManilaDateString();

  let activeFacilityCount = 0;
  let busy = false;

  function syncFormState(): void {
    const actor = session.getActor();
    if (actor) {
      requesterNote.textContent = `Submitting as: ${actor.name} (${formatRoleLabel(actor.role)})`;
    } else {
      requesterNote.textContent = "No demonstration user available. Seed demo data on the backend first.";
    }
    checkButton.disabled = busy || activeFacilityCount === 0;
    submitButton.disabled = busy || activeFacilityCount === 0 || !actor;
  }

  function validateSelectedInterval(): { facilityId: number; startMs: number; endMs: number } | undefined {
    if (!facility.reportValidity() || !date.reportValidity() || !start.reportValidity() || !end.reportValidity()) {
      return undefined;
    }
    const startMs = manilaToUtcMs(date.value, start.value);
    const endMs = manilaToUtcMs(date.value, end.value);
    const invalidInterval =
      startMs === undefined || endMs === undefined || endMs <= startMs
        ? "End time must be after start time."
        : "";
    if (!showFieldError(end, invalidInterval)) return undefined;
    return { facilityId: Number(facility.value), startMs: startMs!, endMs: endMs! };
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

  checkButton.addEventListener("click", async () => {
    const interval = validateSelectedInterval();
    if (!interval) return;

    busy = true;
    syncFormState();
    feedback.dataset.tone = "info";
    feedback.textContent = "Checking facility Red-Black Tree schedule…";

    try {
      const result = await checkAvailability(interval.facilityId, interval.startMs, interval.endMs);
      if (result.available) {
        feedback.dataset.tone = "success";
        feedback.textContent = "Slot is available in the facility's active schedule.";
      } else if (result.conflict) {
        const label = result.conflict.kind === "academic"
          ? `academic block "${result.conflict.title}"`
          : `approved reservation "${result.conflict.purpose}"`;
        feedback.dataset.tone = "error";
        feedback.textContent = `Unavailable: overlaps ${label} (${formatManilaRange(result.conflict.start, result.conflict.end)}).`;
      } else {
        feedback.dataset.tone = "error";
        feedback.textContent = "This time slot is currently unavailable.";
      }
    } catch (error) {
      feedback.dataset.tone = "error";
      feedback.textContent = error instanceof Error ? error.message : "Unable to check availability.";
    } finally {
      busy = false;
      syncFormState();
    }
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const actor = session.getActor();
    if (!actor) {
      feedback.dataset.tone = "error";
      feedback.textContent = "Select a demonstration user before submitting a reservation.";
      return;
    }

    const interval = validateSelectedInterval();
    if (!interval) return;

    const trimmedPurpose = purpose.value.trim();
    if (!showFieldError(purpose, trimmedPurpose ? "" : "Enter a reservation purpose.")) return;

    busy = true;
    syncFormState();
    feedback.dataset.tone = "info";
    feedback.textContent = "Submitting reservation request…";

    try {
      const chosenDate = date.value;
      await createReservation({
        userId: actor.id,
        facilityId: interval.facilityId,
        start: interval.startMs,
        end: interval.endMs,
        purpose: trimmedPurpose,
      });
      form.reset();
      date.value = chosenDate;
      feedback.dataset.tone = "success";
      feedback.textContent = "Reservation request submitted as Pending. Open Reservations to track or review it.";
      await onCreated();
    } catch (error) {
      feedback.dataset.tone = "error";
      feedback.textContent = error instanceof Error ? error.message : "Unable to submit reservation.";
    } finally {
      busy = false;
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
