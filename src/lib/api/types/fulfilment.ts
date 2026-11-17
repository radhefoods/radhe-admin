// Section 33: the Fulfilment & Returns tracker (doc/FULFILMENT_RETURNS.md).
// Per pack size: the units that were dispatched, that were returned and
// that stay sold. Every figure is worked out by the API; the panel adds
// nothing up.

import type {
  AdminRef,
  Id,
  IsoDateTime,
  PageQuery,
  PageResult,
  SortDirection,
  Translated,
} from "./common";
import type { AdjustmentReason, DeliveryMethod, OrderStatus } from "./orders";
import type { PaymentStatus } from "./payments";
import type { ReturnReason, ReturnStatus } from "./returns";

/** A calendar day of the business time zone, `YYYY-MM-DD`. */
export type CalendarDay = string;

/** The days an answer is about; a side that is open is `null`. */
export interface FulfilmentRange {
  from: CalendarDay | null;
  to: CalendarDay | null;
  timeZone: string;
}

export const FULFILMENT_SORT_FIELDS = [
  "name",
  "brand",
  "sku",
  "dispatched",
  "returned",
  "net",
] as const;
export type FulfilmentSortField = (typeof FULFILMENT_SORT_FIELDS)[number];
/** `dispatched:desc`; without a direction numbers sort largest first, words A to Z. */
export type FulfilmentSort =
  FulfilmentSortField | `${FulfilmentSortField}:${SortDirection}`;
export const DEFAULT_FULFILMENT_SORT: FulfilmentSort = "dispatched:desc";

/** The filters of the report, the brands and the export (33); all optional. */
export interface FulfilmentFilters {
  /** First day. Left out: from the beginning. */
  from?: CalendarDay;
  /** Last day, included. Left out: until now. */
  to?: CalendarDay;
  /** 2 to 80 characters: every word in the name, the brand or the SKU. */
  q?: string;
  /** Any of these brands; sent as a repeated parameter. */
  brand?: readonly string[];
  productId?: Id;
  variantId?: Id;
  sort?: FulfilmentSort;
}

export interface FulfilmentReportQuery extends FulfilmentFilters, PageQuery {}

/** What a pack is: `label` is English, "1 kg". */
export interface FulfilmentPackSize {
  value: number;
  unit: string;
  label: string;
}

/** The two figures an admin can adjust. */
export interface FulfilmentUnits {
  dispatched: number;
  returned: number;
}

/** The three figures of a pack size or of a whole report. */
export interface FulfilmentFigures extends FulfilmentUnits {
  /** `dispatched - returned`, always. */
  net: number;
}

/** One row of the report: one pack size. */
export interface FulfilmentRow extends FulfilmentFigures {
  productId: Id;
  variantId: Id;
  sku: string;
  name: Translated;
  brand: string | null;
  packSize: FulfilmentPackSize;
  /** Orders the dispatched units came from. */
  orders: number;
  /** Completed returns the returned units came from. */
  returns: number;
  /** The part of the figures that was adjusted by hand. */
  adjusted: FulfilmentUnits;
  /** `false` for a pack size the catalogue no longer has. */
  inCatalogue: boolean;
}

/** The totals of every row under the filters, not of the page. */
export interface FulfilmentTotals extends FulfilmentFigures {
  packSizes: number;
  products: number;
  adjusted: FulfilmentUnits;
}

export interface FulfilmentReport extends PageResult<FulfilmentRow> {
  range: FulfilmentRange;
  totals: FulfilmentTotals;
}

/** A brand of the report; `brand: null` (pack sizes without one) comes last. */
export interface FulfilmentBrand extends FulfilmentFigures {
  brand: string | null;
  packSizes: number;
}

export interface FulfilmentBrands {
  range: FulfilmentRange;
  items: FulfilmentBrand[];
}

// --- The orders behind a row --------------------------------------------------

export interface FulfilmentOrdersQuery extends PageQuery {
  from?: CalendarDay;
  to?: CalendarDay;
}

/** A correction of the delivered quantity by an admin. */
export interface FulfilmentCorrection {
  from: number;
  to: number;
  reason: AdjustmentReason;
  at: IsoDateTime;
}

/** A return of the order with this pack size, whatever its status. */
export interface FulfilmentOrderReturn {
  id: Id;
  returnNumber: string;
  status: ReturnStatus;
  reason: ReturnReason | null;
  requestedQuantity: number;
  /** `null` until the admin decided. */
  acceptedQuantity: number | null;
  /** What the return adds to the returned figure of the period. */
  countedQuantity: number;
  requestedAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  restocked: boolean;
}

export interface FulfilmentOrder {
  orderId: Id;
  orderNumber: string;
  placedAt: IsoDateTime;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  customerName: string | null;
  delivery: {
    method: DeliveryMethod;
    trackingNumber: string | null;
    dispatchedAt: IsoDateTime | null;
    deliveredAt: IsoDateTime | null;
  };
  /** What the customer ordered. */
  orderedQuantity: number;
  /** What left, after the admin's corrections. */
  deliveredQuantity: number;
  /** What this order adds to the dispatched figure of the period. */
  dispatched: number;
  /** What this order adds to the returned figure of the period. */
  returned: number;
  corrections: FulfilmentCorrection[];
  returns: FulfilmentOrderReturn[];
}

export interface FulfilmentVariantDetail {
  range: FulfilmentRange;
  /** The line of the report for this pack size and period; all zeros when nothing happened. */
  row: FulfilmentRow;
  /** The sum of the orders; the rest of `row` is `adjustments`. */
  fromOrders: FulfilmentUnits;
  orders: PageResult<FulfilmentOrder>;
  adjustments: FulfilmentAdjustment[];
}

// --- The export ---------------------------------------------------------------

/** The columns a file can have, in their usual order (33, 3.5). */
export const FULFILMENT_EXPORT_COLUMNS = [
  "product_name",
  "product_name_de",
  "brand",
  "sku",
  "pack_size",
  "dispatched",
  "returned",
  "net",
  "orders",
  "completed_returns",
  "adjusted_dispatched",
  "adjusted_returned",
  "product_id",
  "variant_id",
] as const;
export type FulfilmentExportColumn = (typeof FULFILMENT_EXPORT_COLUMNS)[number];

/** What the API writes when no columns are asked for. */
export const FULFILMENT_DEFAULT_EXPORT_COLUMNS: readonly FulfilmentExportColumn[] =
  [
    "product_name",
    "brand",
    "sku",
    "pack_size",
    "dispatched",
    "returned",
    "net",
  ];

export interface FulfilmentExportQuery extends FulfilmentFilters {
  /** The keys wanted, in the order of the file; sent comma separated. */
  columns?: readonly FulfilmentExportColumn[];
}

export interface FulfilmentExport {
  range: FulfilmentRange;
  /** `fulfilment-returns_2026-11-01_to_2026-11-17.csv` */
  fileName: string;
  columns: { key: FulfilmentExportColumn; label: string }[];
  /** Every row under the filters, by column key. */
  rows: Partial<Record<FulfilmentExportColumn, string | number>>[];
  totals: FulfilmentTotals;
}

// --- Adjustments by hand ------------------------------------------------------

/** The limits of `POST …/adjustments` (33, 3.6). */
export const FULFILMENT_ADJUSTMENT_RULES = {
  reasonMin: 5,
  reasonMax: 500,
  /** Units one adjustment may add to or take from a figure. */
  unitsMax: 1_000_000,
} as const;

export interface FulfilmentAdjustment {
  id: Id;
  productId: Id;
  variantId: Id;
  sku: string;
  name: Translated;
  packSize: FulfilmentPackSize;
  /** The day the adjustment counts for. */
  date: CalendarDay;
  /** Units added to (negative: taken from) each figure. */
  dispatched: number;
  returned: number;
  net: number;
  reason: string;
  /** The figures of the pack size over all dates, before and after. */
  before: FulfilmentFigures;
  after: FulfilmentFigures;
  admin: AdminRef | null;
  createdAt: IsoDateTime;
}

export interface FulfilmentAdjustmentQuery extends PageQuery {
  variantId?: Id;
}

export interface FulfilmentAdjustmentInput {
  variantId: Id;
  /** Whole units to add; negative takes units off. */
  dispatched?: number;
  returned?: number;
  /** 5 to 500 characters. */
  reason: string;
  /** Today or earlier. Left out: today. */
  date?: CalendarDay;
}

export interface FulfilmentAdjustmentResult {
  adjustment: FulfilmentAdjustment;
  /** The figures of the pack size over all dates, after the adjustment. */
  totals: FulfilmentFigures;
}
