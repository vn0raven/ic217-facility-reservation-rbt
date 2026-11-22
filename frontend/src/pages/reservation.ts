import type { Facility } from "../../../shared/types/index.ts";
import { showFieldError } from "../components/form-field.ts";

export async function initializeReservationForm(request: Promise<Facility[]>): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("#reservation-form")!;
  const facility = document.querySelector<HTMLSelectElement>("#facility")!;
  const start = document.querySelector<HTMLInputElement>("#start")!;
  const end = document.querySelector<HTMLInputElement>("#end")!;
  const purpose = document.querySelector<HTMLTextAreaElement>("#purpose")!;
  const feedback = document.querySelector<HTMLParagraphElement>("#form-status")!;
  const button = form.querySelector<HTMLButtonElement>("button")!;

  form.addEventListener("input", () => {
    end.setCustomValidity("");
    purpose.setCustomValidity("");
    feedback.textContent = "";
  });
  form.addEventListener("invalid", event => {
    const field = event.target;
    if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement ||
        field instanceof HTMLTextAreaElement) {
      feedback.textContent = field.validationMessage;
    }
  }, true);
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!showFieldError(end, end.value <= start.value ? "End time must be after start time." : "")) {
      return;
    }
    if (!showFieldError(purpose, purpose.value.trim() ? "" : "Enter a reservation purpose.")) {
      return;
    }
    feedback.textContent = "Reservation details are valid. This form is a preview.";
  });

  try {
    const active = (await request).filter(item => item.active);
    facility.options[0].text = active.length ? "Choose a facility" : "No active facilities";
    facility.append(...active.map(item => new Option(item.name, String(item.id))));
    button.disabled = active.length === 0;
  } catch {
    facility.options[0].text = "Facilities unavailable";
    feedback.textContent = "Unable to load facilities. Refresh the page to try again.";
  }
}
