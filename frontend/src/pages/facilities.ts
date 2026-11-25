import type { Facility } from "../../../shared/types/index.ts";
import { createFacilityCard } from "../components/facility-card.ts";
import { showFieldError } from "../components/form-field.ts";
import { createFacility, getFacilities, updateFacility } from "../services/api.ts";
import type { ActorSession } from "../services/session.ts";

export interface FacilitiesController {
  getLatest(): Facility[];
  refresh(): Promise<void>;
}

export async function initializeFacilitiesPage(
  initialRequest: Promise<Facility[]>,
  session: ActorSession,
  callbacks: {
    onFacilitiesChanged: (facilities: Facility[]) => void;
    onInspectFacilityTree: (facilityId: number) => void;
  },
): Promise<FacilitiesController> {
  const status = document.querySelector<HTMLParagraphElement>("#facility-status")!;
  const list = document.querySelector<HTMLUListElement>("#facility-list")!;
  const form = document.querySelector<HTMLFormElement>("#facility-form")!;
  const formHint = document.querySelector<HTMLParagraphElement>("#facility-form-hint")!;
  const nameInput = document.querySelector<HTMLInputElement>("#new-facility-name")!;
  const locationInput = document.querySelector<HTMLInputElement>("#new-facility-location")!;
  const capacityInput = document.querySelector<HTMLInputElement>("#new-facility-capacity")!;
  const formStatus = document.querySelector<HTMLParagraphElement>("#facility-form-status")!;
  const submitButton = form.querySelector<HTMLButtonElement>("button[type='submit']")!;

  let facilities: Facility[] = [];
  let submitting = false;

  function syncFormPermissions(): void {
    const actor = session.getActor();
    const isPersonnel = actor?.role === "personnel";
    formHint.textContent = isPersonnel
      ? `Acting as ${actor.name} (Department Personnel) — new facilities initialize an empty Red-Black Tree immediately.`
      : "Only Department Personnel can add facilities or toggle active status. Switch Demo role in the header to manage facilities.";

    const disabled = !isPersonnel || submitting;
    nameInput.disabled = disabled;
    locationInput.disabled = disabled;
    capacityInput.disabled = disabled;
    submitButton.disabled = disabled;
  }

  function render(): void {
    const canManage = session.getActor()?.role === "personnel";
    list.replaceChildren(
      ...facilities.map(item =>
        createFacilityCard(item, {
          canManage,
          onToggleActive: handleToggleActive,
          onInspectTree: callbacks.onInspectFacilityTree,
        }),
      ),
    );
    if (facilities.length === 0) {
      status.textContent = "No facilities are listed yet.";
    } else if (!status.dataset.tone) {
      status.textContent = "";
    }
  }

  async function handleToggleActive(
    facility: Facility,
    button: HTMLButtonElement,
  ): Promise<void> {
    const actor = session.getActor();
    if (!actor) return;
    button.disabled = true;
    status.dataset.tone = "info";
    status.textContent = "Updating facility status…";

    try {
      const updated = await updateFacility(facility.id, {
        actorUserId: actor.id,
        active: !facility.active,
      });
      await refresh();
      status.dataset.tone = "success";
      status.textContent = `${updated.name} is now ${updated.active ? "Active" : "Inactive"}.`;
    } catch (error) {
      button.disabled = false;
      status.dataset.tone = "error";
      status.textContent = error instanceof Error ? error.message : "Unable to update facility.";
    }
  }

  async function refresh(): Promise<void> {
    facilities = await getFacilities();
    callbacks.onFacilitiesChanged(facilities);
    render();
  }

  form.addEventListener("input", () => {
    nameInput.setCustomValidity("");
    capacityInput.setCustomValidity("");
    formStatus.textContent = "";
    delete formStatus.dataset.tone;
  });

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const actor = session.getActor();
    if (!actor || actor.role !== "personnel") return;

    const trimmedName = nameInput.value.trim();
    if (!showFieldError(nameInput, trimmedName ? "" : "Enter a facility name.")) return;

    const rawCapacity = capacityInput.value.trim();
    let parsedCapacity: number | null = null;
    if (rawCapacity !== "") {
      const numeric = Number(rawCapacity);
      if (!Number.isSafeInteger(numeric) || numeric < 1) {
        showFieldError(capacityInput, "Capacity must be a positive whole number.");
        return;
      }
      parsedCapacity = numeric;
    }

    submitting = true;
    syncFormPermissions();
    formStatus.dataset.tone = "info";
    formStatus.textContent = "Creating facility…";

    try {
      const created = await createFacility({
        actorUserId: actor.id,
        name: trimmedName,
        location: locationInput.value.trim() || null,
        capacity: parsedCapacity,
      });
      form.reset();
      await refresh();
      formStatus.dataset.tone = "success";
      formStatus.textContent = `Added facility "${created.name}".`;
    } catch (error) {
      formStatus.dataset.tone = "error";
      formStatus.textContent = error instanceof Error ? error.message : "Unable to add facility.";
    } finally {
      submitting = false;
      syncFormPermissions();
    }
  });

  session.subscribe(() => {
    syncFormPermissions();
    render();
  });

  try {
    facilities = await initialRequest;
    callbacks.onFacilitiesChanged(facilities);
    render();
  } catch {
    status.dataset.tone = "error";
    status.textContent = "Unable to load facilities. Refresh the page to try again.";
  }

  return {
    getLatest: () => facilities,
    refresh,
  };
}
