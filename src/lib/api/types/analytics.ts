// Section 21: the Analytics tab of the start page. doc/ANALYTICS.md has
// the definitions, the full answers and the panel workflow.

import type { PackUnit, ProductStatus } from "./catalog";
import type {
  Cents,
  Id,
  IsoDateTime,
  Locale,
  Translated,
  TranslatedOptional,
} from "./common";
import type {
  PaymentType,
  RefundMethod,
  RefundReason,
  RefundStatus,
} from "./payments";
import type { ReturnReason, ReturnStatus } from "./returns";

export const ANALYTICS_PRESETS = [
  "today",
  "yesterday",
  "last_7_days",
  "this_month",
  "last_month",
  "custom",
] as const;
export type AnalyticsPreset = (typeof ANALYTICS_PRESETS)[number];
export const DEFAULT_ANALYTICS_PRESET: AnalyticsPreset = "this_month";

export const ANALYTICS_GRANULARITIES = ["day", "week", "month"] as const;
export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number];

/** A range longer than this cannot be asked for (`ANALYTICS_RANGE_INVALID`). */
export const ANALYTICS_MAX_DAYS = 731;

/** The query every analytics endpoint takes; the panel sends calendar days, never instants. */
export interface AnalyticsQuery {
  range?: AnalyticsPreset;
  /** `YYYY-MM-DD`, both included, for `custom`. */
  from?: string;
  to?: string;
  /** Default by the length: up to 31 days `day`, up to 182 `week`, else `month`. */
  granularity?: AnalyticsGranularity;
}

/** The resolved range every answer repeats, with the period it is compared with. */
export interface AnalyticsRange {
  preset: AnalyticsPreset;
  from: string;
  to: string;
  days: number;
  timeZone: string;
  granularity: AnalyticsGranularity;
  previous: { from: string; to: string };
}

/** A figure next to the same figure of the previous period; `change` in percent, `null` when `previous` is 0. */
export interface Kpi {
  value: number;
  previous: number;
  change: number | null;
}

/** `GET /analytics/summary`: the KPI tiles. Amounts are cents, VAT included. */
export interface AnalyticsSummary {
  range: AnalyticsRange;
  revenue: {
    /** What customers paid for the orders paid in the period: goods, delivery fee, VAT. */
    gross: Kpi;
    /** `gross` minus the refunds completed in the period. */
    net: Kpi;
    goods: Kpi;
    deliveryFees: Kpi;
    vat: Kpi;
    netOfVat: Kpi;
    /** Credit notes issued in the period; information, not subtracted again. */
    credits: Kpi;
    refunded: Kpi;
  };
  orders: {
    paid: Kpi;
    averageOrderValue: Kpi;
    units: Kpi;
    /** Cancelled in the period after they had been paid. */
    cancelled: Kpi;
    /** Cancelled in the period without ever being paid. */
    abandoned: Kpi;
    dispatched: Kpi;
    delivered: Kpi;
  };
  customers: {
    /** Customers who paid at least one order in the period. */
    buyers: Kpi;
    /** Buyers whose first paid order ever falls in the period. */
    firstTime: Kpi;
    returning: Kpi;
    /** Accounts created in the period. */
    new: Kpi;
  };
  returns: { requested: Kpi; completed: Kpi; credited: Kpi };
  refunds: { completed: Kpi; amount: Kpi };
}

/** One bucket of the sales chart; `period` is the first day of the bucket. */
export interface SalesPoint {
  period: string;
  revenue: Cents;
  orders: number;
  units: number;
  averageOrderValue: Cents;
  refunded: Cents;
}

/** `GET /analytics/sales`: zero-filled points for the period and the previous one. */
export interface AnalyticsSales {
  range: AnalyticsRange;
  current: SalesPoint[];
  previous: SalesPoint[];
}

export type AnalyticsProductSort = "units" | "revenue";

/** A product as it is today; one deleted since keeps the name of the order, `status` and `image` `null`. */
export interface AnalyticsProductRef {
  id: Id;
  name: Translated;
  slug: TranslatedOptional | null;
  status: ProductStatus | null;
  image: { url: string; sizes: { small: { url: string } } } | null;
}

export interface BestSeller {
  product: AnalyticsProductRef;
  units: Kpi;
  revenue: Kpi;
  orders: number;
  /** The pack sizes sold, best first. */
  variants: {
    variantId: Id;
    sku: string;
    packSize: { value: number; unit: PackUnit };
    units: number;
    revenue: Cents;
  }[];
}

export interface CategorySales {
  /** `null` gathers products that left the catalogue. */
  category: {
    id: Id;
    name: Translated;
    slug: TranslatedOptional | null;
  } | null;
  units: number;
  revenue: Kpi;
  /** Of the goods revenue, in percent. */
  share: number;
  /** Distinct products sold. */
  products: number;
}

/** `GET /analytics/products`. */
export interface AnalyticsProducts {
  range: AnalyticsRange;
  sortBy: AnalyticsProductSort;
  totals: { units: number; revenue: Cents; products: number };
  bestSellers: BestSeller[];
  /** By the category the product is in today, revenue descending. */
  categories: CategorySales[];
}

export interface TopCustomer {
  /** The name and email as they are on the orders. */
  customer: { id: Id; name: string | null; email: string };
  orders: number;
  revenue: Cents;
  averageOrderValue: Cents;
  lastOrderAt: IsoDateTime;
}

/** `GET /analytics/customers`. */
export interface AnalyticsCustomers {
  range: AnalyticsRange;
  new: Kpi;
  buyers: Kpi;
  firstTime: Kpi;
  returning: Kpi;
  /** Returning buyers among the buyers, in percent. */
  repeatRate: Kpi;
  newCustomers: { period: string; count: number }[];
  topCustomers: TopCustomer[];
  byLanguage: { language: Locale; orders: number; revenue: Cents }[];
}

export type AnalyticsPaymentType = PaymentType | "unknown";

/** `GET /analytics/payments`. */
export interface AnalyticsPayments {
  range: AnalyticsRange;
  byType: {
    type: AnalyticsPaymentType;
    orders: number;
    amount: Cents;
    /** Of the amount, in percent. */
    share: number;
  }[];
  /** The orders started in the period and what became of them by now. */
  checkouts: {
    started: number;
    paid: number;
    pending: number;
    failed: number;
    abandoned: number;
    /** `paid` / `started`, in percent. */
    conversion: number;
  };
  refunds: {
    /** Created in the period, in any status now. */
    created: { count: number; amount: Cents };
    /** Paid out in the period, whenever created. */
    completed: { count: number; amount: Cents };
    byStatus: { key: RefundStatus; count: number; amount: Cents }[];
    byReason: { key: RefundReason; count: number; amount: Cents }[];
    byMethod: { key: RefundMethod; count: number; amount: Cents }[];
  };
  returns: {
    requested: number;
    completed: { count: number; credited: Cents };
    byStatus: { status: ReturnStatus; count: number }[];
    byReason: { reason: ReturnReason; items: number; units: number }[];
  };
}

/** A pack size that runs low or is sold out. */
export interface StockLine {
  productId: Id;
  name: Translated;
  variantId: Id;
  sku: string;
  packSize: { value: number; unit: PackUnit };
  quantity: number;
  threshold: number | null;
}

/** `GET /analytics/inventory`: the stock now, the units moved in the period. */
export interface AnalyticsInventory {
  range: AnalyticsRange;
  stock: {
    variants: number;
    unitsOnHand: number;
    /** At selling prices. */
    stockValue: Cents;
    variantsOutOfStock: number;
    variantsLow: number;
    productsOutOfStock: number;
  };
  movements: {
    sold: Kpi;
    restocked: Kpi;
    returned: Kpi;
    released: Kpi;
    /** Net, may be negative. */
    adjusted: Kpi;
  };
  lowStock: StockLine[];
  outOfStock: StockLine[];
  /** Active products that sold nothing in the period. */
  slowMovers: {
    count: number;
    items: {
      product: AnalyticsProductRef;
      unitsOnHand: number;
      stockValue: Cents;
    }[];
  };
}
