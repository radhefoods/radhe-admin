import type { IsoDateTime } from "@/lib/api/types";

// Date-times of the API are UTC; the business thinks in German time
// (documentation, 0.7). The panel prints every moment in Europe/Berlin,
// whatever the device is set to, and reads every typed time as German time.
// Calendar days (`YYYY-MM-DD`) are printed as written.

export const BUSINESS_TIME_ZONE = "Europe/Berlin";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export interface ZonedParts {
  year: number;
  /** 1 to 12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday */
  weekday: number;
}

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  weekday: "short",
});

function toDate(value: IsoDateTime | Date | number): Date {
  return value instanceof Date ? value : new Date(value);
}

/** The German wall-clock time of a moment. */
export function berlinParts(value: IsoDateTime | Date | number): ZonedParts {
  const found: Record<string, string> = {};
  for (const part of partsFormat.formatToParts(toDate(value))) {
    found[part.type] = part.value;
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour) % 24,
    minute: Number(found.minute),
    second: Number(found.second),
    weekday: WEEKDAYS.indexOf(found.weekday as (typeof WEEKDAYS)[number]),
  };
}

/** Minutes German time is ahead of UTC at that moment: 60 or 120. */
export function berlinOffsetMinutes(
  value: IsoDateTime | Date | number,
): number {
  const date = toDate(value);
  const p = berlinParts(date);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second,
  );
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

function isValid(
  value: IsoDateTime | Date | number | null | undefined,
): boolean {
  if (value === null || value === undefined || value === "") return false;
  return !Number.isNaN(toDate(value).getTime());
}

// --- Printing moments -------------------------------------------------------

/** `28 Sep 2026, 12:15` */
export function formatDateTime(
  value: IsoDateTime | Date | null | undefined,
): string {
  if (!isValid(value)) return "—";
  const p = berlinParts(value as IsoDateTime);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** `Fri 9 Oct, 23:59`: for deadlines, with the weekday and without the year. */
export function formatDeadline(
  value: IsoDateTime | Date | null | undefined,
): string {
  if (!isValid(value)) return "—";
  const p = berlinParts(value as IsoDateTime);
  return `${WEEKDAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}, ${pad(p.hour)}:${pad(p.minute)}`;
}

/** `28 Sep 2026`: the German calendar day of a moment. */
export function formatDate(
  value: IsoDateTime | Date | null | undefined,
): string {
  if (!isValid(value)) return "—";
  const p = berlinParts(value as IsoDateTime);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** `12:15` */
export function formatTime(
  value: IsoDateTime | Date | null | undefined,
): string {
  if (!isValid(value)) return "—";
  const p = berlinParts(value as IsoDateTime);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * A moment for lists: the time when it is today, `Yesterday`, otherwise the
 * day (with the year only when it is not this year).
 */
export function formatShortDateTime(
  value: IsoDateTime | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!isValid(value)) return "—";
  const p = berlinParts(value as IsoDateTime);
  const today = berlinParts(now);
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  if (p.year === today.year && p.month === today.month && p.day === today.day) {
    return `Today, ${time}`;
  }
  const year = p.year === today.year ? "" : ` ${p.year}`;
  return `${p.day} ${MONTHS[p.month - 1]}${year}, ${time}`;
}

// --- Calendar days ----------------------------------------------------------

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function dayParts(day: string): { y: number; m: number; d: number } | null {
  const match = DAY_PATTERN.exec(day);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** `5 Oct 2026`, with `weekday` `Mon 5 Oct 2026`. */
export function formatDay(
  day: string | null | undefined,
  options: { weekday?: boolean; year?: boolean } = {},
): string {
  const p = day ? dayParts(day) : null;
  if (!p) return "—";
  const weekday = options.weekday
    ? `${WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]} `
    : "";
  const year = options.year === false ? "" : ` ${p.y}`;
  return `${weekday}${p.d} ${MONTHS[p.m - 1]}${year}`;
}

/** The German calendar day of a moment, as `YYYY-MM-DD`. */
export function berlinDay(
  value: IsoDateTime | Date | number = new Date(),
): string {
  const p = berlinParts(value);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

// --- Reading German time ----------------------------------------------------

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * The moment a German wall-clock time (`2026-09-26T23:59`, the value of a
 * `datetime-local` input) stands for. A time that does not exist (the hour
 * skipped in spring) moves forward by that hour; of a time that exists twice
 * (the hour repeated in autumn) the first one is meant.
 */
export function berlinToDate(local: string): Date | null {
  const match = LOCAL_PATTERN.exec(local);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0),
  ];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour > 23 ||
    minute > 59
  ) {
    return null;
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(wall)) return null;

  // Try the offset before and after a possible change and keep the answer
  // that reads back as the wall-clock time asked for.
  const offsets = [
    berlinOffsetMinutes(wall - 3 * 3600_000),
    berlinOffsetMinutes(wall + 3 * 3600_000),
  ];
  const candidates = [...new Set(offsets)]
    .sort((a, b) => b - a)
    .map((offset) => wall - offset * 60_000);
  for (const candidate of candidates) {
    const p = berlinParts(candidate);
    const reads = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    if (reads === wall) return new Date(candidate);
  }
  // The skipped hour: the winter offset lands just after the change.
  return new Date(wall - Math.min(...offsets) * 60_000);
}

/**
 * What the API wants for a typed moment: ISO with the German offset,
 * `2026-09-26T23:59:00+02:00`.
 */
export function berlinToIso(local: string): string | null {
  const date = berlinToDate(local);
  if (!date) return null;
  return toBerlinIso(date);
}

/** A moment as ISO with the German offset. */
export function toBerlinIso(value: IsoDateTime | Date): string {
  const p = berlinParts(value);
  const offset = berlinOffsetMinutes(value);
  const sign = offset < 0 ? "-" : "+";
  const absolute = Math.abs(offset);
  return (
    `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}

/** A moment as the value of a `datetime-local` input, in German time. */
export function toLocalInput(
  value: IsoDateTime | Date | null | undefined,
): string {
  if (!isValid(value)) return "";
  const p = berlinParts(value as IsoDateTime);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// --- Distances --------------------------------------------------------------

/**
 * The time between two moments in the two largest units: `1d 7h`, `3h 20m`,
 * `12m`, `under a minute`.
 */
export function formatDuration(milliseconds: number): string {
  const totalMinutes = Math.floor(Math.abs(milliseconds) / 60_000);
  if (totalMinutes < 1) return "under a minute";
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}

/** `in 1d 7h` or `3h ago`. */
export function formatRelative(
  value: IsoDateTime | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!isValid(value)) return "—";
  const distance = toDate(value as IsoDateTime).getTime() - now.getTime();
  const text = formatDuration(distance);
  if (text === "under a minute")
    return distance >= 0 ? "in under a minute" : "just now";
  return distance >= 0 ? `in ${text}` : `${text} ago`;
}
