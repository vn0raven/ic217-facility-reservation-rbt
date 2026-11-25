import type { Facility, FacilityScheduleItem } from "../../../shared/types/index.ts";
import { showFieldError } from "../components/form-field.ts";
import {
  createAcademicBlock,
  deleteAcademicBlock,
  getAcademicBlocks,
  getFacilitySchedule,
} from "../services/api.ts";
import type { ActorSession } from "../services/session.ts";
import {
  formatManilaRange,
  formatManilaTimes,
  formatRoleLabel,
  getManilaDayBounds,
  getManilaWeekBounds,
  manilaToUtcMs,
  shiftManilaDate,
  todayManilaDateString,
} from "../services/time.ts";

export interface ScheduleController {
  refresh(): Promise<void>;
}

type ViewMode = "daily" | "weekly";

export async function initializeSchedulePage(
  facilitiesRequest: Promise<Facility[]>,
  session: ActorSession,
  onAcademicBlockCount: (count: number) => void,
): Promise<ScheduleController> {
  const facilitySelect = document.querySelector<HTMLSelectElement>("#schedule-facility")!;
  const dailyButton = document.querySelector<HTMLButtonElement>("#mode-daily")!;
  const weeklyButton = document.querySelector<HTMLButtonElement>("#mode-weekly")!;
  const prevButton = document.querySelector<HTMLButtonElement>("#schedule-prev")!;
  const todayButton = document.querySelector<HTMLButtonElement>("#schedule-today")!;
  const nextButton = document.querySelector<HTMLButtonElement>("#schedule-next")!;
  const dateInput = document.querySelector<HTMLInputElement>("#schedule-date")!;
  const heading = document.querySelector<HTMLElement>("#schedule-range-heading")!;
  const status = document.querySelector<HTMLParagraphElement>("#schedule-status")!;
  const container = document.querySelector<HTMLDivElement>("#schedule-view")!;

  const blockForm = document.querySelector<HTMLFormElement>("#academic-block-form")!;
  const blockHint = document.querySelector<HTMLParagraphElement>("#academic-block-hint")!;
  const blockFacility = document.querySelector<HTMLSelectElement>("#block-facility")!;
  const blockDate = document.querySelector<HTMLInputElement>("#block-date")!;
  const blockStart = document.querySelector<HTMLInputElement>("#block-start")!;
  const blockEnd = document.querySelector<HTMLInputElement>("#block-end")!;
  const blockTitle = document.querySelector<HTMLInputElement>("#block-title")!;
  const blockFeedback = document.querySelector<HTMLParagraphElement>("#block-form-status")!;
  const blockSubmit = blockForm.querySelector<HTMLButtonElement>("button[type='submit']")!;

  let mode: ViewMode = "weekly";
  let facilities: Facility[] = [];
  let activeCount = 0;
  let submittingBlock = false;
  let latestItems: FacilityScheduleItem[] = [];

  const initialDate = todayManilaDateString();
  dateInput.value = initialDate;
  blockDate.value = initialDate;

  try {
    facilities = await facilitiesRequest;
    facilitySelect.replaceChildren();
    blockFacility.replaceChildren();

    if (facilities.length === 0) {
      facilitySelect.append(new Option("No facilities listed", ""));
      facilitySelect.disabled = true;
    } else {
      for (const item of facilities) {
        const suffix = item.active ? "" : " (Inactive)";
        facilitySelect.append(new Option(`${item.name}${suffix}`, String(item.id)));
      }
      const firstActive = facilities.find(item => item.active) ?? facilities[0];
      facilitySelect.value = String(firstActive.id);
    }

    const activeFacilities = facilities.filter(item => item.active);
    activeCount = activeFacilities.length;
    if (activeFacilities.length === 0) {
      blockFacility.append(new Option("No active facilities", ""));
    } else {
      blockFacility.append(new Option("Choose a facility", ""));
      for (const item of activeFacilities) {
        blockFacility.append(new Option(item.name, String(item.id)));
      }
    }
  } catch {
    facilitySelect.replaceChildren(new Option("Facilities unavailable", ""));
    facilitySelect.disabled = true;
    blockFacility.replaceChildren(new Option("Facilities unavailable", ""));
  }

  function syncBlockFormPermissions(): void {
    const actor = session.getActor();
    const isPersonnel = actor?.role === "personnel";
    blockHint.textContent = isPersonnel
      ? `Acting as ${actor.name} (Department Personnel) — blocked class intervals are indexed immediately in the facility Red-Black Tree.`
      : "Only Department Personnel can add or remove academic class schedule blocks. Switch Demo role in the header to test blocking.";

    const disableInputs = !isPersonnel || activeCount === 0 || submittingBlock;
    blockFacility.disabled = disableInputs;
    blockDate.disabled = disableInputs;
    blockStart.disabled = disableInputs;
    blockEnd.disabled = disableInputs;
    blockTitle.disabled = disableInputs;
    blockSubmit.disabled = disableInputs;
  }

  function updateModeButtons(): void {
    dailyButton.setAttribute("aria-pressed", String(mode === "daily"));
    weeklyButton.setAttribute("aria-pressed", String(mode === "weekly"));
    dailyButton.className = mode === "daily" ? "" : "btn-secondary";
    weeklyButton.className = mode === "weekly" ? "" : "btn-secondary";
  }

  function buildScheduleEntryElement(
    item: FacilityScheduleItem,
    compact: boolean,
  ): HTMLLIElement {
    const entry = document.createElement("li");
    entry.className = compact ? "slot-card" : "panel slot-card";

    const top = document.createElement("div");
    top.className = "card-header";

    const timeEl = document.createElement("strong");
    timeEl.textContent = compact
      ? formatManilaTimes(item.start, item.end)
      : formatManilaRange(item.start, item.end);

    const badge = document.createElement("span");
    badge.className = item.kind === "academic" ? "badge badge-academic" : "badge badge-confirmed";
    badge.textContent = item.kind === "academic" ? "Academic Block" : "Approved";

    top.append(timeEl, badge);

    const title = document.createElement("p");
    title.className = "slot-title";
    title.textContent = item.kind === "academic" ? item.title : item.purpose;

    entry.append(top, title);

    if (item.kind === "reservation") {
      const meta = document.createElement("p");
      meta.className = "slot-meta";
      meta.textContent = `Reserved by ${item.requesterName} (${formatRoleLabel(item.requesterRole)})`;
      entry.append(meta);
    } else if (session.getActor()?.role === "personnel") {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "btn-danger btn-small";
      removeBtn.textContent = "Remove block";
      removeBtn.addEventListener("click", async () => {
        const actor = session.getActor();
        if (!actor) return;
        removeBtn.disabled = true;
        status.dataset.tone = "info";
        status.textContent = "Removing academic schedule block…";
        try {
          await deleteAcademicBlock(item.id, { actorUserId: actor.id });
          await refresh();
          status.dataset.tone = "success";
          status.textContent = `Removed academic block "${item.title}".`;
        } catch (error) {
          removeBtn.disabled = false;
          status.dataset.tone = "error";
          status.textContent = error instanceof Error ? error.message : "Unable to remove academic block.";
        }
      });
      entry.append(removeBtn);
    }

    return entry;
  }

  function renderSchedule(): void {
    container.replaceChildren();
    const selectedDate = dateInput.value || todayManilaDateString();

    if (!facilitySelect.value) {
      heading.textContent = "Select a facility to inspect its schedule.";
      return;
    }

    if (mode === "daily") {
      const bounds = getManilaDayBounds(selectedDate);
      heading.textContent = bounds.label;

      if (latestItems.length === 0) {
        const empty = document.createElement("p");
        empty.className = "panel";
        empty.textContent = "No approved reservations or academic schedule blocks on this day.";
        container.append(empty);
        return;
      }

      const list = document.createElement("ul");
      list.className = "reservation-stack";
      for (const item of latestItems) {
        list.append(buildScheduleEntryElement(item, false));
      }
      container.append(list);
      return;
    }

    const week = getManilaWeekBounds(selectedDate);
    heading.textContent = `Week of ${week.label}`;
    const grid = document.createElement("div");
    grid.className = "week-grid";

    for (const day of week.days) {
      const column = document.createElement("section");
      column.className = "panel day-column";

      const dayHeading = document.createElement("h2");
      dayHeading.textContent = day.label;
      column.append(dayHeading);

      const dayItems = latestItems.filter(item => item.start < day.end && day.start < item.end);
      if (dayItems.length === 0) {
        const free = document.createElement("p");
        free.className = "slot-empty";
        free.textContent = "No scheduled slots";
        column.append(free);
      } else {
        const list = document.createElement("ul");
        list.className = "day-slot-list";
        for (const item of dayItems) {
          list.append(buildScheduleEntryElement(item, true));
        }
        column.append(list);
      }

      grid.append(column);
    }

    container.append(grid);
  }

  async function refreshAcademicCount(): Promise<void> {
    try {
      const allBlocks = await getAcademicBlocks();
      onAcademicBlockCount(allBlocks.length);
    } catch {
      onAcademicBlockCount(0);
    }
  }

  async function refresh(): Promise<void> {
    await refreshAcademicCount();
    const facilityId = Number(facilitySelect.value);
    if (!facilityId) {
      latestItems = [];
      renderSchedule();
      return;
    }

    const selectedDate = dateInput.value || todayManilaDateString();
    const bounds = mode === "daily"
      ? getManilaDayBounds(selectedDate)
      : getManilaWeekBounds(selectedDate);

    try {
      latestItems = await getFacilitySchedule(facilityId, bounds.start, bounds.end);
      if (status.dataset.tone !== "success") {
        status.textContent = "";
        delete status.dataset.tone;
      }
      renderSchedule();
    } catch (error) {
      status.dataset.tone = "error";
      status.textContent = error instanceof Error ? error.message : "Unable to load facility schedule.";
    }
  }

  function clearStatusMessage(): void {
    status.textContent = "";
    delete status.dataset.tone;
  }

  facilitySelect.addEventListener("change", () => {
    clearStatusMessage();
    void refresh();
  });

  dateInput.addEventListener("change", () => {
    if (!dateInput.value) dateInput.value = todayManilaDateString();
    clearStatusMessage();
    void refresh();
  });

  dailyButton.addEventListener("click", () => {
    if (mode === "daily") return;
    mode = "daily";
    updateModeButtons();
    clearStatusMessage();
    void refresh();
  });

  weeklyButton.addEventListener("click", () => {
    if (mode === "weekly") return;
    mode = "weekly";
    updateModeButtons();
    clearStatusMessage();
    void refresh();
  });

  prevButton.addEventListener("click", () => {
    dateInput.value = shiftManilaDate(dateInput.value, mode === "daily" ? -1 : -7);
    clearStatusMessage();
    void refresh();
  });

  todayButton.addEventListener("click", () => {
    dateInput.value = todayManilaDateString();
    clearStatusMessage();
    void refresh();
  });

  nextButton.addEventListener("click", () => {
    dateInput.value = shiftManilaDate(dateInput.value, mode === "daily" ? 1 : 7);
    clearStatusMessage();
    void refresh();
  });

  blockForm.addEventListener("input", () => {
    blockEnd.setCustomValidity("");
    blockTitle.setCustomValidity("");
    blockFeedback.textContent = "";
    delete blockFeedback.dataset.tone;
  });

  blockForm.addEventListener("submit", async event => {
    event.preventDefault();
    const actor = session.getActor();
    if (!actor || actor.role !== "personnel") return;

    const startMs = manilaToUtcMs(blockDate.value, blockStart.value);
    const endMs = manilaToUtcMs(blockDate.value, blockEnd.value);
    const invalidInterval =
      startMs === undefined || endMs === undefined || endMs <= startMs
        ? "End time must be after start time."
        : "";
    if (!showFieldError(blockEnd, invalidInterval)) return;

    const trimmedTitle = blockTitle.value.trim();
    if (!showFieldError(blockTitle, trimmedTitle ? "" : "Enter a class or block description.")) {
      return;
    }

    submittingBlock = true;
    syncBlockFormPermissions();
    blockFeedback.dataset.tone = "info";
    blockFeedback.textContent = "Saving academic schedule block…";

    try {
      const targetFacilityId = Number(blockFacility.value);
      const targetDate = blockDate.value;
      await createAcademicBlock({
        actorUserId: actor.id,
        facilityId: targetFacilityId,
        title: trimmedTitle,
        start: startMs!,
        end: endMs!,
      });
      blockForm.reset();
      blockDate.value = targetDate;
      facilitySelect.value = String(targetFacilityId);
      dateInput.value = targetDate;
      blockFeedback.dataset.tone = "success";
      blockFeedback.textContent = "Academic schedule block added and indexed in the facility Red-Black Tree.";
      await refresh();
    } catch (error) {
      blockFeedback.dataset.tone = "error";
      blockFeedback.textContent = error instanceof Error ? error.message : "Unable to add academic schedule block.";
    } finally {
      submittingBlock = false;
      syncBlockFormPermissions();
    }
  });

  session.subscribe(() => {
    syncBlockFormPermissions();
    renderSchedule();
  });

  updateModeButtons();
  await refresh();
  return { refresh };
}
