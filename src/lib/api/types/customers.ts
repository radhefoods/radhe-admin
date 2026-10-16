// Section 4: customers.

import type { CursorQuery, Id, IsoDateTime, Locale, SortParam } from "./common";

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
}

export const CUSTOMER_SORT_FIELDS = ["createdAt", "email", "status"] as const;
export type CustomerSortField = (typeof CUSTOMER_SORT_FIELDS)[number];

export interface CustomerQuery extends CursorQuery {
  status?: CustomerStatus;
  /** Beginning of the email address, 2 to 254 characters. */
  email?: string;
  /** Words of the name, the email or the phone (1–100). */
  q?: string;
  /** Default `createdAt:desc`. */
  sort?: SortParam<CustomerSortField>;
}

export interface CustomerStatusInput {
  status: CustomerStatus;
  /** Stored when blocking, at most 500 characters. */
  reason?: string;
}
