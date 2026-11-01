// Section 27: referrals. doc/CUSTOMER_ACCOUNTS.md section 7 has the rules.

import type {
  CursorQuery,
  CustomerRef,
  Id,
  IsoDateTime,
  SortParam,
} from "./common";

/**
 * `registered` at the sign-up of the invited person, `qualified` once their
 * first delivered order stands with nothing to refund, `void` when all the
 * goods of that order were credited later.
 */
export type ReferralStatus = "registered" | "qualified" | "void";
export const REFERRAL_STATUSES: readonly ReferralStatus[] = [
  "registered",
  "qualified",
  "void",
];

export interface Referral {
  id: Id;
  status: ReferralStatus;
  /** The inviter's code the invited person signed up with. */
  code: string;
  /** The inviter. */
  referrerId: Id;
  referrer?: CustomerRef | null;
  /** The invited person. */
  referredId: Id;
  referred?: CustomerRef | null;
  registeredAt: IsoDateTime;
  /** The qualifying order: the invited person's first delivered one. */
  orderId: Id | null;
  orderNumber: string | null;
  qualifiedAt: IsoDateTime | null;
  /** `refunded` when the goods of the qualifying order were all credited. */
  voidReason: string | null;
  voidAt: IsoDateTime | null;
}

export const REFERRAL_SORT_FIELDS = ["createdAt", "status"] as const;
export type ReferralSortField = (typeof REFERRAL_SORT_FIELDS)[number];

export interface ReferralQuery extends CursorQuery {
  status?: ReferralStatus;
  referrerId?: Id;
  referredId?: Id;
  /** Default `createdAt:desc`. */
  sort?: SortParam<ReferralSortField>;
}
