// Section 33: the Fulfilment & Returns tracker (doc/FULFILMENT_RETURNS.md).
// Per pack size: the units that left for customers, that came back, and
// that stay sold. As in the API, every figure is worked out from the
// orders and the returns when it is asked for; only the adjustments an
// admin makes by hand are kept.

import { z } from "zod";
import type {
  FulfilmentAdjustment,
  FulfilmentBrand,
  FulfilmentExportColumn,
  FulfilmentFigures,
  FulfilmentOrder,
  FulfilmentPackSize,
  FulfilmentRow,
  FulfilmentTotals,
  FulfilmentUnits,
  OrderStatus,
  Translated,
} from "../../src/lib/api/types/index.ts";
import type { Db, OrderRecord } from "../db.ts";
import {
  fail,
  idParam,
  intParam,
  json,
  newId,
  validationFailed,
  zId,
} from "../http.ts";
import type { Router } from "../router.ts";
import { DAY, addDays, berlinDay, berlinMoment, iso } from "../time.ts";

const TIME_ZONE = "Europe/Berlin";

/** An adjustment as stored: the admin is named on reading. */
export interface FulfilmentAdjustmentRecord {
  id: string;
  productId: string;
  variantId: string;
  sku: string;
  name: Translated;
  packSize: FulfilmentPackSize;
  /** The day the adjustment counts for. */
  date: string;
  dispatched: number;
  returned: number;
  reason: string;
  before: FulfilmentFigures;
  after: FulfilmentFigures;
  adminId: string;
  createdAt: string;
}

/**
 * The orders whose units count as dispatched: on their way, delivered, or
 * delivered and sent back as a whole. A cancelled order counts nothing.
 */
const COUNTED: readonly OrderStatus[] = ["dispatched", "delivered", "returned"];

// --- Periods -------------------------------------------------------------------

interface Period {
  from: string | null;
  to: string | null;
  /** Midnight at the start of `from`. */
  start: number | null;
  /** Midnight after `to`: the first moment that is outside. */
  end: number | null;
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const check = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  return check.getUTCMonth() === (m ?? 1) - 1 && check.getUTCDate() === d;
}

/** The days a request asks for. Without `from` and `to`: all dates. */
function periodOf(query: URLSearchParams): Period {
  const read = (name: "from" | "to") => {
    const raw = query.get(name);
    if (raw === null || raw === "") return null;
    if (!DAY_PATTERN.test(raw)) {
      throw validationFailed([
        { field: name, problems: [`${name} must be YYYY-MM-DD`] },
      ]);
    }
    if (!isCalendarDay(raw)) {
      throw fail(
        400,
        "VALIDATION_FAILED",
        `\`${name}\` is not a day that exists.`,
        [`${name}: must be a calendar date, YYYY-MM-DD`],
      );
    }
    return raw;
  };
  const from = read("from");
  const to = read("to");
  if (from && to && from > to) {
    throw fail(400, "VALIDATION_FAILED", "`from` must not come after `to`.", [
      "from: must not come after to",
    ]);
  }
  return {
    from,
    to,
    start: from ? berlinMoment(from, 0) : null,
    end: to ? berlinMoment(addDays(to, 1), 0) : null,
  };
}

const ALL_DATES: Period = { from: null, to: null, start: null, end: null };

const rangeOf = (period: Period) => ({
  from: period.from,
  to: period.to,
  timeZone: TIME_ZONE,
});

/** Whether a moment is in the period. Without a period everything is, also what has no moment. */
function inside(period: Period, at: string | null): boolean {
  if (period.start === null && period.end === null) return true;
  if (!at) return false;
  const moment = Date.parse(at);
  return (
    (period.start === null || moment >= period.start) &&
    (period.end === null || moment < period.end)
  );
}

function dayInside(period: Period, day: string): boolean {
  return (
    (period.from === null || day >= period.from) &&
    (period.to === null || day <= period.to)
  );
}

// --- Counting ------------------------------------------------------------------

interface Scope {
  productId?: string;
  variantId?: string;
}

interface Source {
  productId: string;
  variantId: string;
  sku: string;
  name: Translated;
  packSize: FulfilmentPackSize;
}

interface CatalogueEntry extends Omit<Source, "variantId"> {
  brand: string | null;
}

/** What the catalogue says about its pack sizes today. */
function catalogueOf(db: Db): Map<string, CatalogueEntry> {
  const catalogue = new Map<string, CatalogueEntry>();
  for (const product of db.products) {
    for (const variant of product.variants) {
      catalogue.set(variant.id, {
        productId: product.id,
        name: product.name,
        brand: product.brand?.trim() || null,
        sku: variant.sku,
        packSize: { ...variant.packSize },
      });
    }
  }
  return catalogue;
}

const within = (scope: Scope, line: { productId: string; variantId: string }) =>
  (!scope.variantId || line.variantId === scope.variantId) &&
  (!scope.productId || line.productId === scope.productId);

/**
 * One row per pack size that has anything in the period. The name, the
 * brand and the article number are those of the catalogue today; a pack
 * size that is gone from it keeps what its orders recorded.
 */
function rowsOf(db: Db, period: Period, scope: Scope = {}): FulfilmentRow[] {
  const catalogue = catalogueOf(db);
  const rows = new Map<string, FulfilmentRow>();
  const rowOf = (source: Source): FulfilmentRow => {
    const existing = rows.get(source.variantId);
    if (existing) return existing;
    const known = catalogue.get(source.variantId);
    const row: FulfilmentRow = {
      productId: known?.productId ?? source.productId,
      variantId: source.variantId,
      sku: known?.sku ?? source.sku,
      name: known?.name ?? source.name,
      brand: known?.brand ?? null,
      packSize: { ...(known?.packSize ?? source.packSize) },
      dispatched: 0,
      returned: 0,
      net: 0,
      orders: 0,
      returns: 0,
      adjusted: { dispatched: 0, returned: 0 },
      inCatalogue: known !== undefined,
    };
    rows.set(source.variantId, row);
    return row;
  };

  const counted = new Set<string>();
  for (const order of db.orders) {
    if (!COUNTED.includes(order.status)) continue;
    counted.add(order.id);
    if (!inside(period, order.delivery.dispatchedAt)) continue;
    for (const item of order.items) {
      if (!within(scope, item) || item.deliveredQuantity <= 0) continue;
      const row = rowOf(item);
      row.dispatched += item.deliveredQuantity;
      row.orders += 1;
    }
  }
  // A return of an order that no longer counts as dispatched counts nothing either.
  for (const entry of db.returns) {
    if (entry.status !== "completed" || !counted.has(entry.orderId)) continue;
    if (!inside(period, entry.completedAt)) continue;
    for (const item of entry.items) {
      const accepted = item.approvedQuantity ?? item.quantity;
      if (!within(scope, item) || accepted <= 0) continue;
      const row = rowOf(item);
      row.returned += accepted;
      row.returns += 1;
    }
  }
  for (const record of db.fulfilmentAdjustments) {
    if (!within(scope, record) || !dayInside(period, record.date)) continue;
    const row = rowOf(record);
    row.dispatched += record.dispatched;
    row.returned += record.returned;
    row.adjusted.dispatched += record.dispatched;
    row.adjusted.returned += record.returned;
  }
  for (const row of rows.values()) row.net = row.dispatched - row.returned;
  return [...rows.values()];
}

/** Umlauts written out, accents off: "Müsli" is "muesli". */
const fold = (text: string) =>
  text
    .replace(/[äÄ]/g, "ae")
    .replace(/[öÖ]/g, "oe")
    .replace(/[üÜ]/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** Accents off without writing umlauts out: "Müsli" is "musli". */
const plain = (text: string) =>
  text
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

/** The rows of the chosen brands that carry every word of the search. */
function filterRows(
  rows: FulfilmentRow[],
  filter: { brands: string[]; q: string | undefined },
): FulfilmentRow[] {
  const brands = filter.brands.length
    ? new Set(filter.brands.map((brand) => fold(brand.trim())))
    : null;
  const words = fold(filter.q ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return rows.filter((row) => {
    if (brands && !brands.has(fold(row.brand ?? ""))) return false;
    if (words.length === 0) return true;
    const written = [
      row.name.en,
      row.name.de ?? "",
      row.brand ?? "",
      row.sku,
    ].join(" ");
    const text = `${fold(written)} ${plain(written)}`;
    return words.every((word) => text.includes(word));
  });
}

const SORT_FIELDS = [
  "name",
  "brand",
  "sku",
  "dispatched",
  "returned",
  "net",
] as const;
type SortField = (typeof SORT_FIELDS)[number];
const SORT_PATTERN = new RegExp(`^(${SORT_FIELDS.join("|")})(:(asc|desc))?$`);
const DEFAULT_SORT = "dispatched:desc";

/** A pack in grams, millilitres or pieces: 500 g comes before 2 kg. */
const quantityOf = (packSize: FulfilmentPackSize) =>
  packSize.unit === "kg" || packSize.unit === "l"
    ? packSize.value * 1000
    : packSize.value;

/** Sorted by the field asked for; rows that tie follow by name, then pack. */
function sortRows(rows: FulfilmentRow[], sort = DEFAULT_SORT): FulfilmentRow[] {
  const [field, direction] = sort.split(":") as [SortField, string?];
  const numeric =
    field === "dispatched" || field === "returned" || field === "net";
  // Numbers read best largest first, words from A to Z.
  const descending = (direction ?? (numeric ? "desc" : "asc")) === "desc";
  const byText = (a: string, b: string) =>
    a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
  const byName = (a: FulfilmentRow, b: FulfilmentRow) =>
    byText(a.name.en, b.name.en) ||
    quantityOf(a.packSize) - quantityOf(b.packSize) ||
    byText(a.sku, b.sku);
  const compare = (a: FulfilmentRow, b: FulfilmentRow): number => {
    switch (field) {
      case "name":
        return byText(a.name.en, b.name.en);
      case "brand":
        return byText(a.brand ?? "", b.brand ?? "");
      case "sku":
        return byText(a.sku, b.sku);
      default:
        return a[field] - b[field];
    }
  };
  return [...rows].sort(
    (a, b) => (descending ? -compare(a, b) : compare(a, b)) || byName(a, b),
  );
}

function totalsOf(rows: FulfilmentRow[]): FulfilmentTotals {
  const totals: FulfilmentTotals = {
    packSizes: rows.length,
    products: new Set(rows.map((row) => row.productId)).size,
    dispatched: 0,
    returned: 0,
    net: 0,
    adjusted: { dispatched: 0, returned: 0 },
  };
  for (const row of rows) {
    totals.dispatched += row.dispatched;
    totals.returned += row.returned;
    totals.adjusted.dispatched += row.adjusted.dispatched;
    totals.adjusted.returned += row.adjusted.returned;
  }
  totals.net = totals.dispatched - totals.returned;
  return totals;
}

/** The brands of the rows, with what each of them has, by name; no brand last. */
function brandsOf(rows: FulfilmentRow[]): FulfilmentBrand[] {
  const brands = new Map<string, FulfilmentBrand>();
  for (const row of rows) {
    const key = fold(row.brand ?? "");
    const entry = brands.get(key) ?? {
      brand: row.brand,
      packSizes: 0,
      dispatched: 0,
      returned: 0,
      net: 0,
    };
    entry.packSizes += 1;
    entry.dispatched += row.dispatched;
    entry.returned += row.returned;
    entry.net += row.net;
    brands.set(key, entry);
  }
  return [...brands.values()].sort(
    (a, b) =>
      Number(a.brand === null) - Number(b.brand === null) ||
      (a.brand ?? "").localeCompare(b.brand ?? "", "en", {
        sensitivity: "base",
      }),
  );
}

// --- The filters of a request --------------------------------------------------

interface Filters extends Scope {
  period: Period;
  q: string | undefined;
  brands: string[];
  sort: string | undefined;
}

function filtersOf(query: URLSearchParams): Filters {
  const period = periodOf(query);
  const q = query.get("q")?.trim() || undefined;
  if (q !== undefined && (q.length < 2 || q.length > 80)) {
    throw validationFailed([
      {
        field: "q",
        problems: [
          q.length < 2
            ? "q must be longer than or equal to 2 characters"
            : "q must be shorter than or equal to 80 characters",
        ],
      },
    ]);
  }
  const brands = query
    .getAll("brand")
    .map((brand) => brand.trim())
    .filter(Boolean);
  if (brands.length > 100) {
    throw validationFailed([
      {
        field: "brand",
        problems: ["brand must contain no more than 100 elements"],
      },
    ]);
  }
  if (brands.some((brand) => brand.length > 80)) {
    throw validationFailed([
      {
        field: "brand",
        problems: [
          "each value in brand must be shorter than or equal to 80 characters",
        ],
      },
    ]);
  }
  const sort = query.get("sort") || undefined;
  if (sort !== undefined && !SORT_PATTERN.test(sort)) {
    throw validationFailed([
      {
        field: "sort",
        problems: [
          "sort must be name, brand, sku, dispatched, returned or net, optionally with :asc or :desc",
        ],
      },
    ]);
  }
  return {
    period,
    q,
    brands,
    sort,
    productId: idParam(query, "productId"),
    variantId: idParam(query, "variantId"),
  };
}

function filtered(db: Db, filters: Filters, withBrands = true) {
  const rows = rowsOf(db, filters.period, filters);
  return sortRows(
    filterRows(rows, {
      brands: withBrands ? filters.brands : [],
      q: filters.q,
    }),
    filters.sort,
  );
}

const paging = (query: URLSearchParams) => ({
  page: intParam(query, "page", 1, 1, 1000),
  limit: intParam(query, "limit", 25, 1, 100),
});

function pageOf<T>(rows: T[], page: number, limit: number) {
  return {
    items: rows.slice((page - 1) * limit, page * limit),
    page,
    limit,
    total: rows.length,
    totalPages: Math.max(1, Math.ceil(rows.length / limit)),
  };
}

// --- The export ----------------------------------------------------------------

const EXPORT_COLUMNS: { key: FulfilmentExportColumn; label: string }[] = [
  { key: "product_name", label: "Product name" },
  { key: "product_name_de", label: "Product name (German)" },
  { key: "brand", label: "Brand" },
  { key: "sku", label: "SKU" },
  { key: "pack_size", label: "Pack size" },
  { key: "dispatched", label: "Dispatched" },
  { key: "returned", label: "Returned" },
  { key: "net", label: "Net sold" },
  { key: "orders", label: "Orders" },
  { key: "completed_returns", label: "Completed returns" },
  { key: "adjusted_dispatched", label: "Adjustment: dispatched" },
  { key: "adjusted_returned", label: "Adjustment: returned" },
  { key: "product_id", label: "Product ID" },
  { key: "variant_id", label: "Pack size ID" },
];

const DEFAULT_COLUMNS: FulfilmentExportColumn[] = [
  "product_name",
  "brand",
  "sku",
  "pack_size",
  "dispatched",
  "returned",
  "net",
];

const CELLS: Record<
  FulfilmentExportColumn,
  (row: FulfilmentRow) => string | number
> = {
  product_name: (row) => row.name.en,
  product_name_de: (row) => row.name.de ?? "",
  brand: (row) => row.brand ?? "",
  sku: (row) => row.sku,
  pack_size: (row) => row.packSize.label,
  dispatched: (row) => row.dispatched,
  returned: (row) => row.returned,
  net: (row) => row.net,
  orders: (row) => row.orders,
  completed_returns: (row) => row.returns,
  adjusted_dispatched: (row) => row.adjusted.dispatched,
  adjusted_returned: (row) => row.adjusted.returned,
  product_id: (row) => row.productId,
  variant_id: (row) => row.variantId,
};

/** `a,b,c`, or the parameter several times; unknown and repeated keys are refused. */
function columnsOf(query: URLSearchParams): FulfilmentExportColumn[] {
  const asked = query
    .getAll("columns")
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (asked.length === 0) return DEFAULT_COLUMNS;
  const known = new Set<string>(EXPORT_COLUMNS.map((column) => column.key));
  if (asked.some((key) => !known.has(key))) {
    throw validationFailed([
      {
        field: "columns",
        problems: [
          `each value in columns must be one of the following values: ${[...known].join(", ")}`,
        ],
      },
    ]);
  }
  if (new Set(asked).size !== asked.length) {
    throw validationFailed([
      {
        field: "columns",
        problems: ["All columns's elements must be unique"],
      },
    ]);
  }
  return asked as FulfilmentExportColumn[];
}

/** "fulfilment-returns_2026-11-01_to_2026-11-17". */
function fileNameOf(period: Period): string {
  const base = "fulfilment-returns";
  if (period.from && period.to) {
    return period.from === period.to
      ? `${base}_${period.from}`
      : `${base}_${period.from}_to_${period.to}`;
  }
  if (period.from) return `${base}_from_${period.from}`;
  if (period.to) return `${base}_until_${period.to}`;
  return `${base}_all-dates`;
}

// --- One pack size -------------------------------------------------------------

/**
 * A pack size by its id: from the catalogue, or, when it is gone from
 * there, as its last order or adjustment recorded it.
 */
function infoOf(db: Db, variantId: string): CatalogueEntry {
  const known = catalogueOf(db).get(variantId);
  if (known) return known;
  const orders = [...db.orders].sort((a, b) => (a.id < b.id ? 1 : -1));
  const line =
    orders
      .flatMap((order) => order.items)
      .find((item) => item.variantId === variantId) ??
    [...db.fulfilmentAdjustments]
      .reverse()
      .find((record) => record.variantId === variantId);
  if (!line) {
    throw fail(
      404,
      "PRODUCT_VARIANT_NOT_FOUND",
      "No such pack size: neither in the catalogue nor in an order.",
    );
  }
  return {
    productId: line.productId,
    name: line.name,
    brand: null,
    sku: line.sku,
    packSize: { ...line.packSize },
  };
}

/** The row of a pack size that has nothing in the period. */
function emptyRow(db: Db, variantId: string): FulfilmentRow {
  const info = infoOf(db, variantId);
  return {
    productId: info.productId,
    variantId,
    sku: info.sku,
    name: info.name,
    brand: info.brand,
    packSize: info.packSize,
    dispatched: 0,
    returned: 0,
    net: 0,
    orders: 0,
    returns: 0,
    adjusted: { dispatched: 0, returned: 0 },
    inCatalogue: catalogueOf(db).has(variantId),
  };
}

const customerName = (order: OrderRecord): string | null =>
  [order.customer.firstName, order.customer.lastName]
    .filter(Boolean)
    .join(" ") || null;

/** Every order that adds to the figures of the period, newest dispatch first. */
function ordersOf(
  db: Db,
  variantId: string,
  period: Period,
): FulfilmentOrder[] {
  const hasLine = (order: OrderRecord) =>
    order.items.some(
      (item) => item.variantId === variantId && item.deliveredQuantity > 0,
    );
  const dispatchOrders = db.orders.filter(
    (order) =>
      COUNTED.includes(order.status) &&
      inside(period, order.delivery.dispatchedAt) &&
      hasLine(order),
  );
  const dispatched = new Set(dispatchOrders.map((order) => order.id));
  const completed = db.returns.filter(
    (entry) =>
      entry.status === "completed" &&
      inside(period, entry.completedAt) &&
      entry.items.some((item) => item.variantId === variantId),
  );
  const counted = new Set(completed.map((entry) => entry.id));
  // Orders that were dispatched outside the period and had units come back
  // inside it belong to the list too.
  const others = new Set(
    completed
      .map((entry) => entry.orderId)
      .filter((orderId) => !dispatched.has(orderId)),
  );
  const returnOrders = db.orders.filter(
    (order) => others.has(order.id) && COUNTED.includes(order.status),
  );

  return [...dispatchOrders, ...returnOrders]
    .map((order) => {
      const item = order.items.find((line) => line.variantId === variantId);
      const returns = db.returns
        .filter(
          (entry) =>
            entry.orderId === order.id &&
            entry.items.some((line) => line.variantId === variantId),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((entry) => {
          const line = entry.items.find((it) => it.variantId === variantId);
          const accepted = line?.approvedQuantity ?? null;
          return {
            id: entry.id,
            returnNumber: entry.returnNumber,
            status: entry.status,
            reason: line?.reason ?? null,
            requestedQuantity: line?.quantity ?? 0,
            acceptedQuantity: accepted,
            countedQuantity: counted.has(entry.id)
              ? (accepted ?? line?.quantity ?? 0)
              : 0,
            requestedAt: entry.requestedAt,
            completedAt: entry.completedAt,
            restocked: Boolean(entry.restockedAt),
          };
        });
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        placedAt: order.placedAt,
        orderStatus: order.status,
        paymentStatus: order.paymentStatus,
        customerName: customerName(order),
        delivery: {
          method: order.delivery.method,
          trackingNumber: order.delivery.trackingNumber,
          dispatchedAt: order.delivery.dispatchedAt,
          deliveredAt: order.delivery.deliveredAt,
        },
        orderedQuantity: item?.quantity ?? 0,
        deliveredQuantity: item?.deliveredQuantity ?? 0,
        dispatched: dispatched.has(order.id)
          ? (item?.deliveredQuantity ?? 0)
          : 0,
        returned: returns.reduce(
          (sum, entry) => sum + entry.countedQuantity,
          0,
        ),
        corrections: order.adjustments
          .filter((entry) => entry.variantId === variantId)
          .map((entry) => ({
            from: entry.from,
            to: entry.to,
            reason: entry.reason,
            at: entry.at,
          })),
        returns,
      };
    })
    .sort(
      (a, b) =>
        Date.parse(b.delivery.dispatchedAt ?? b.placedAt) -
        Date.parse(a.delivery.dispatchedAt ?? a.placedAt),
    );
}

// --- Adjustments ---------------------------------------------------------------

function adjustmentView(
  db: Db,
  record: FulfilmentAdjustmentRecord,
): FulfilmentAdjustment {
  const admin = db.admins.find((entry) => entry.id === record.adminId);
  return {
    id: record.id,
    productId: record.productId,
    variantId: record.variantId,
    sku: record.sku,
    name: record.name,
    packSize: record.packSize,
    date: record.date,
    dispatched: record.dispatched,
    returned: record.returned,
    net: record.dispatched - record.returned,
    reason: record.reason,
    before: record.before,
    after: record.after,
    admin: admin ? { id: admin.id, name: admin.name } : null,
    createdAt: record.createdAt,
  };
}

/** Newest first. */
const newestFirst = (records: FulfilmentAdjustmentRecord[]) =>
  [...records].sort((a, b) => (a.id < b.id ? 1 : -1));

function invalid(message: string, details?: unknown) {
  return fail(409, "FULFILMENT_ADJUSTMENT_INVALID", message, details);
}

/**
 * An adjustment must leave figures that can be true: nothing below zero,
 * and no more units back than ever left.
 */
function assertAdjustable(
  now: FulfilmentUnits,
  change: FulfilmentUnits,
): FulfilmentFigures {
  if (change.dispatched === 0 && change.returned === 0) {
    throw invalid("An adjustment changes at least one of the two figures.");
  }
  const after = {
    dispatched: now.dispatched + change.dispatched,
    returned: now.returned + change.returned,
  };
  const details = { current: { ...now, net: now.dispatched - now.returned } };
  if (after.dispatched < 0) {
    throw invalid(
      `Only ${now.dispatched} unit(s) count as dispatched: the figure cannot go below zero.`,
      details,
    );
  }
  if (after.returned < 0) {
    throw invalid(
      `Only ${now.returned} unit(s) count as returned: the figure cannot go below zero.`,
      details,
    );
  }
  if (after.returned > after.dispatched) {
    throw invalid(
      `No more units can be returned than were dispatched: that would be ${after.returned} returned of ${after.dispatched} dispatched.`,
      details,
    );
  }
  return { ...after, net: after.dispatched - after.returned };
}

/** Writes one adjustment; the report changes, orders, returns and stock do not. */
function adjust(
  db: Db,
  input: {
    variantId: string;
    dispatched?: number;
    returned?: number;
    reason: string;
    date?: string;
  },
  adminId: string,
  now: number,
): { record: FulfilmentAdjustmentRecord; totals: FulfilmentFigures } {
  const today = berlinDay(now);
  const date = input.date ?? today;
  if (!isCalendarDay(date) || date > today) {
    throw fail(
      400,
      "VALIDATION_FAILED",
      "The date of an adjustment is a calendar day, today or earlier.",
      ["date: must be YYYY-MM-DD and not in the future"],
    );
  }
  const info = infoOf(db, input.variantId);
  const [row] = rowsOf(db, ALL_DATES, { variantId: input.variantId });
  const before = {
    dispatched: row?.dispatched ?? 0,
    returned: row?.returned ?? 0,
  };
  const change = {
    dispatched: input.dispatched ?? 0,
    returned: input.returned ?? 0,
  };
  const after = assertAdjustable(before, change);
  const record: FulfilmentAdjustmentRecord = {
    id: newId(now),
    productId: info.productId,
    variantId: input.variantId,
    sku: info.sku,
    name: info.name,
    packSize: info.packSize,
    date,
    ...change,
    reason: input.reason,
    before: { ...before, net: before.dispatched - before.returned },
    after,
    adminId,
    createdAt: iso(now),
  };
  db.fulfilmentAdjustments.push(record);
  return { record, totals: after };
}

const units = z.number().int().min(-1_000_000).max(1_000_000).optional();

const adjustmentBody = z.strictObject({
  variantId: zId,
  dispatched: units,
  returned: units,
  reason: z
    .string()
    .min(5, "reason must be longer than or equal to 5 characters")
    .max(500, "reason must be shorter than or equal to 500 characters"),
  date: z.string().regex(DAY_PATTERN, "date must be YYYY-MM-DD").optional(),
});

/**
 * The demo's adjustments: units of the best-selling pack size that were
 * handed over at a market stall, and one of them that came back.
 */
export function seedFulfilment(db: Db, now: number, adminId: string): void {
  const [row] = sortRows(rowsOf(db, ALL_DATES));
  if (!row || !row.inCatalogue) return;
  adjust(
    db,
    {
      variantId: row.variantId,
      dispatched: 2,
      reason: "Two packs sold at the market stall on Saturday",
      date: berlinDay(now - 6 * DAY),
    },
    adminId,
    now - 5 * DAY,
  );
  adjust(
    db,
    {
      variantId: row.variantId,
      returned: 1,
      reason: "One pack of the market stall came back unopened",
      date: berlinDay(now - 2 * DAY),
    },
    adminId,
    now - 2 * DAY,
  );
}

export function registerFulfilment(router: Router): void {
  const base = "/v1/admin/fulfilment-tracker";

  router.get(base, { permission: "orders.read" }, (ctx) => {
    const filters = filtersOf(ctx.query);
    const { page, limit } = paging(ctx.query);
    const rows = filtered(ctx.db, filters);
    return json({
      range: rangeOf(filters.period),
      totals: totalsOf(rows),
      ...pageOf(rows, page, limit),
    });
  });

  router.get(`${base}/brands`, { permission: "orders.read" }, (ctx) => {
    const filters = filtersOf(ctx.query);
    // The brand filter itself is left out, so the list stays whole while brands are chosen.
    return json({
      range: rangeOf(filters.period),
      items: brandsOf(filtered(ctx.db, filters, false)),
    });
  });

  router.get(`${base}/export`, { permission: "orders.read" }, (ctx) => {
    const filters = filtersOf(ctx.query);
    const keys = columnsOf(ctx.query);
    const rows = filtered(ctx.db, filters);
    return json({
      range: rangeOf(filters.period),
      fileName: `${fileNameOf(filters.period)}.csv`,
      columns: keys.map((key) =>
        EXPORT_COLUMNS.find((column) => column.key === key)!,
      ),
      rows: rows.map((row) =>
        Object.fromEntries(keys.map((key) => [key, CELLS[key](row)])),
      ),
      totals: totalsOf(rows),
    });
  });

  router.get(`${base}/adjustments`, { permission: "orders.read" }, (ctx) => {
    const variantId = idParam(ctx.query, "variantId");
    const { page, limit } = paging(ctx.query);
    const records = newestFirst(
      ctx.db.fulfilmentAdjustments.filter(
        (record) => !variantId || record.variantId === variantId,
      ),
    );
    const result = pageOf(records, page, limit);
    return json({
      ...result,
      items: result.items.map((record) => adjustmentView(ctx.db, record)),
    });
  });

  router.post(
    `${base}/adjustments`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(adjustmentBody);
      const { record, totals } = adjust(ctx.db, input, ctx.admin.id, ctx.now);
      return json({ adjustment: adjustmentView(ctx.db, record), totals }, 201);
    },
  );

  router.get(
    `${base}/variants/:variantId`,
    { permission: "orders.read" },
    (ctx) => {
      const variantId = ctx.params.variantId as string;
      const period = periodOf(ctx.query);
      const { page, limit } = paging(ctx.query);
      const [row] = rowsOf(ctx.db, period, { variantId });
      const entries = ordersOf(ctx.db, variantId, period);
      return json({
        range: rangeOf(period),
        row: row ?? emptyRow(ctx.db, variantId),
        fromOrders: {
          dispatched: entries.reduce((sum, entry) => sum + entry.dispatched, 0),
          returned: entries.reduce((sum, entry) => sum + entry.returned, 0),
        },
        orders: pageOf(entries, page, limit),
        adjustments: newestFirst(
          ctx.db.fulfilmentAdjustments.filter(
            (record) =>
              record.variantId === variantId && dayInside(period, record.date),
          ),
        ).map((record) => adjustmentView(ctx.db, record)),
      });
    },
  );
}
