// Section 30: points and rewards (loyalty coins). doc/REWARDS.md has the
// rules: customers collect coins for delivered orders, the sign-up,
// referrals and published reviews, and redeem them at checkout for a
// percentage of the goods per coin. The admin sets every rule here.

import type {
  AdminRef,
  Cents,
  CursorQuery,
  CustomerRef,
  Id,
  IsoDateTime,
  SortParam,
} from "./common";

/** The API's ranges for the settings (REWARDS.md, section 4). */
export const REWARDS_RULES = {
  /** `coinsPerEuro`: 0 to 1000, up to four decimals. */
  coinsPerEuroMax: 1000,
  coinsPerEuroDecimals: 4,
  /** `percentPerCoin`: 0.000001 to 10, up to six decimals. */
  percentPerCoinMin: 0.000001,
  percentPerCoinMax: 10,
  percentPerCoinDecimals: 6,
  multiplierMin: 1,
  multiplierMax: 10,
  /** Cents of a minimum or a cap. */
  centsMax: 10_000_000,
  /** Coins of a rule, a minimum or a cap. */
  coinsMax: 1_000_000,
} as const;

/** A rule that gives a fixed number of coins once, with its own switch. */
export interface RewardCoinsRule {
  enabled: boolean;
  coins: number;
}

export interface RewardsSettings {
  /** Off: nothing is earned or redeemed; balances stay and are shown. */
  enabled: boolean;
  earning: {
    /** Coins per euro of goods paid, given at delivery. */
    order: { enabled: boolean; coinsPerEuro: number };
    /** Once per email address, after the verified sign-up. */
    welcome: RewardCoinsRule;
    referral: {
      /** When the invited person's first order is delivered. */
      inviter: RewardCoinsRule;
      invitee: RewardCoinsRule;
    };
    /** When the admin publishes the review. */
    review: RewardCoinsRule;
    /** Multiplies the order coins while it runs. */
    campaign: {
      enabled: boolean;
      multiplier: number;
      startsAt: IsoDateTime | null;
      endsAt: IsoDateTime | null;
      name: string | null;
    };
  };
  redemption: {
    enabled: boolean;
    /** Percent of the goods one coin takes off: 0.01 = 100 coins are 1 %. */
    percentPerCoin: number;
    /** A balance below this cannot redeem; `null` = off. */
    minCoins: number | null;
    /** Cents a redemption must be worth at least; `null` = off. */
    minRedeemValue: Cents | null;
    /** Cents the goods must reach; `null` = off. */
    minOrderValue: Cents | null;
    maxCoinsPerOrder: number | null;
    /** Cents one order can take off at most; `null` = off. */
    maxDiscount: Cents | null;
    combinableWithDiscountCodes: boolean;
  };
  expiry: {
    enabled: boolean;
    /** The whole balance expires after this many months without a movement. */
    inactivityMonths: number;
  };
}

export interface RewardsSummary {
  accounts: number;
  accountsWithBalance: number;
  coinsOutstanding: number;
  coinsReserved: number;
  last30Days: {
    earned: number;
    redeemed: number;
    returned: number;
    reversed: number;
    adjusted: number;
    expired: number;
    ordersWithCoins: number;
  };
}

/** One per customer, made on first use; the sum of the ledger. */
export interface RewardAccount {
  id: Id;
  customerId: Id;
  customer?: CustomerRef | null;
  /** Spendable; never below 0. */
  available: number;
  /** Exact; below 0 after coins were taken back. */
  balance: number;
  /** Held by unpaid orders. */
  reserved: number;
  earnedTotal: number;
  redeemedTotal: number;
  lastActivityAt: IsoDateTime | null;
  expiresAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export type RewardTransactionType =
  | "order"
  | "welcome"
  | "referral_inviter"
  | "referral_invitee"
  | "review"
  | "redeem"
  | "redeem_return"
  | "reversal"
  | "adjustment"
  | "expiry";
export const REWARD_TRANSACTION_TYPES: readonly RewardTransactionType[] = [
  "order",
  "welcome",
  "referral_inviter",
  "referral_invitee",
  "review",
  "redeem",
  "redeem_return",
  "reversal",
  "adjustment",
  "expiry",
];

/** `done` for every row but a redemption, which is `reserved` until the payment, then `spent` or `released`. */
export type RewardTransactionState = "done" | "reserved" | "spent" | "released";
export const REWARD_TRANSACTION_STATES: readonly RewardTransactionState[] = [
  "done",
  "reserved",
  "spent",
  "released",
];

export type RewardAdjustmentReason =
  "goodwill" | "correction" | "misuse" | "other";
export const REWARD_ADJUSTMENT_REASONS: readonly RewardAdjustmentReason[] = [
  "goodwill",
  "correction",
  "misuse",
  "other",
];

/** One row of the append-only ledger, written once under its key. */
export interface RewardTransaction {
  id: Id;
  type: RewardTransactionType;
  /** Signed: negative when coins leave the account. */
  coins: number;
  state: RewardTransactionState;
  orderId: Id | null;
  orderNumber: string | null;
  /** A return number, a report number, a review: what the row goes back to. */
  reference: string | null;
  /** The coins per euro that applied to an order row. */
  rate: number | null;
  /** The reason of an adjustment. */
  reason: RewardAdjustmentReason | null;
  note: string | null;
  customerId: Id;
  customer?: CustomerRef | null;
  adminId: Id | null;
  admin?: AdminRef | null;
  key: string;
  at: IsoDateTime;
}

export const REWARD_ACCOUNT_SORT_FIELDS = [
  "available",
  "lastActivityAt",
  "createdAt",
] as const;
export type RewardAccountSortField =
  (typeof REWARD_ACCOUNT_SORT_FIELDS)[number];

export interface RewardAccountQuery extends CursorQuery {
  customerId?: Id;
  /** `true`: accounts with coins to spend; `false`: the others. */
  withBalance?: boolean;
  /** Default `createdAt:desc`. */
  sort?: SortParam<RewardAccountSortField>;
}

/** `GET /rewards/accounts/{customerId}`: the account with its latest 50 rows. */
export interface RewardAccountDetail {
  account: RewardAccount;
  transactions: RewardTransaction[];
}

export const REWARD_TRANSACTION_SORT_FIELDS = ["createdAt", "type"] as const;
export type RewardTransactionSortField =
  (typeof REWARD_TRANSACTION_SORT_FIELDS)[number];

export interface RewardTransactionQuery extends CursorQuery {
  customerId?: Id;
  type?: RewardTransactionType;
  orderNumber?: string;
  /** Default `createdAt:desc`. */
  sort?: SortParam<RewardTransactionSortField>;
}

/** `POST /rewards/accounts/{customerId}/adjust`: by hand, with a reason. */
export interface RewardAdjustInput {
  /** Signed; never 0. */
  coins: number;
  reason: RewardAdjustmentReason;
  note?: string;
}

export interface RewardAdjustResult {
  account: RewardAccount;
  transaction: RewardTransaction;
}

/** The coins redeemed on an order (30): `reserved` until it is paid. */
export type OrderRewardsState = "reserved" | "used" | "released";

export interface OrderRewards {
  coins: number;
  /** Cents taken off the goods. */
  amount: Cents;
  percentPerCoin: number;
  state: OrderRewardsState;
}
