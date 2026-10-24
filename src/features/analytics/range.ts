import {
  ANALYTICS_GRANULARITIES,
  ANALYTICS_MAX_DAYS,
  ANALYTICS_PRESETS,
  DEFAULT_ANALYTICS_PRESET,
  type AnalyticsGranularity,
  type AnalyticsPreset,
  type AnalyticsQuery,
  type AnalyticsRange,
} from "@/lib/api/types";
import { formatDay } from "@/lib/format/dates";
import { param, type Param } from "@/lib/hooks/use-url-state";

// The period of the Analytics tab lives in the address
// (`?tab=analytics&range=…&from=…&to=…&granularity=…`), so a reload and a
// shared link show the same figures (doc/ANALYTICS.md, 4).

export const PRESET_LABEL: Record<AnalyticsPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7_days: "Last 7 days",
  this_month: "This month",
  last_month: "Last month",
  custom: "Custom dates",
};

export const GRANULARITY_LABEL: Record<AnalyticsGranularity, string> = {
  day: "Days",
  week: "Weeks",
  month: "Months",
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `YYYY-MM-DD` that names a day that exists, else `""`. */
export function isCalendarDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return check.getUTCMonth() === (m ?? 1) - 1 && check.getUTCDate() === d;
}

const dayParam: Param<string> = {
  parse: (raw) => (raw !== null && isCalendarDay(raw) ? raw : ""),
  serialize: (value) => (isCalendarDay(value) ? value : null),
};

export const RANGE_PARAMS = {
  range: param.oneOfOr(ANALYTICS_PRESETS, DEFAULT_ANALYTICS_PRESET),
  from: dayParam,
  to: dayParam,
  granularity: param.oneOf(ANALYTICS_GRANULARITIES),
};

export interface RangeState {
  range: AnalyticsPreset;
  from: string;
  to: string;
  granularity: AnalyticsGranularity | undefined;
}

/** Days between two calendar days, both included. */
export function daysBetween(from: string, to: string): number {
  const at = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((at(to) - at(from)) / 86_400_000) + 1;
}

/**
 * Why a custom range cannot be sent yet, or `null`. The API would answer
 * `ANALYTICS_RANGE_INVALID` for the same reasons; the panel says it first.
 */
export function customProblem(state: RangeState): string | null {
  if (state.range !== "custom") return null;
  if (!state.from || !state.to) return "Choose the first and the last day.";
  if (state.from > state.to)
    return "The first day must not come after the last.";
  if (daysBetween(state.from, state.to) > ANALYTICS_MAX_DAYS) {
    return "At most two years (731 days) at once.";
  }
  return null;
}

/** The query the endpoints get; nothing is sent for the defaults. */
export function queryOf(state: RangeState): AnalyticsQuery {
  const query: AnalyticsQuery = {};
  if (state.range !== DEFAULT_ANALYTICS_PRESET) query.range = state.range;
  if (state.range === "custom") {
    query.from = state.from;
    query.to = state.to;
  }
  if (state.granularity) query.granularity = state.granularity;
  return query;
}

/** `5 Oct`, `Week of 5 Oct`, `Oct 2026`: the name of a bucket of the chart. */
export function periodLabel(
  period: string,
  granularity: AnalyticsGranularity,
): string {
  if (granularity === "month") {
    const parts = formatDay(`${period.slice(0, 7)}-01`).split(" ");
    return `${parts[1]} ${parts[2]}`;
  }
  const day = formatDay(period, { year: false });
  return granularity === "week" ? `Week of ${day}` : day;
}

/** `1 to 24 Oct 2026`, or `24 Oct 2026` for one day. */
export function spanText(from: string, to: string): string {
  if (from === to) return formatDay(from);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (sameMonth)
    return `${from.slice(8).replace(/^0/, "")} to ${formatDay(to)}`;
  if (sameYear)
    return `${formatDay(from, { year: false })} to ${formatDay(to)}`;
  return `${formatDay(from)} to ${formatDay(to)}`;
}

/** The resolved range in words, with what it is compared with. */
export function rangeText(range: AnalyticsRange): string {
  return `${spanText(range.from, range.to)}, compared with ${spanText(range.previous.from, range.previous.to)}.`;
}
