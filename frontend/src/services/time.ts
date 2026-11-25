import type { ReservationStatus, UserRole } from "../../../shared/types/index.ts";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const manilaDateFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const manilaLongDayFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
});

const manilaShortDayFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  weekday: "short",
  month: "short",
  day: "numeric",
});

const manilaTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  minute: "2-digit",
});

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** Formats a UTC timestamp as YYYY-MM-DD in Asia/Manila time. */
export function todayManilaDateString(nowMs = Date.now()): string {
  const shifted = new Date(nowMs + MANILA_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function shiftManilaDate(date: string, deltaDays: number): string {
  const start = manilaToUtcMs(date, "00:00");
  if (start === undefined) return todayManilaDateString();
  return todayManilaDateString(start + deltaDays * DAY_MS);
}

/** Converts an Asia/Manila local date (YYYY-MM-DD) and time (HH:MM) to UTC epoch milliseconds. */
export function manilaToUtcMs(date: string, time: string): number | undefined {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) return undefined;
  const timestamp = Date.parse(`${date}T${time}:00+08:00`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

export function getManilaDayBounds(date: string): {
  date: string;
  start: number;
  end: number;
  label: string;
} {
  const normalized = manilaToUtcMs(date, "00:00") !== undefined ? date : todayManilaDateString();
  const start = manilaToUtcMs(normalized, "00:00")!;
  const end = start + DAY_MS;
  return {
    date: normalized,
    start,
    end,
    label: `${manilaLongDayFormatter.format(new Date(start))} (Asia/Manila)`,
  };
}

export interface ManilaDayColumn {
  date: string;
  label: string;
  start: number;
  end: number;
}

export function getManilaWeekBounds(date: string): {
  start: number;
  end: number;
  label: string;
  days: ManilaDayColumn[];
} {
  const anchorDay = getManilaDayBounds(date);
  const shifted = new Date(anchorDay.start + MANILA_OFFSET_MS);
  const daysSinceMonday = (shifted.getUTCDay() + 6) % 7;
  const mondayStart = anchorDay.start - daysSinceMonday * DAY_MS;

  const days: ManilaDayColumn[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const start = mondayStart + offset * DAY_MS;
    const end = start + DAY_MS;
    days.push({
      date: todayManilaDateString(start),
      label: manilaShortDayFormatter.format(new Date(start)),
      start,
      end,
    });
  }

  const firstLabel = manilaDateFormatter.format(new Date(days[0].start));
  const lastLabel = manilaDateFormatter.format(new Date(days[6].start));
  return {
    start: days[0].start,
    end: days[6].end,
    label: `${firstLabel} – ${lastLabel} (Asia/Manila)`,
    days,
  };
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

export function formatManilaTimes(startMs: number, endMs: number): string {
  return `${manilaTimeFormatter.format(new Date(startMs))} – ${manilaTimeFormatter.format(new Date(endMs))}`;
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
