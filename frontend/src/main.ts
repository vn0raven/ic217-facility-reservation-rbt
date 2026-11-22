import { renderFacilities } from "./pages/facilities.ts";
import { initializeReservationForm } from "./pages/reservation.ts";
import { getFacilities, getHealth } from "./services/api.ts";
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

const facilities = getFacilities();
void renderFacilities(facilities);
void initializeReservationForm(facilities);
