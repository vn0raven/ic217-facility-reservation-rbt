import { renderFacilities } from "./pages/facilities.ts";
import { initializeReservationForm } from "./pages/reservation.ts";
import { initializeReservationsPage } from "./pages/reservations.ts";
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

const facilitiesRequest = getFacilities();
const usersRequest = getUsers();

void facilitiesRequest.then(
  items => {
    statFacilities.textContent = String(items.filter(item => item.active).length);
  },
  () => {
    statFacilities.textContent = "–";
  },
);

void renderFacilities(facilitiesRequest);

void (async () => {
  const session = await initializeActorSelector(usersRequest);
  const reservationsController = await initializeReservationsPage(
    facilitiesRequest,
    session,
    reservations => {
      statPending.textContent = String(reservations.filter(r => r.status === "pending").length);
      statApproved.textContent = String(reservations.filter(r => r.status === "confirmed").length);
    },
  );
  await initializeReservationForm(facilitiesRequest, session, () =>
    reservationsController.refresh(),
  );
})();
