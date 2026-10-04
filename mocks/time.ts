// German time for the mock, without the app's own helpers: what the mock
// answers must not depend on the code it is there to test.

const format = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Berlin",
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parts(at: number): Parts {
  const found: Record<string, number> = {};
  for (const part of format.formatToParts(new Date(at))) {
    if (part.type !== "literal") found[part.type] = Number(part.value);
  }
  return {
    year: found.year ?? 1970,
    month: found.month ?? 1,
    day: found.day ?? 1,
    hour: (found.hour ?? 0) % 24,
    minute: found.minute ?? 0,
    second: found.second ?? 0,
  };
}

const pad = (value: number) => String(value).padStart(2, "0");

/** `YYYY-MM-DD` of a moment in Germany. */
export function berlinDay(at: number = Date.now()): string {
  const p = parts(at);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/** The moment of a German wall-clock time on a German day. */
export function berlinMoment(
  day: string,
  hour: number,
  minute = 0,
  second = 0,
): number {
  const [y, m, d] = day.split("-").map(Number);
  const wall = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, hour, minute, second);
  for (const offsetHours of [2, 1]) {
    const candidate = wall - offsetHours * 3600_000;
    const p = parts(candidate);
    if (p.hour === hour && p.day === (d ?? 1)) return candidate;
  }
  return wall - 3600_000;
}

/** 23:59:59 German time of today plus `days`: the payment deadline (12). */
export function deadlineAfterDays(
  days: number,
  from: number = Date.now(),
): string {
  return new Date(
    berlinMoment(addDays(berlinDay(from), days), 23, 59, 59),
  ).toISOString();
}

/** The next reminder: the reminder hour of the day after `from`. */
export function nextReminder(
  reminderHour: number,
  from: number = Date.now(),
): string {
  return new Date(
    berlinMoment(addDays(berlinDay(from), 1), reminderHour),
  ).toISOString();
}

export const iso = (at: number) => new Date(at).toISOString();

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
