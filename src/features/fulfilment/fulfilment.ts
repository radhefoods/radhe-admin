import { isCalendarDay, spanText } from "@/features/analytics/range";
import {
  DEFAULT_FULFILMENT_SORT,
  FULFILMENT_SORT_FIELDS,
  type CalendarDay,
  type FulfilmentAdjustment,
  type FulfilmentExport,
  type FulfilmentExportColumn,
  type FulfilmentFigures,
  type FulfilmentPackSize,
  type FulfilmentSort,
  type FulfilmentSortField,
  type FulfilmentUnits,
  type Id,
  type SortDirection,
  type Translated,
} from "@/lib/api/types";
import { berlinDay, formatDay } from "@/lib/format/dates";
import { plural } from "@/lib/format/names";
import type { Param } from "@/lib/hooks/use-url-state";

// The Fulfilment & Returns tracker (doc/FULFILMENT_RETURNS.md): what the
// page says and works out. The figures themselves are the API's: the
// panel never adds rows up.

/**
 * The names of the three figures, in this one place: the menu, the tiles,
 * the columns, the dialogs and the header line of the CSV file all read
 * them here. Renaming them (to "Fulfilment", "Returns" and "Radhe Foods",
 * for example) is a change of these three words.
 */
export const FIGURE_LABEL = {
  dispatched: "Dispatched",
  returned: "Returned",
  net: "Net sold",
} as const satisfies Record<keyof FulfilmentFigures, string>;

export const PAGE_TITLE = "Fulfilment & Returns";

/** Rows of the report and of the lists in the dialogs: one page. */
export const PAGE_SIZE = 25;

/** The pack size a dialog is about: a row of the report or an adjustment names it. */
export interface PackSizeRef {
  productId: Id;
  variantId: Id;
  sku: string;
  name: Translated;
  packSize: FulfilmentPackSize;
  brand?: string | null;
}

/** "TRS Chana Dal, 1 kg" */
export const packTitle = (pack: PackSizeRef) =>
  `${pack.name.en}, ${pack.packSize.label}`;

// --- The period -----------------------------------------------------------------

/** The choices of the date range, in the order of the menu. */
export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "last_7_days",
  "this_month",
  "last_month",
  "all",
  "custom",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];
export const DEFAULT_PERIOD: PeriodPreset = "all";

export const PERIOD_LABEL: Record<PeriodPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7_days: "Last 7 days",
  this_month: "This month",
  last_month: "Last month",
  all: "All dates",
  custom: "Custom",
};

/** What the address keeps: the choice, and the two days of a custom range. */
export interface PeriodState {
  range: PeriodPreset;
  /** `YYYY-MM-DD`, or empty: an open side. Read for `custom` only. */
  from: string;
  to: string;
}

/** The days the API is asked for; a side that is left out is open. */
export interface PeriodDays {
  from?: CalendarDay;
  to?: CalendarDay;
}

const pad = (value: number) => String(value).padStart(2, "0");

export function addDays(day: CalendarDay, days: number): CalendarDay {
  const [y, m, d] = day.split("-").map(Number);
  const moved = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return `${moved.getUTCFullYear()}-${pad(moved.getUTCMonth() + 1)}-${pad(moved.getUTCDate())}`;
}

/**
 * The days of a choice. The tracker takes two calendar days of German
 * time and nothing else, so the panel works the presets out, the way the
 * analytics tab defines them: "Last 7 days" is today and the six days
 * before, "This month" runs from the first up to today.
 */
export function daysOf(
  state: PeriodState,
  today: CalendarDay = berlinDay(),
): PeriodDays {
  const first = `${today.slice(0, 7)}-01`;
  switch (state.range) {
    case "today":
      return { from: today, to: today };
    case "yesterday":
      return { from: addDays(today, -1), to: addDays(today, -1) };
    case "last_7_days":
      return { from: addDays(today, -6), to: today };
    case "this_month":
      return { from: first, to: today };
    case "last_month": {
      const last = addDays(first, -1);
      return { from: `${last.slice(0, 7)}-01`, to: last };
    }
    case "custom":
      return {
        ...(isCalendarDay(state.from) ? { from: state.from } : {}),
        ...(isCalendarDay(state.to) ? { to: state.to } : {}),
      };
    default:
      return {};
  }
}

/** Why a custom range cannot be sent, or `null`. The API would refuse it for the same reason. */
export function periodProblem(state: PeriodState): string | null {
  if (state.range !== "custom") return null;
  if (state.from && state.to && state.from > state.to) {
    return "The first day must not come after the last.";
  }
  return null;
}

/**
 * What choosing "Custom" starts with: the days that were shown until
 * then, so the dates can be changed instead of typed from nothing.
 */
export function customFrom(
  state: PeriodState,
  today: CalendarDay = berlinDay(),
): PeriodState {
  const days = daysOf(state, today);
  return {
    range: "custom",
    from: days.from ?? today,
    to: days.to ?? today,
  };
}

/** "1 to 17 Nov 2026", "17 Nov 2026", "From 1 Nov 2026", "Until 17 Nov 2026" or "All dates". */
export function periodText(days: {
  from?: CalendarDay | null;
  to?: CalendarDay | null;
}): string {
  if (days.from && days.to) return spanText(days.from, days.to);
  if (days.from) return `From ${formatDay(days.from)}`;
  if (days.to) return `Until ${formatDay(days.to)}`;
  return "All dates";
}

/** A calendar day in the address; anything else counts as not given. */
export const dayParam: Param<string> = {
  parse: (raw) => (raw !== null && isCalendarDay(raw) ? raw : ""),
  serialize: (value) => (isCalendarDay(value) ? value : null),
};

// --- The sort -------------------------------------------------------------------

const NUMERIC: readonly FulfilmentSortField[] = [
  "dispatched",
  "returned",
  "net",
];

/** Numbers read best largest first, words from A to Z: the API's rule without a direction. */
export function naturalDirection(field: FulfilmentSortField): SortDirection {
  return NUMERIC.includes(field) ? "desc" : "asc";
}

export function parseSort(sort: FulfilmentSort | undefined): {
  field: FulfilmentSortField;
  direction: SortDirection;
} {
  const [field, direction] = (sort ?? DEFAULT_FULFILMENT_SORT).split(":") as [
    FulfilmentSortField,
    SortDirection | undefined,
  ];
  return { field, direction: direction ?? naturalDirection(field) };
}

/** A click on a header: its natural direction first, the other one on the second click. */
export function nextSort(
  current: FulfilmentSort | undefined,
  field: FulfilmentSortField,
): FulfilmentSort {
  const now = parseSort(current);
  if (now.field !== field) return `${field}:${naturalDirection(field)}`;
  return `${field}:${now.direction === "asc" ? "desc" : "asc"}`;
}

const SORT_PATTERN = new RegExp(
  `^(${FULFILMENT_SORT_FIELDS.join("|")}):(asc|desc)$`,
);

/** The sort in the address; the API's default is left out of it. */
export const sortParam: Param<FulfilmentSort | undefined> = {
  parse: (raw) =>
    raw !== null && SORT_PATTERN.test(raw) && raw !== DEFAULT_FULFILMENT_SORT
      ? (raw as FulfilmentSort)
      : undefined,
  serialize: (value) =>
    value && value !== DEFAULT_FULFILMENT_SORT ? value : null,
};

// --- Words ----------------------------------------------------------------------

export const count = (value: number) => value.toLocaleString("en");

/** `+2`, `−1`, `0`. */
export function signed(value: number): string {
  const digits = Math.abs(value).toLocaleString("en");
  return value < 0 ? `−${digits}` : value > 0 ? `+${digits}` : "0";
}

/** "+2 dispatched, +1 returned"; a figure that does not change is left out. */
export function changeText(change: FulfilmentUnits): string {
  const parts = [
    change.dispatched !== 0 ? `${signed(change.dispatched)} dispatched` : null,
    change.returned !== 0 ? `${signed(change.returned)} returned` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "no change";
}

/** "+2 dispatched, +1 returned by hand", for the mark of an adjusted row. */
export const adjustedHint = (adjusted: FulfilmentUnits) =>
  `${changeText(adjusted)} by hand`;

export const isAdjusted = (adjusted: FulfilmentUnits) =>
  adjusted.dispatched !== 0 || adjusted.returned !== 0;

/** "4 dispatched, 1 returned" */
export const unitsText = (units: FulfilmentUnits) =>
  `${count(units.dispatched)} dispatched, ${count(units.returned)} returned`;

/** "Dispatched 20, Returned 2, Net sold 18" */
export const figuresText = (figures: FulfilmentFigures) =>
  `${FIGURE_LABEL.dispatched} ${count(figures.dispatched)}, ${FIGURE_LABEL.returned} ${count(figures.returned)}, ${FIGURE_LABEL.net} ${count(figures.net)}`;

export const NEGATIVE_NET_HINT =
  "More units came back in this period than left in it.";

// --- The export -----------------------------------------------------------------

/** The labels of the fourteen columns, as the checklist and the file show them. */
export const EXPORT_COLUMN_LABEL: Record<FulfilmentExportColumn, string> = {
  product_name: "Product name",
  product_name_de: "Product name (German)",
  brand: "Brand",
  sku: "SKU",
  pack_size: "Pack size",
  dispatched: FIGURE_LABEL.dispatched,
  returned: FIGURE_LABEL.returned,
  net: FIGURE_LABEL.net,
  orders: "Orders",
  completed_returns: "Completed returns",
  adjusted_dispatched: "Adjustment: dispatched",
  adjusted_returned: "Adjustment: returned",
  product_id: "Product ID",
  variant_id: "Pack size ID",
};

/**
 * The answer of the export as the header line and the rows of a file. The
 * three figures carry the labels of the panel, every other column the one
 * the API answers; the cells are the API's values as they are.
 */
export function sheetOf(answer: Pick<FulfilmentExport, "columns" | "rows">): {
  labels: string[];
  rows: Record<string, string>[];
} {
  const columns = answer.columns.map((column) => ({
    key: column.key,
    label:
      column.key in FIGURE_LABEL
        ? FIGURE_LABEL[column.key as keyof typeof FIGURE_LABEL]
        : column.label,
  }));
  return {
    labels: columns.map((column) => column.label),
    rows: answer.rows.map((row) =>
      Object.fromEntries(
        columns.map((column) => [column.label, String(row[column.key] ?? "")]),
      ),
    ),
  };
}

export const rowsText = (rows: number) =>
  `${plural(rows, "row")} will be exported`;

// --- Adjusting by hand ----------------------------------------------------------

/** A whole number that may be negative; an empty field is 0, anything else `null`. */
export function parseUnits(text: string): number | null {
  const trimmed = text.trim().replace(/^−/, "-");
  if (trimmed === "" || trimmed === "-" || trimmed === "+") return 0;
  if (!/^[+-]?\d{1,7}$/.test(trimmed)) return null;
  return Number(trimmed);
}

export function afterOf(
  current: FulfilmentUnits,
  change: FulfilmentUnits,
): FulfilmentFigures {
  const dispatched = current.dispatched + change.dispatched;
  const returned = current.returned + change.returned;
  return { dispatched, returned, net: dispatched - returned };
}

/**
 * What the API would refuse (`409 FULFILMENT_ADJUSTMENT_INVALID`), said
 * before it is sent: nothing changes, a figure below zero, or more units
 * back than ever left.
 */
export function adjustmentProblem(
  current: FulfilmentUnits,
  change: FulfilmentUnits,
): string | null {
  if (change.dispatched === 0 && change.returned === 0) {
    return "Change at least one of the two figures.";
  }
  const after = afterOf(current, change);
  if (after.dispatched < 0) {
    return `Only ${plural(current.dispatched, "unit")} count as dispatched: the figure cannot go below zero.`;
  }
  if (after.returned < 0) {
    return `Only ${plural(current.returned, "unit")} count as returned: the figure cannot go below zero.`;
  }
  if (after.returned > after.dispatched) {
    return `No more units can be returned than were dispatched: that would be ${count(after.returned)} returned of ${count(after.dispatched)} dispatched.`;
  }
  return null;
}

/** "Dispatched 20 → 22 · Returned 2 → 3 · Net sold 18 → 19" */
export function liveLine(
  current: FulfilmentUnits,
  change: FulfilmentUnits,
): string {
  const before = afterOf(current, { dispatched: 0, returned: 0 });
  const after = afterOf(current, change);
  return (["dispatched", "returned", "net"] as const)
    .map(
      (key) =>
        `${FIGURE_LABEL[key]} ${count(before[key])} → ${count(after[key])}`,
    )
    .join(" · ");
}

/** What the "Adjust" form starts with. */
export interface AdjustmentPreset {
  dispatched: number;
  returned: number;
  reason: string;
}

/**
 * An adjustment is never changed or deleted: it is taken back by a second
 * one with the opposite numbers, and both stay in the history.
 */
export function takeBackOf(adjustment: FulfilmentAdjustment): AdjustmentPreset {
  return {
    dispatched: -adjustment.dispatched || 0,
    returned: -adjustment.returned || 0,
    reason:
      `Takes back the adjustment of ${formatDay(adjustment.date)}: ${adjustment.reason}`.slice(
        0,
        500,
      ),
  };
}
