import { initializeFacilitiesPage } from "./pages/facilities.ts";
import { initializeReservationForm } from "./pages/reservation.ts";
import type { ReservationFormController } from "./pages/reservation.ts";
import { initializeReservationsPage } from "./pages/reservations.ts";
import type { ReservationsController } from "./pages/reservations.ts";
import { initializeSchedulePage } from "./pages/schedule.ts";
import type { ScheduleController } from "./pages/schedule.ts";
import { initializeVisualizerPage } from "./pages/visualizer.ts";
import type { VisualizerController } from "./pages/visualizer.ts";
import { getFacilities, getHealth, getUsers } from "./services/api.ts";
import { initializeActorSelector } from "./services/session.ts";
import "./style.css";

const pages = document.querySelectorAll<HTMLElement>("main > section");
const links = document.querySelectorAll<HTMLAnchorElement>("nav a");

function updatePage(): void {
  const requested = location.hash.slice(1);
  const activePage = Array.from(pages).find(page => page.id === requested) ?? pages[0];
  for (const page of pages) page.hidden = page !== activePage;
  for (const link of links) {
    if (link.hash === `#${activePage.id}`) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
}

window.addEventListener("hashchange", updatePage);
updatePage();

const status = document.querySelector<HTMLParagraphElement>("#api-status")!;
void getHealth().then(
  () => { status.textContent = "API connected"; },
  () => { status.textContent = "API unavailable"; },
);

const statFacilities = document.querySelector<HTMLElement>("#stat-facilities")!;
const statPending = document.querySelector<HTMLElement>("#stat-pending")!;
const statApproved = document.querySelector<HTMLElement>("#stat-approved")!;
const statAcademic = document.querySelector<HTMLElement>("#stat-academic")!;

const facilitiesRequest = getFacilities();
const usersRequest = getUsers();

void (async () => {
  const session = await initializeActorSelector(usersRequest);

  let reservationsController: ReservationsController | undefined;
  let scheduleController: ScheduleController | undefined;
  let reservationFormController: ReservationFormController | undefined;
  let visualizerController: VisualizerController | undefined;

  await initializeFacilitiesPage(facilitiesRequest, session, {
    onFacilitiesChanged(facilities) {
      statFacilities.textContent = String(facilities.filter(item => item.active).length);
      reservationsController?.setFacilities(facilities);
      scheduleController?.setFacilities(facilities);
      reservationFormController?.setFacilities(facilities);
      visualizerController?.setFacilities(facilities);
    },
    onInspectFacilityTree(facilityId) {
      visualizerController?.selectFacility(facilityId);
      location.hash = "#visualizer";
    },
  });

  visualizerController = await initializeVisualizerPage(facilitiesRequest);

  reservationsController = await initializeReservationsPage(
    facilitiesRequest,
    session,
    reservations => {
      statPending.textContent = String(reservations.filter(r => r.status === "pending").length);
      statApproved.textContent = String(reservations.filter(r => r.status === "confirmed").length);
      void scheduleController?.refresh();
      void visualizerController?.refresh();
    },
  );

  scheduleController = await initializeSchedulePage(
    facilitiesRequest,
    session,
    academicCount => {
      statAcademic.textContent = String(academicCount);
      void visualizerController?.refresh();
    },
  );

  reservationFormController = await initializeReservationForm(facilitiesRequest, session, () =>
    reservationsController!.refresh(),
  );
})();
