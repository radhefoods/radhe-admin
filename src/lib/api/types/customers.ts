// Section 4: customers.

import type { Cents, CursorQuery, Id, IsoDateTime, Locale } from "./common";

export type CustomerStatus = "active" | "blocked";
export type SignupMethod = "email_otp" | "google";

export interface CustomerAddress {
  id: Id;
  firstName: string;
  lastName: string;
  company: string | null;
  street: string;
  houseNumber: string;
  additionalLine: string | null;
  postalCode: string;
  city: string;
  countryCode: string;
  phone: string | null;
  isDefault: boolean;
}

export interface CustomerCommunication {
  whatsappNumber: string | null;
  whatsappOptIn: boolean;
  whatsappOptInAt: IsoDateTime | null;
  marketingOptIn: boolean;
  marketingOptInAt: IsoDateTime | null;
  marketingOptOutAt: IsoDateTime | null;
}

export type OrderingMode = "blocked" | "allowed";
export type OrderingAction = "block" | "allow" | "clear";

export interface OrderingOverride {
  mode: OrderingMode;
  reason: string;
  adminId: Id;
  at: IsoDateTime;
  until: IsoDateTime | null;
}

export interface OrderingHistoryEntry {
  action: OrderingAction;
  reason: string;
  adminId: Id;
  at: IsoDateTime;
  until: IsoDateTime | null;
}

/** 4.1. */
export interface Customer {
  id: Id;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  locale: Locale;
  hasGoogleLogin: boolean;
  communication: CustomerCommunication;
  createdAt: IsoDateTime;
  status: CustomerStatus;
  blockedReason: string | null;
  blockedAt: IsoDateTime | null;
  signupMethod: SignupMethod;
  emailVerifiedAt: IsoDateTime | null;
  lastLoginAt: IsoDateTime | null;
  updatedAt: IsoDateTime;
  addresses: CustomerAddress[];
  orderingOverride: OrderingOverride | null;
  orderingHistory: OrderingHistoryEntry[];
}

export interface CustomerQuery extends CursorQuery {
  status?: CustomerStatus;
  /** Beginning of the email address, 2 to 254 characters. */
  email?: string;
}

export type CannotOrderReason =
  "account_blocked" | "ordering_blocked" | "payment_overdue";

export interface OverduePayment {
  orderNumber: string;
  invoiceNumber: string;
  amountDue: Cents;
  deadlineAt: IsoDateTime;
}

export interface CustomerOrdering {
  ordering: {
    canOrder: boolean;
    reason: CannotOrderReason | null;
    /** Shown only while it applies. */
    override: { mode: OrderingMode; until: IsoDateTime | null } | null;
    overdue: OverduePayment[];
  };
  history: OrderingHistoryEntry[];
}

export interface OrderingDecisionInput {
  action: OrderingAction;
  reason: string;
  /** Required for `allow`, 1 to 365. */
  allowDays?: number;
}
