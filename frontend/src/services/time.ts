import type { ReservationStatus, UserRole } from "../../../shared/types/index.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

const manilaDateFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const manilaTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
});

/** Converts an Asia/Manila local date (YYYY-MM-DD) and time (HH:MM) to UTC epoch milliseconds. */
export function manilaToUtcMs(date: string, time: string): number | undefined {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return undefined;
  const timestamp = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function formatManilaRange(startMs: number, endMs: number): string {
  const startDate = new Date(startMs);
  const endDate = new Date(endMs);
  const startDay = manilaDateFormatter.format(startDate);
  const endDay = manilaDateFormatter.format(endDate);
  const startTime = manilaTimeFormatter.format(startDate);
  const endTime = manilaTimeFormatter.format(endDate);

  return startDay === endDay
    ? `${startDay} · ${startTime} – ${endTime} (Asia/Manila)`
    : `${startDay} ${startTime} – ${endDay} ${endTime} (Asia/Manila)`;
}

export function formatRoleLabel(role: UserRole): string {
  switch (role) {
    case "student":
      return "Student";
    case "faculty":
      return "Faculty";
    case "visitor":
      return "Visitor (Other Dept.)";
    case "personnel":
      return "Department Personnel";
  }
}

export function formatStatusLabel(status: ReservationStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "confirmed":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "cancelled":
      return "Cancelled";
  }
}
