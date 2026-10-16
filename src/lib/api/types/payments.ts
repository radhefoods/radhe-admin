// Sections 11 (payments and refunds) and 12 (invoices and credit notes).

import type {
  AdminRef,
  Cents,
  CursorQuery,
  CustomerRef,
  Id,
  IsoDateTime,
  Locale,
  SortParam,
  VatRate,
} from "./common";
import type { OrderStatus, Totals } from "./orders";

export const PAYMENT_STATUSES = [
  "pending",
  "authorized",
  "paid",
  "failed",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** How the customer paid on the Stripe page. */
export type PaymentType = "card" | "paypal";

/** 11.1: the payment of an order. */
export interface PaymentBlock {
  status: PaymentStatus;
  /** The total agreed at checkout. */
  amount: Cents;
  /** What was captured. */
  paidAmount: Cents;
  /** The sum of credit notes issued after the invoice. */
  creditedAmount: Cents;
  /** The sum of completed refunds. */
  refundedAmount: Cents;
  /** `card` or `paypal` once paid, else `null`. */
  method: PaymentType | null;
  paidAt: IsoDateTime | null;
  receiptUrl: string | null;
  /** `null` until the invoice is issued; `pdfPath` is for the shop. */
  invoice: { number: string; issuedAt: IsoDateTime; pdfPath: string } | null;
  /** The open payment page of a pending order, else `null`. */
  checkout: { url: string; expiresAt: IsoDateTime } | null;
  /** Pending or failed, and Stripe is configured. */
  canPayOnline: boolean;
  /** Why the last attempt did not go through. */
  lastFailure: string | null;
  /** How many payment pages were opened. */
  attempts: number;
  checkoutSessionId: string | null;
  checkoutExpiresAt: IsoDateTime | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  authorizedAt: IsoDateTime | null;
  invoiceId: Id | null;
  /** `paidAmount` minus `refundedAmount`. */
  refundableAmount: Cents;
  /** Money waits for the admin's decision (cancelled, or credited). */
  needsRefund: boolean;
}

export interface Refundable {
  paidAmount: Cents;
  refundedAmount: Cents;
  /** Refunds decided but not yet complete. */
  openAmount: Cents;
  /** Paid minus refunded minus open refunds. */
  maximum: Cents;
  /**
   * What the cancellation (everything paid) or the credit notes call for,
   * minus what went back or is on its way, at most `maximum`.
   */
  suggested: Cents;
  /** Paid through Stripe: Stripe can refund. */
  stripePossible: boolean;
}

/** `GET /orders/{id}/payment`. */
export interface OrderPayment {
  orderNumber: string;
  /** The order status. */
  status: OrderStatus;
  payment: PaymentBlock;
  refundable: Refundable;
  /** Oldest first: the invoice, then its credit notes. */
  documents: InvoiceSummary[];
  /** Newest first. */
  refunds: Refund[];
}

// --- Refunds (11.2) ---------------------------------------------------------

export const REFUND_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_REASONS = [
  "return",
  "adjustment",
  "goodwill",
  "duplicate_payment",
  "other",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

export type RefundMethod = "stripe" | "manual";
export const MANUAL_REFUND_WAYS = ["bank_transfer", "cash", "other"] as const;
export type ManualRefundWay = (typeof MANUAL_REFUND_WAYS)[number];

/** `by` is the admin, or Stripe answering about a Stripe refund. */
export interface RefundHistoryEntry {
  from: RefundStatus | null;
  to: RefundStatus;
  at: IsoDateTime;
  by: "admin" | "stripe";
  adminId: Id | null;
  admin?: AdminRef | null;
  note: string | null;
}

export interface Refund {
  id: Id;
  /** `RF-1084-RF1` */
  refundNumber: string;
  orderId: Id;
  orderNumber: string;
  customerId?: Id;
  customer?: CustomerRef | null;
  invoiceNumber: string | null;
  amount: Cents;
  reason: RefundReason;
  method: RefundMethod;
  /** `pending`: manual, waiting for the admin. `processing`: Stripe is working. */
  status: RefundStatus;
  manual: {
    way: ManualRefundWay;
    reference: string | null;
    paidAt: IsoDateTime | null;
  } | null;
  stripe: {
    refundId: string | null;
    paymentIntentId: string | null;
    stripeStatus: string | null;
    failureReason: string | null;
  } | null;
  note: string | null;
  createdBy: Id | null;
  createdByAdmin?: AdminRef | null;
  createdAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  statusHistory: RefundHistoryEntry[];
}

export const REFUND_SORT_FIELDS = ["createdAt", "amount", "status"] as const;
export type RefundSortField = (typeof REFUND_SORT_FIELDS)[number];

export interface RefundQuery extends CursorQuery {
  status?: RefundStatus;
  orderNumber?: string;
  /** Default `createdAt:desc`. */
  sort?: SortParam<RefundSortField>;
}

export interface CreateRefundInput {
  /** At most `refundable.maximum`. */
  amount: Cents;
  reason: RefundReason;
  /** `stripe` only when `refundable.stripePossible`. */
  method: RefundMethod;
  manual?: { way: ManualRefundWay; reference?: string };
  note?: string;
}

export interface CompleteRefundInput {
  paidAt?: IsoDateTime;
  reference?: string;
  note?: string;
}

// --- Invoices and credit notes (12) -----------------------------------------

export type InvoiceType = "invoice" | "credit_note";
export type CreditReason = "return" | "adjustment";

/** 12.1. An invoice is issued paid; a credit note has `paidAt` `null`. */
export interface InvoiceSummary {
  id: Id;
  /** `INV-2026-000123`, `CN-2026-000007` */
  number: string;
  type: InvoiceType;
  orderNumber: string;
  issuedAt: IsoDateTime;
  paidAt: IsoDateTime | null;
  total: Cents;
  currency: "EUR";
  language: Locale;
  /** Credit notes: the corrected invoice. */
  invoiceNumber: string | null;
  creditReason: CreditReason | null;
}

export interface InvoiceLine {
  description: string;
  sku: string | null;
  quantity: number;
  unitPrice: Cents;
  vatRate: VatRate;
  vatPercent: number;
  lineTotal: Cents;
}

export interface InvoiceDetail extends InvoiceSummary {
  orderId: Id;
  customerId: Id;
  /** The return number, or `<sku>: <reason>` of a correction; `null` on an invoice. */
  creditReference: string | null;
  seller: {
    name: string;
    addressLines: string[];
    email: string;
    phone?: string | null;
    website?: string | null;
    vatId?: string | null;
    taxNumber?: string | null;
    registration?: string | null;
  };
  customer: {
    name: string;
    company?: string | null;
    addressLines: string[];
    email: string;
  };
  lines: InvoiceLine[];
  totals: Totals;
  footer: string | null;
}

export interface InvoiceQuery extends CursorQuery {
  type?: InvoiceType;
  orderNumber?: string;
  customerId?: Id;
  /** One document exactly: `INV-2026-000123` or `CN-2026-000007`, any case. */
  number?: string;
  /** The beginning of a number; ignored when `number` is given. */
  q?: string;
}
