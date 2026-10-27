// Section 26: discount codes of the retail shop. doc/DISCOUNT_CODES.md has
// the rules, the arithmetic and the full objects. The wholesale site is
// not involved.

import type { AdminRef, Cents, Id, IsoDateTime, PageQuery } from "./common";

/** A whole percent of the eligible goods, or a fixed amount in cents. */
export type DiscountType = "percent" | "fixed";
export const DISCOUNT_TYPES: readonly DiscountType[] = ["percent", "fixed"];

/**
 * Derived by the API, in this order of precedence: switched off, before
 * its start, after its end, used up, else active. The panel never works
 * it out.
 */
export type DiscountState =
  "active" | "inactive" | "scheduled" | "expired" | "exhausted";
export const DISCOUNT_STATES: readonly DiscountState[] = [
  "active",
  "inactive",
  "scheduled",
  "expired",
  "exhausted",
];

/** A use of a code by an order: reserved at checkout, used once paid, released when given up unpaid. */
export type DiscountUseState = "reserved" | "used" | "released";

/** The limits of the API (sections 2 and 7). */
export const DISCOUNT_RULES = {
  codeMinLength: 4,
  codeMaxLength: 20,
  /** A generated code has this many characters. */
  generatedLength: 8,
  noteMaxLength: 200,
  percentMin: 1,
  percentMax: 100,
  /** A fixed amount in cents: at most 10,000 €. */
  fixedMin: 1,
  fixedMax: 1_000_000,
  minOrderValueMax: 10_000_000,
  maxUsesMin: 1,
  maxUsesMax: 1_000_000,
  /** `limit` default of the lists. */
  pageLimit: 24,
} as const;

export interface DiscountCode {
  id: Id;
  /** Upper case; letters, digits and hyphens. */
  code: string;
  /** Internal, never shown to customers. */
  note: string | null;
  type: DiscountType;
  /** A whole percent, or cents. */
  value: number;
  /** `false`: lines sold at a reduced price are left out. */
  appliesToSaleItems: boolean;
  /** Cents the goods must be worth before the discount; `null`: none. */
  minOrderValue: Cents | null;
  startsAt: IsoDateTime | null;
  expiresAt: IsoDateTime | null;
  /** `null`: without limit. `usedCount + reservedCount` counts against it. */
  maxUses: number | null;
  oncePerCustomer: boolean;
  isActive: boolean;
  /** Orders paid with the code. */
  usedCount: number;
  /** Orders made with the code that wait for their payment. */
  reservedCount: number;
  /** `null` when unlimited. */
  remainingUses: number | null;
  state: DiscountState;
  createdBy: AdminRef | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** `POST /discounts`: without `code` the API generates one. */
export interface DiscountInput {
  code?: string;
  note?: string;
  type: DiscountType;
  value: number;
  appliesToSaleItems?: boolean;
  minOrderValue?: Cents;
  startsAt?: IsoDateTime;
  expiresAt?: IsoDateTime;
  maxUses?: number;
  oncePerCustomer?: boolean;
  isActive?: boolean;
}

/** `PATCH /discounts/{id}`: any field; `null` removes the optional ones. */
export interface DiscountPatch {
  code?: string;
  note?: string;
  type?: DiscountType;
  value?: number;
  appliesToSaleItems?: boolean;
  minOrderValue?: Cents | null;
  startsAt?: IsoDateTime | null;
  expiresAt?: IsoDateTime | null;
  maxUses?: number | null;
  oncePerCustomer?: boolean;
  isActive?: boolean;
}

export interface DiscountQuery extends PageQuery {
  /** Searches the code and the note. */
  q?: string;
  status?: DiscountState;
}

/** One order made with the code (`GET /discounts/{id}/uses`). */
export interface DiscountUse {
  id: Id;
  orderId: Id;
  orderNumber: string;
  customer: { id: Id; email: string };
  /** Cents taken off the order. */
  amount: Cents;
  state: DiscountUseState;
  /** When the order was made. */
  at: IsoDateTime;
  /** When the order was paid, or given up. */
  settledAt: IsoDateTime | null;
}

/** The code on an order, as the order carries it (section 26). */
export interface OrderDiscount {
  code: string;
  type: DiscountType;
  value: number;
  /** Cents taken off the goods of the order. */
  amount: Cents;
  state: DiscountUseState;
}
