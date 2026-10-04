// Section 10: orders.

import type {
  CalendarDay,
  Cents,
  CursorQuery,
  Id,
  IsoDateTime,
  Locale,
  Translated,
  VatRate,
} from "./common";
import type { PackSize } from "./catalog";
import type { LegalType } from "./legal";
import type { PaymentBlock, PaymentStatus } from "./payments";

export const ORDER_STATUSES = [
  "confirmed",
  "preparing",
  "dispatched",
  "delivered",
  "delivery_failed",
  "cancelled",
  "returned",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** The statuses `POST /orders/{id}/status` accepts. */
export type SettableOrderStatus = Exclude<
  OrderStatus,
  "cancelled" | "returned"
>;

export const DELIVERY_METHODS = ["radhe_delivery", "dhl", "hermes"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const ADMIN_CANCELLATION_REASONS = [
  "customer_request",
  "product_unavailable",
  "cargo_cancelled",
  "duplicate_order",
  "suspected_misuse",
  "other",
] as const;
export type AdminCancellationReason =
  (typeof ADMIN_CANCELLATION_REASONS)[number];

export type CustomerCancellationReason =
  | "changed_mind"
  | "ordered_by_mistake"
  | "wrong_items"
  | "delivery_too_late"
  | "other";

export const ADJUSTMENT_REASONS = [
  "missing",
  "damaged",
  "wrong_item",
  "customer_complaint",
  "other",
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export interface OrderCustomer {
  id: Id;
  email: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
}

export interface OrderDelivery {
  method: DeliveryMethod;
  trackingNumber: string | null;
  trackingUrl: string | null;
  dispatchedAt: IsoDateTime | null;
  deliveredAt: IsoDateTime | null;
  promisedStart: CalendarDay;
  promisedEnd: CalendarDay;
  cargo: string;
}

/** 10.2: lists and the attention overview. */
export interface OrderSummary {
  id: Id;
  orderNumber: string;
  type: "preorder";
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  placedAt: IsoDateTime;
  customer: OrderCustomer;
  cargo: { id: Id; code: string };
  /** The agreed bill. */
  total: Cents;
  /** After corrections and returns: the invoiced amount. */
  finalTotal: Cents;
  currency: "EUR";
  lineCount: number;
  itemCount: number;
  city: string;
  postalCode: string;
  delivery: OrderDelivery;
}

export interface OrderItem {
  productId: Id;
  sku: string;
  name: Translated;
  packSize: PackSize;
  imageUrl: string | null;
  quantity: number;
  unitPrice: Cents;
  regularUnitPrice: Cents;
  lineTotal: Cents;
  vatRate: VatRate;
  vatPercent: number;
  vatAmount: Cents;
  deliveredQuantity: number;
  returnedQuantity: number;
  finalLineTotal: Cents;
}

export interface VatLine {
  vatRate: VatRate;
  gross: Cents;
  net: Cents;
  vat: Cents;
}

export interface Totals {
  currency: "EUR";
  subtotal: Cents;
  deliveryFee: Cents;
  total: Cents;
  netTotal: Cents;
  vatTotal: Cents;
  vat: VatLine[];
}

export interface OrderAdjustment {
  productId: Id;
  sku: string;
  from: number;
  to: number;
  reason: AdjustmentReason;
  note: string | null;
  adminId: Id;
  at: IsoDateTime;
}

/** `company`, `additionalLine` and `phone` are absent when unset. */
export interface DeliveryAddress {
  firstName: string;
  lastName: string;
  company?: string;
  street: string;
  houseNumber: string;
  additionalLine?: string;
  postalCode: string;
  city: string;
  countryCode: string;
  phone?: string;
}

export type Actor = "customer" | "admin" | "system";

export interface OrderCancellation {
  reason: AdminCancellationReason | CustomerCancellationReason;
  text: string | null;
  by: Actor;
  adminId: Id | null;
  at: IsoDateTime;
}

export interface OrderConsent {
  acceptedAt: IsoDateTime;
  documents: { type: LegalType; version: number; documentId: Id }[];
  ip: string | null;
  userAgent: string | null;
}

/**
 * `field: "payment"` entries use `to` values such as `due`, `overdue`,
 * `paid`, `waived`, `refunded`, `credited`, `reminders_paused`,
 * `reminders_resumed`, `reminder_sent`, `payment_failed`.
 */
export interface OrderHistoryEntry {
  field: "order" | "payment" | "cargo" | "delivery";
  from: string | null;
  to: string;
  at: IsoDateTime;
  by: Actor;
  adminId: Id | null;
  note: string | null;
}

export interface OrderDetail extends OrderSummary {
  language: Locale;
  items: OrderItem[];
  totals: Totals;
  finalTotals: Totals;
  adjustments: OrderAdjustment[];
  deliveryAddress: DeliveryAddress;
  /** The customer's note. */
  note: string | null;
  payment: PaymentBlock;
  canCancel: boolean;
  /** Authoritative: the statuses the API allows from here. */
  allowedStatuses: SettableOrderStatus[];
  /** To another cargo. */
  canMove: boolean;
  cancellation: OrderCancellation | null;
  consent: OrderConsent;
  statusHistory: OrderHistoryEntry[];
  updatedAt: IsoDateTime;
}

export interface OrderQuery extends CursorQuery {
  cargoId?: Id;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  customerId?: Id;
  /** The customer's full email; an unknown one gives an empty list. */
  email?: string;
  /** `RF-1084` */
  orderNumber?: string;
  deliveryMethod?: DeliveryMethod;
}

export interface OrderCargoSummary {
  cargoId: Id;
  summary: {
    orders: number;
    cancelledOrders: number;
    customers: number;
    units: number;
    bookedValue: Cents;
    byStatus: { status: OrderStatus; orders: number; value: Cents }[];
  };
}

export interface OrderStatusInput {
  status: SettableOrderStatus;
  /** `^[A-Za-z0-9-]{4,60}$` */
  trackingNumber?: string;
  note?: string;
}

export interface OrderDeliveryInput {
  method?: DeliveryMethod;
  trackingNumber?: string | null;
  note?: string;
}

export interface OrderItemAdjustmentInput {
  deliveredQuantity: number;
  reason: AdjustmentReason;
  note?: string;
}

export interface OrderCancelInput {
  reason: AdminCancellationReason;
  text?: string;
}
