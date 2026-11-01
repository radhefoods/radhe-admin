// Section 4: customers.

import type { CursorQuery, Id, IsoDateTime, Locale, SortParam } from "./common";

/** `deleted`: the customer closed the account; the record stays for the books. */
export type CustomerStatus = "active" | "blocked" | "deleted";
export const CUSTOMER_STATUSES: readonly CustomerStatus[] = [
  "active",
  "blocked",
  "deleted",
];

/** `registered` signs in with a password; `guest` ordered without an account. */
export type CustomerKind = "registered" | "guest";
export const CUSTOMER_KINDS: readonly CustomerKind[] = ["registered", "guest"];

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

/**
 * 4.1. A closed account (`status: "deleted"`) has `email: "deleted:<id>"`
 * and no personal fields: the panel shows "Deleted account".
 */
export interface Customer {
  id: Id;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  locale: Locale;
  kind: CustomerKind;
  communication: CustomerCommunication;
  createdAt: IsoDateTime;
  status: CustomerStatus;
  blockedReason: string | null;
  blockedAt: IsoDateTime | null;
  /** When the customer closed the account. */
  deletedAt: IsoDateTime | null;
  /** Proven with the emailed code at sign-up; `null` for a guest. */
  emailVerifiedAt: IsoDateTime | null;
  /** The 8 characters of the referral link (27); `null` until first asked for, and for guests. */
  referralCode: string | null;
  /** The customer whose code this one signed up with. */
  referredBy: Id | null;
  lastLoginAt: IsoDateTime | null;
  updatedAt: IsoDateTime;
  addresses: CustomerAddress[];
}

export const CUSTOMER_SORT_FIELDS = ["createdAt", "email", "status"] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export interface CustomerQuery extends CursorQuery {
  status?: CustomerStatus;
  kind?: CustomerKind;
  /** Beginning of the email address, 2 to 254 characters. */
  email?: string;
  /** Words of the name, the email or the phone (1–100). */
  q?: string;
  /** Default `createdAt:desc`. */
  sort?: SortParam<CustomerSortField>;
}

/** `PATCH /customers/{id}/status`: a closed account answers `409 CUSTOMER_DELETED`. */
export interface CustomerStatusInput {
  status: "active" | "blocked";
  /** Stored when blocking, at most 500 characters. */
  reason?: string;
}
