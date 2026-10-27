// Section 9: orders.

import type {
  AdminRef,
  Cents,
  CursorQuery,
  Id,
  IsoDateTime,
  Locale,
  SortParam,
  Translated,
  VatRate,
} from "./common";
import type { PackSize } from "./catalog";
import type { OrderDiscount } from "./discounts";
import type { LegalType } from "./legal";
import type { PaymentBlock, PaymentStatus } from "./payments";

export const ORDER_STATUSES = [
  "pending_payment",
  "confirmed",
  "processing",
  "dispatched",
  "delivered",
  "cancelled",
  "returned",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The statuses `POST /orders/{id}/status` accepts: the forward steps and
 * `confirmed` as the step back from `processing`. A pending order is
 * confirmed by its payment, never by hand.
 */
export type SettableOrderStatus =
  "confirmed" | "processing" | "dispatched" | "delivered";

export const DELIVERY_METHODS = ["radhe_delivery", "dhl", "hermes"] as const;
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];

export const ADMIN_CANCELLATION_REASONS = [
  "customer_request",
  "product_unavailable",
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

/** The shop gave the order up: the page expired, or an item sold out. */
export type SystemCancellationReason = "payment_not_completed" | "sold_out";

export type CancellationReason =
  | AdminCancellationReason
  | CustomerCancellationReason
  | SystemCancellationReason;

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
  /** On a summary: the full name, or `null` when none was given (0.9). */
  name?: string | null;
}

export interface OrderDelivery {
  method: DeliveryMethod;
  trackingNumber: string | null;
  /** The carrier's page for DHL and Hermes, `null` for Radhe delivery. */
  trackingUrl: string | null;
  dispatchedAt: IsoDateTime | null;
  deliveredAt: IsoDateTime | null;
}

/** 9.2: lists and the attention overview. */
export interface OrderSummary {
  id: Id;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  placedAt: IsoDateTime;
  customer: OrderCustomer;
  /** The discount code the order was made with (26), else `null`. */
  discountCode: string | null;
  /** The agreed bill. */
  total: Cents;
  /** After corrections and returns: the invoiced amount minus credit notes. */
  finalTotal: Cents;
  /** What was captured. */
  paidAmount: Cents;
  currency: "EUR";
  lineCount: number;
  itemCount: number;
  city: string;
  postalCode: string;
  delivery: OrderDelivery;
}

/** One line per pack size that was bought: `variantId` is the key of corrections and return decisions. */
export interface OrderItem {
  productId: Id;
  variantId: Id;
  sku: string;
  name: Translated;
  /** "Chakki Atta (5 kg)", English, as the order has it. */
  displayName: string;
  packSize: PackSize;
  imageUrl: string | null;
  quantity: number;
  unitPrice: Cents;
  /** The crossed-out price when the unit price was reduced, else `null`. */
  regularUnitPrice: Cents | null;
  lineTotal: Cents;
  vatRate: VatRate;
  vatPercent: number;
  vatAmount: Cents;
  /** Cents the discount code took off this line (26); 0 without one. */
  discountAmount: Cents;
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
  /** The goods before the discount. */
  subtotal: Cents;
  /** What the discount code took off the goods (26); 0 without one. */
  discount: Cents;
  deliveryFee: Cents;
  total: Cents;
  netTotal: Cents;
  vatTotal: Cents;
  vat: VatLine[];
}

export interface OrderAdjustment {
  productId: Id;
  variantId: Id;
  sku: string;
  from: number;
  to: number;
  reason: AdjustmentReason;
  note: string | null;
  adminId: Id;
  admin?: AdminRef | null;
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
  reason: CancellationReason;
  text: string | null;
  by: Actor;
  adminId: Id | null;
  admin?: AdminRef | null;
  at: IsoDateTime;
}

export interface OrderConsent {
  acceptedAt: IsoDateTime;
  documents: { type: LegalType; version: number; documentId: Id }[];
  ip: string | null;
  userAgent: string | null;
}

/**
 * `field: "payment"` entries use `to` values `authorized`, `paid`, `failed`,
 * `credited` (a credit note was issued; `note` names it) and `refunded` (a
 * refund completed; `note` names it). `field: "delivery"`: the method
 * changed, `from` and `to` are methods.
 */
export interface OrderHistoryEntry {
  field: "order" | "payment" | "delivery";
  from: string | null;
  to: string;
  at: IsoDateTime;
  by: Actor;
  adminId: Id | null;
  admin?: AdminRef | null;
  note: string | null;
}

export interface OrderDetail extends OrderSummary {
  language: Locale;
  items: OrderItem[];
  totals: Totals;
  finalTotals: Totals;
  /** The discount code the order was made with (26), else `null`. */
  discount: OrderDiscount | null;
  adjustments: OrderAdjustment[];
  deliveryAddress: DeliveryAddress;
  /** The customer's note at checkout. */
  note: string | null;
  payment: PaymentBlock;
  canCancel: boolean;
  /** Authoritative: the statuses the API allows from here; `[]` for a pending order. */
  allowedStatuses: SettableOrderStatus[];
  cancellation: OrderCancellation | null;
  consent: OrderConsent;
  statusHistory: OrderHistoryEntry[];
  updatedAt: IsoDateTime;
}

export const ORDER_SORT_FIELDS = [
  "createdAt",
  "total",
  "status",
  "paymentStatus",
] as const;
export type OrderSortField = (typeof ORDER_SORT_FIELDS)[number];

export interface OrderQuery extends CursorQuery {
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  customerId?: Id;
  /** The customer's full email; an unknown one gives an empty list. */
  email?: string;
  /** `RF-1084` */
  orderNumber?: string;
  deliveryMethod?: DeliveryMethod;
  /** `true`: paid orders whose money waits for the admin (11). */
  needsRefund?: boolean;
  /** Words of the order number, the customer's name, email or phone (1–100). */
  q?: string;
  /** Default `createdAt:desc`; `total` is the final bill. */
  sort?: SortParam<OrderSortField>;
}

// --- Chosen orders at once (9: POST /orders/bulk/…) --------------------------

export type BulkChosenStatus = "processing" | "dispatched" | "delivered";

export interface BulkChosenStatusInput {
  /** 1 to 500. */
  orderIds: Id[];
  status: BulkChosenStatus;
  note?: string;
}

export interface BulkChosenMethodInput {
  /** 1 to 500. */
  orderIds: Id[];
  method: DeliveryMethod;
  note?: string;
}

/** Every order is answered: changed, or why not. */
export interface BulkOrderResult {
  orderId: Id;
  /** `null` when the order was not found. */
  orderNumber: string | null;
  changed: boolean;
  reason: string | null;
}

export interface BulkChosenStatusResult {
  status: BulkChosenStatus;
  changed: number;
  results: BulkOrderResult[];
}

export interface BulkChosenMethodResult {
  method: DeliveryMethod;
  changed: number;
  results: BulkOrderResult[];
}

export interface OrderStatusInput {
  status: SettableOrderStatus;
  /** `^[A-Za-z0-9-]{4,60}$`, handy when dispatching. */
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
