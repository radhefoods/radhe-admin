// Sections 12 (payments and refunds) and 13 (invoices and credit notes).

import type {
  CalendarDay,
  Cents,
  CursorQuery,
  Id,
  IsoDateTime,
  Locale,
  VatRate,
} from "./common";
import type { Actor, Totals } from "./orders";

export const PAYMENT_STATUSES = [
  "not_enabled",
  "due",
  "overdue",
  "paid",
  "waived",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export type PaymentMethod = "stripe" | "cash" | "credit";

/** 12.1, before activation. */
export interface PaymentBlockNotEnabled {
  status: "not_enabled";
  /** The order is `delivered` and its final bill is above 0. */
  canActivate: boolean;
}

/** 12.1, after activation. */
export interface PaymentBlockActive {
  status: Exclude<PaymentStatus, "not_enabled">;
  canActivate: false;
  activatedAt: IsoDateTime;
  activatedBy: Id | null;
  deadlineDays: number;
  deadline: IsoDateTime;
  isOverdue: boolean;
  invoice: { id: Id; number: string };
  invoicedAmount: Cents;
  creditedAmount: Cents;
  paidAmount: Cents;
  refundedAmount: Cents;
  amountDue: Cents;
  method: PaymentMethod | null;
  paidAt: IsoDateTime | null;
  stripe: {
    paymentIntentId: string | null;
    chargeId: string | null;
    paymentType: "card" | "paypal" | null;
    receiptUrl: string | null;
    checkoutOpenUntil: IsoDateTime | null;
  } | null;
  cash: {
    collectedAt: IsoDateTime;
    recordedBy: Id | null;
    note: string | null;
  } | null;
  reminders: {
    nextAt: IsoDateTime | null;
    sentCount: number;
    lastSentAt: IsoDateTime | null;
    paused: boolean;
  };
  waivedReason: string | null;
  /** Needs Stripe configured on the server. */
  canPayOnline: boolean;
  /** True while the order is owing (`due` / `overdue`). */
  canRecordCash: boolean;
  canWaive: boolean;
}

export type PaymentBlock = PaymentBlockNotEnabled | PaymentBlockActive;

export interface Refundable {
  paidAmount: Cents;
  refundedAmount: Cents;
  /** Refunds decided but not yet complete. */
  openAmount: Cents;
  /** Paid minus refunded minus open refunds. */
  maximum: Cents;
  /** What credit notes left over after the payment. */
  suggested: Cents;
  /** Paid through Stripe. */
  stripePossible: boolean;
}

export interface OrderPayment {
  orderNumber: string;
  payment: PaymentBlock;
  documents: InvoiceSummary[];
  refunds: Refund[];
  refundable: Refundable;
}

export interface ActivatePaymentInput {
  /** 1 to 60. */
  deadlineDays: number;
  note?: string;
}

export interface CashPaymentInput {
  /** The full amount due: no partial payments. */
  amount: Cents;
  collectedAt?: IsoDateTime;
  note?: string;
}

// --- Refunds (12.9) ---------------------------------------------------------

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

export interface RefundHistoryEntry {
  from: RefundStatus | null;
  to: RefundStatus;
  at: IsoDateTime;
  by: Actor;
  adminId: Id | null;
  note: string | null;
}

export interface Refund {
  id: Id;
  /** `RF-1084-RF1` */
  refundNumber: string;
  orderId: Id;
  orderNumber: string;
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
  createdAt: IsoDateTime;
  completedAt: IsoDateTime | null;
  statusHistory: RefundHistoryEntry[];
}

export interface RefundQuery extends CursorQuery {
  status?: RefundStatus;
  orderNumber?: string;
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

export interface PaymentJobsResult {
  overdue: number;
  reminders: number;
}

// --- Invoices and credit notes (13) -----------------------------------------

export type InvoiceType = "invoice" | "credit_note";
export type CreditReason = "return" | "adjustment";

/** 13.1. Credit notes have `dueAt` / `paidAt` `null`. */
export interface InvoiceSummary {
  id: Id;
  /** `INV-2026-000123`, `CN-2026-000007` */
  number: string;
  type: InvoiceType;
  orderNumber: string;
  issuedAt: IsoDateTime;
  dueAt: IsoDateTime | null;
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
  cargoId: Id | null;
  deliveredOn: CalendarDay | null;
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
}
