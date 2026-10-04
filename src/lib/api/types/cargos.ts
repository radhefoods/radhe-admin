// Section 9: cargos, their products, bulk order actions, cargo payments.

import type {
  CalendarDay,
  Cents,
  Id,
  IsoDateTime,
  PageQuery,
  TranslatedOptional,
} from "./common";
import type { ProductSummary } from "./catalog";
import type { DeliveryMethod } from "./orders";
import type { PaymentStatus } from "./payments";

export const CARGO_STATUSES = [
  "draft",
  "scheduled",
  "taking_orders",
  "orders_closed",
  "in_transit",
  "arrived",
  "delivering",
  "delivered",
  "cancelled",
] as const;
export type CargoStatus = (typeof CARGO_STATUSES)[number];

/** `opening_due`, `closing_due`: the automatic check is late. `window_missed`: scheduled, deadline passed. */
export type CargoAttention = "opening_due" | "closing_due" | "window_missed";

/** 9.2. */
export interface Cargo {
  id: Id;
  number: number;
  /** `RF-C027` */
  code: string;
  internalName: string;
  customerName: TranslatedOptional | null;
  customerMessage: TranslatedOptional | null;
  internalNotes: string | null;
  status: CargoStatus;
  isAcceptingOrders: boolean;
  attention: CargoAttention | null;
  /** Authoritative: the transitions the API allows from here. */
  allowedStatuses: CargoStatus[];
  orderOpenAt: IsoDateTime;
  orderCloseAt: IsoDateTime;
  delivery: { start: CalendarDay; end: CalendarDay };
  timezone: string;
  openedAt: IsoDateTime | null;
  closedAt: IsoDateTime | null;
  products: { total: number; enabled: number };
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CargoStatusHistoryEntry {
  from: CargoStatus | null;
  to: CargoStatus;
  at: IsoDateTime;
  source: "admin" | "schedule";
  by: Id | null;
  note: string | null;
}

/** `GET /cargos/{id}` and every transition. */
export interface CargoDetail extends Cargo {
  statusHistory: CargoStatusHistoryEntry[];
}

export interface CargoTransition {
  /** `false` when the cargo already had that status. */
  changed: boolean;
  cargo: CargoDetail;
  ordersMoved?: number;
}

export interface CargoOverview {
  acceptingOrders: boolean;
  current: Cargo | null;
  next: Cargo | null;
  /** `orders_closed`, `in_transit`, `arrived`, `delivering`; at most 20. */
  inProgress: Cargo[];
  serverTime: IsoDateTime;
}

export interface CargoQuery extends PageQuery {
  status?: CargoStatus;
}

export interface CargoInput {
  internalName: string;
  customerName?: TranslatedOptional;
  customerMessage?: TranslatedOptional;
  internalNotes?: string | null;
  /** ISO with a time zone: `2026-09-26T23:59:00+02:00`. */
  orderOpenAt: string;
  orderCloseAt: string;
  deliveryStart: CalendarDay;
  deliveryEnd: CalendarDay;
  status?: "draft" | "scheduled";
  copyProductsFrom?: Id;
}

export type CargoPatch = Partial<
  Omit<CargoInput, "status" | "copyProductsFrom">
>;

export interface CargoStatusInput {
  status: CargoStatus;
  /** Orders that keep their status when the cargo's orders follow. At most 1000. */
  excludeOrderIds?: Id[];
  /** Required for `cancelled` when the cargo has orders. */
  moveOrdersToCargoId?: Id;
  note?: string;
}

export interface CargoRollover {
  closed: CargoTransition | null;
  opened: CargoTransition;
}

export interface CargoCheckResult {
  closed: string[];
  opened: string[];
}

// --- Products of a cargo (9.3) ----------------------------------------------

export interface CargoProductSetting {
  isEnabled: boolean;
  /** `null`: no limit. */
  maxQuantity: number | null;
  orderedQuantity: number;
  remaining: number | null;
}

export interface CargoProductRow {
  product: ProductSummary;
  cargo: CargoProductSetting;
}

export interface CargoProductQuery extends PageQuery {
  show?: "all" | "enabled" | "not_enabled";
  q?: string;
  categoryId?: Id;
  includeArchived?: boolean;
}

export interface CargoProductItemInput {
  productId: Id;
  isEnabled?: boolean;
  maxQuantity?: number | null;
}

export interface CargoProductCounts {
  total: number;
  enabled: number;
}

// --- All orders of a cargo at once (9.4) ------------------------------------

export type BulkOrderStatus = "preparing" | "dispatched" | "delivered";

export interface BulkOrderStatusInput {
  status: BulkOrderStatus;
  excludeOrderIds?: Id[];
  note?: string;
}

export interface BulkDeliveryMethodInput {
  method: DeliveryMethod;
  excludeOrderIds?: Id[];
  note?: string;
}

// --- Payments of a cargo (9.5) ----------------------------------------------

export interface CargoPaymentActivationInput {
  /** 1 to 60. */
  deadlineDays: number;
  note?: string;
  excludeOrderIds?: Id[];
}

/** Up to 100 orders per request: repeat while `remaining > 0`. */
export interface CargoPaymentActivation {
  cargo: string;
  activated: string[];
  failed: { orderNumber: string; code: string; message: string }[];
  remaining: number;
}

export interface CargoPaymentSummary {
  cargo: string;
  summary: {
    /** Only statuses that occur. Cancelled orders are excluded. */
    byStatus: {
      status: PaymentStatus;
      orders: number;
      amountDue: Cents;
      paid: Cents;
      refunded: Cents;
    }[];
    toActivate: { orders: number; amount: Cents };
    open: { orders: number; amount: Cents };
    overdue: { orders: number; amount: Cents };
    collected: Cents;
    refunded: Cents;
    waived: { orders: number };
  };
}
