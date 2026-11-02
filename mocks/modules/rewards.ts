// Section 30: points and rewards (loyalty coins). doc/REWARDS.md has the
// long version. Every movement is one row of a ledger with a key, written
// once; the account is the sum of its rows and is rebuilt after every row.

import { z } from "zod";
import type {
  Customer,
  OrderItem,
  RewardAccount,
  RewardAdjustmentReason,
  RewardTransaction,
  RewardTransactionType,
  RewardsSettings,
  RewardsSummary,
} from "../../src/lib/api/types/index.ts";
import type { AdminRecord, Db, OrderRecord } from "../db.ts";
import { totalsOf, vatOf } from "../domain.ts";
import {
  boolParam,
  enumParam,
  fail,
  idParam,
  json,
  newId,
  sortedCursorPage,
} from "../http.ts";
import type { Router } from "../router.ts";
import { DAY, iso } from "../time.ts";

/** The account as stored: the customer is named on reading (0.9). */
export type RewardAccountRecord = Omit<RewardAccount, "customer">;
/** A ledger row as stored: the customer and the admin are named on reading. */
export type RewardTransactionRecord = Omit<
  RewardTransaction,
  "customer" | "admin"
>;

const TYPES = [
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
] as const;
const REASONS = ["goodwill", "correction", "misuse", "other"] as const;
const EARNING: readonly RewardTransactionType[] = [
  "order",
  "welcome",
  "referral_inviter",
  "referral_invitee",
  "review",
];

// --- The settings (4) --------------------------------------------------------

const coinsRule = z.strictObject({
  enabled: z.boolean(),
  coins: z.number().int().min(0).max(1_000_000),
});

const decimals = (places: number) => (value: number) =>
  Number.isInteger(Math.round(value * 10 ** places) / 1) &&
  Math.abs(value * 10 ** places - Math.round(value * 10 ** places)) < 1e-6;

export const rewardsSettingsBody = z.strictObject({
  enabled: z.boolean(),
  earning: z.strictObject({
    order: z.strictObject({
      enabled: z.boolean(),
      coinsPerEuro: z
        .number()
        .min(0)
        .max(1000)
        .refine(decimals(4), "at most four decimals"),
    }),
    welcome: coinsRule,
    referral: z.strictObject({ inviter: coinsRule, invitee: coinsRule }),
    review: coinsRule,
    campaign: z.strictObject({
      enabled: z.boolean(),
      multiplier: z.number().min(1).max(10),
      startsAt: z.string().datetime({ offset: true }).nullable(),
      endsAt: z.string().datetime({ offset: true }).nullable(),
      name: z.string().max(80).nullable(),
    }),
  }),
  redemption: z.strictObject({
    enabled: z.boolean(),
    percentPerCoin: z
      .number()
      .min(0.000001)
      .max(10)
      .refine(decimals(6), "at most six decimals"),
    minCoins: z.number().int().min(0).max(1_000_000).nullable(),
    minRedeemValue: z.number().int().min(0).max(10_000_000).nullable(),
    minOrderValue: z.number().int().min(0).max(10_000_000).nullable(),
    maxCoinsPerOrder: z.number().int().min(0).max(1_000_000).nullable(),
    maxDiscount: z.number().int().min(0).max(10_000_000).nullable(),
    combinableWithDiscountCodes: z.boolean(),
  }),
  expiry: z.strictObject({
    enabled: z.boolean(),
    inactivityMonths: z.number().int().min(1).max(120),
  }),
});

/** The campaign multiplies the order coins while it runs (3). */
function campaignMultiplier(settings: RewardsSettings, at: number): number {
  const campaign = settings.earning.campaign;
  if (!campaign.enabled) return 1;
  if (campaign.startsAt && Date.parse(campaign.startsAt) > at) return 1;
  if (campaign.endsAt && Date.parse(campaign.endsAt) < at) return 1;
  return campaign.multiplier;
}

// --- The ledger and the account (4) ------------------------------------------

function accountOf(db: Db, customerId: string, now: number) {
  let account = db.rewardAccounts.find(
    (entry) => entry.customerId === customerId,
  );
  if (!account) {
    account = {
      id: newId(now),
      customerId,
      available: 0,
      balance: 0,
      reserved: 0,
      earnedTotal: 0,
      redeemedTotal: 0,
      lastActivityAt: null,
      expiresAt: null,
      createdAt: iso(now),
      updatedAt: iso(now),
    };
    db.rewardAccounts.push(account);
  }
  return account;
}

/** The account is the sum of its rows: rebuilt after every row (1). */
function syncAccount(db: Db, customerId: string, now: number): void {
  const account = accountOf(db, customerId, now);
  const rows = db.rewardTransactions.filter(
    (row) => row.customerId === customerId,
  );
  let balance = 0;
  let reserved = 0;
  let earned = 0;
  let redeemed = 0;
  let last: string | null = null;
  for (const row of rows) {
    if (row.type === "redeem" && row.state === "released") continue;
    balance += row.coins;
    if (row.type === "redeem" && row.state === "reserved")
      reserved += -row.coins;
    if (row.type === "redeem" && row.state === "spent") redeemed += -row.coins;
    if (EARNING.includes(row.type) && row.coins > 0) earned += row.coins;
    if (!last || row.at > last) last = row.at;
  }
  account.balance = balance;
  account.available = Math.max(0, balance);
  account.reserved = reserved;
  account.earnedTotal = earned;
  account.redeemedTotal = redeemed;
  account.lastActivityAt = last;
  const expiry = db.rewardsSettings.expiry;
  account.expiresAt =
    expiry.enabled && last && balance > 0
      ? iso(addMonths(Date.parse(last), expiry.inactivityMonths))
      : null;
  account.updatedAt = iso(now);
}

function addMonths(at: number, months: number): number {
  const date = new Date(at);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}

/** Writes a row once under its key; a second write with the same key does nothing. */
function writeRow(
  db: Db,
  row: Omit<RewardTransactionRecord, "id"> & { id?: string },
  now: number,
): RewardTransactionRecord | null {
  if (db.rewardTransactions.some((entry) => entry.key === row.key)) return null;
  const stored: RewardTransactionRecord = { id: newId(now), ...row };
  db.rewardTransactions.push(stored);
  syncAccount(db, row.customerId, now);
  return stored;
}

const plain = (
  type: RewardTransactionType,
  customerId: string,
  coins: number,
  key: string,
  at: number,
  extra: Partial<RewardTransactionRecord> = {},
): Omit<RewardTransactionRecord, "id"> => ({
  type,
  coins,
  state: "done",
  orderId: null,
  orderNumber: null,
  reference: null,
  rate: null,
  reason: null,
  note: null,
  customerId,
  adminId: null,
  key,
  at: iso(at),
  ...extra,
});

// --- Earning (1, 3) ----------------------------------------------------------

/** The verified sign-up: once per email, spendable at once. */
export function earnWelcomeCoins(db: Db, customer: Customer, at: number): void {
  const rule = db.rewardsSettings.earning.welcome;
  if (!db.rewardsSettings.enabled || !rule.enabled || rule.coins <= 0) return;
  writeRow(
    db,
    plain(
      "welcome",
      customer.id,
      rule.coins,
      `welcome:${customer.email.toLowerCase()}`,
      at,
    ),
    at,
  );
}

/** The goods paid for, after the code and the coins: what the order coins rest on (3). */
function goodsPaidOf(order: OrderRecord): number {
  const totals = order.finalTotals;
  return Math.max(0, totals.subtotal - totals.discount - totals.rewards);
}

/** A delivered order earns coins on the goods paid for; guests earn nothing. */
export function earnOrderCoins(db: Db, order: OrderRecord, at: number): void {
  const settings = db.rewardsSettings;
  const rule = settings.earning.order;
  if (!settings.enabled || !rule.enabled || order.isGuest) return;
  const rate = rule.coinsPerEuro * campaignMultiplier(settings, at);
  const coins = Math.round((goodsPaidOf(order) / 100) * rate);
  if (coins <= 0) return;
  writeRow(
    db,
    plain("order", order.customer.id, coins, `order:${order.id}`, at, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      rate,
    }),
    at,
  );
}

/** A published review earns once per review; a review gone again takes them back. */
export function earnReviewCoins(
  db: Db,
  review: { id: string; customerId: string },
  at: number,
): void {
  const rule = db.rewardsSettings.earning.review;
  if (!db.rewardsSettings.enabled || !rule.enabled || rule.coins <= 0) return;
  writeRow(
    db,
    plain("review", review.customerId, rule.coins, `review:${review.id}`, at, {
      reference: review.id,
    }),
    at,
  );
}

export function reverseReviewCoins(
  db: Db,
  review: { id: string; customerId: string },
  at: number,
): void {
  const earned = db.rewardTransactions.find(
    (row) => row.key === `review:${review.id}`,
  );
  if (!earned) return;
  writeRow(
    db,
    plain(
      "reversal",
      review.customerId,
      -earned.coins,
      `reversal:review:${review.id}`,
      at,
      { reference: review.id },
    ),
    at,
  );
}

/** A referral that qualified: the inviter, and the invitee when switched on. */
export function earnReferralCoins(
  db: Db,
  referral: { id: string; referrerId: string; referredId: string },
  at: number,
): void {
  const settings = db.rewardsSettings;
  if (!settings.enabled) return;
  const { inviter, invitee } = settings.earning.referral;
  if (inviter.enabled && inviter.coins > 0) {
    writeRow(
      db,
      plain(
        "referral_inviter",
        referral.referrerId,
        inviter.coins,
        `referral_inviter:${referral.id}`,
        at,
        { reference: referral.id },
      ),
      at,
    );
  }
  if (invitee.enabled && invitee.coins > 0) {
    writeRow(
      db,
      plain(
        "referral_invitee",
        referral.referredId,
        invitee.coins,
        `referral_invitee:${referral.id}`,
        at,
        { reference: referral.id },
      ),
      at,
    );
  }
}

// --- Redeeming (3) -----------------------------------------------------------

function discountFor(goods: number, coins: number, percent: number): number {
  return Math.round((goods * coins * percent) / 100);
}

/**
 * The coin discount spread over the lines in proportion to their value,
 * as the discount code is: the cents rounding leaves go to the largest
 * remainders.
 */
function rewardShares(
  items: Pick<OrderItem, "lineTotal">[],
  amount: number,
): number[] {
  const goods = items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (goods === 0 || amount === 0) return items.map(() => 0);
  const exact = items.map((item) => (amount * item.lineTotal) / goods);
  const shares = exact.map((value) => Math.floor(value));
  let left = amount - shares.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder);
  for (const entry of order) {
    if (left <= 0) break;
    shares[entry.index] = (shares[entry.index] ?? 0) + 1;
    left -= 1;
  }
  return shares;
}

/**
 * Checkout with coins: the most the bill allows, capped at what was asked,
 * lowered to the fewest coins that give the same cents, priced into the
 * lines and reserved on the account. Nothing happens when the rules refuse.
 */
export function redeemCoins(
  db: Db,
  order: OrderRecord,
  requested: number,
  customer: Customer,
  at: number,
): void {
  const settings = db.rewardsSettings;
  const rules = settings.redemption;
  if (!settings.enabled || !rules.enabled || order.isGuest) return;
  if (order.discount && !rules.combinableWithDiscountCodes) return;
  const account = accountOf(db, customer.id, at);
  const goods = order.items.reduce((sum, item) => sum + item.lineTotal, 0);
  if (rules.minOrderValue !== null && goods < rules.minOrderValue) return;
  if (rules.minCoins !== null && account.available < rules.minCoins) return;
  let coins = Math.min(requested, account.available);
  if (rules.maxCoinsPerOrder !== null)
    coins = Math.min(coins, rules.maxCoinsPerOrder);
  const percent = rules.percentPerCoin;
  const cap = Math.min(rules.maxDiscount ?? goods, goods);
  while (coins > 0 && discountFor(goods, coins, percent) > cap) coins -= 1;
  const amount = discountFor(goods, coins, percent);
  if (amount <= 0) return;
  if (rules.minRedeemValue !== null && amount < rules.minRedeemValue) return;
  while (coins > 1 && discountFor(goods, coins - 1, percent) === amount)
    coins -= 1;

  const shares = rewardShares(order.items, amount);
  order.items.forEach((item, index) => {
    item.rewardAmount = shares[index] ?? 0;
    item.lineTotal -= item.rewardAmount;
    item.finalLineTotal = item.lineTotal;
    item.vatAmount = vatOf(item.lineTotal, item.vatRate);
  });
  order.totals = totalsOf(
    order.items.map((item) => ({
      gross: item.lineTotal,
      vatRate: item.vatRate,
    })),
    order.totals.deliveryFee,
    order.totals.discount,
    amount,
  );
  order.finalTotals = order.totals;
  order.payment.amount = order.totals.total;
  order.rewards = { coins, amount, percentPerCoin: percent, state: "reserved" };
  writeRow(
    db,
    plain("redeem", customer.id, -coins, `redeem:${order.id}`, at, {
      state: "reserved",
      orderId: order.id,
      orderNumber: order.orderNumber,
    }),
    at,
  );
}

/** The payment spends the reserved coins; an order given up unpaid gives them back. */
export function settleRewards(
  db: Db,
  order: OrderRecord,
  outcome: "spent" | "released",
  at: number,
): void {
  if (!order.rewards || order.rewards.state !== "reserved") return;
  const row = db.rewardTransactions.find(
    (entry) => entry.key === `redeem:${order.id}`,
  );
  if (row) row.state = outcome;
  order.rewards.state = outcome === "spent" ? "used" : "released";
  syncAccount(db, order.customer.id, at);
}

/**
 * After a credit of goods (a return, a correction, a report): the coins
 * of the credited goods come back, and what the order earned shrinks to
 * what is paid now. Written once per reference; safe to call again.
 */
export function reconcileOrderRewards(
  db: Db,
  order: OrderRecord,
  reference: string,
  at: number,
): void {
  const customerId = order.customer.id;
  if (order.rewards && order.rewards.state === "used") {
    const unused = order.totals.rewards - order.finalTotals.rewards;
    const back = db.rewardTransactions
      .filter((row) => row.type === "redeem_return" && row.orderId === order.id)
      .reduce((sum, row) => sum + row.coins, 0);
    const owed =
      Math.min(
        order.rewards.coins,
        Math.round((order.rewards.coins * unused) / order.rewards.amount),
      ) - back;
    if (owed > 0) {
      writeRow(
        db,
        plain(
          "redeem_return",
          customerId,
          owed,
          `redeem_return:${order.id}:${reference}`,
          at,
          { orderId: order.id, orderNumber: order.orderNumber, reference },
        ),
        at,
      );
    }
  }
  const earnedRow = db.rewardTransactions.find(
    (row) => row.key === `order:${order.id}`,
  );
  if (earnedRow && earnedRow.rate !== null) {
    const earnedSoFar = db.rewardTransactions
      .filter(
        (row) =>
          (row.key === `order:${order.id}` ||
            row.key.startsWith(`reversal:order:${order.id}:`)) &&
          row.customerId === customerId,
      )
      .reduce((sum, row) => sum + row.coins, 0);
    const target = Math.round((goodsPaidOf(order) / 100) * earnedRow.rate);
    if (target < earnedSoFar) {
      writeRow(
        db,
        plain(
          "reversal",
          customerId,
          target - earnedSoFar,
          `reversal:order:${order.id}:${reference}`,
          at,
          { orderId: order.id, orderNumber: order.orderNumber, reference },
        ),
        at,
      );
    }
  }
}

// --- The summary (6) ---------------------------------------------------------

function summaryOf(db: Db, now: number): RewardsSummary {
  const since = iso(now - 30 * DAY);
  const recent = db.rewardTransactions.filter((row) => row.at >= since);
  const sum = (rows: RewardTransactionRecord[]) =>
    rows.reduce((total, row) => total + row.coins, 0);
  return {
    accounts: db.rewardAccounts.length,
    accountsWithBalance: db.rewardAccounts.filter(
      (account) => account.available > 0,
    ).length,
    coinsOutstanding: db.rewardAccounts.reduce(
      (total, account) => total + account.available,
      0,
    ),
    coinsReserved: db.rewardAccounts.reduce(
      (total, account) => total + account.reserved,
      0,
    ),
    last30Days: {
      earned: sum(
        recent.filter((row) => EARNING.includes(row.type) && row.coins > 0),
      ),
      redeemed: -sum(
        recent.filter((row) => row.type === "redeem" && row.state === "spent"),
      ),
      returned: sum(recent.filter((row) => row.type === "redeem_return")),
      reversed: -sum(recent.filter((row) => row.type === "reversal")),
      adjusted: sum(recent.filter((row) => row.type === "adjustment")),
      expired: -sum(recent.filter((row) => row.type === "expiry")),
      ordersWithCoins: recent.filter(
        (row) => row.type === "redeem" && row.state !== "released",
      ).length,
    },
  };
}

// --- Routes (6) ----------------------------------------------------------------

export function registerRewards(router: Router): void {
  const base = "/v1/admin/rewards";

  router.get(`${base}/settings`, { permission: "rewards.read" }, (ctx) =>
    json({ settings: ctx.db.rewardsSettings }),
  );
  router.put(
    `${base}/settings`,
    { permission: "rewards.manage" },
    async (ctx) => {
      const input = await ctx.body(rewardsSettingsBody);
      const { startsAt, endsAt } = input.earning.campaign;
      if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
        throw fail(
          400,
          "REWARDS_SETTINGS_INVALID",
          "The campaign ends before it starts.",
        );
      }
      ctx.db.rewardsSettings = input;
      for (const account of ctx.db.rewardAccounts)
        syncAccount(ctx.db, account.customerId, ctx.now);
      return json({ settings: ctx.db.rewardsSettings });
    },
  );

  router.get(`${base}/summary`, { permission: "rewards.read" }, (ctx) =>
    json(summaryOf(ctx.db, ctx.now)),
  );

  router.get(`${base}/accounts`, { permission: "rewards.read" }, (ctx) => {
    const customerId = idParam(ctx.query, "customerId");
    const withBalance = boolParam(ctx.query, "withBalance");
    const rows = ctx.db.rewardAccounts.filter(
      (account) =>
        (!customerId || account.customerId === customerId) &&
        (withBalance === undefined ||
          (withBalance ? account.available > 0 : account.available === 0)),
    );
    return json(
      sortedCursorPage(rows, ctx.query, {
        available: (account) => account.available,
        lastActivityAt: (account) => account.lastActivityAt ?? "",
        createdAt: (account) => account.createdAt,
      }),
    );
  });

  const transactionsOf = (db: Db, customerId: string) =>
    db.rewardTransactions
      .filter((row) => row.customerId === customerId)
      .sort((a, b) =>
        a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1,
      );

  router.get(
    `${base}/accounts/:customerId`,
    { permission: "rewards.read" },
    (ctx) => {
      const customerId = ctx.params.customerId ?? "";
      if (!ctx.db.customers.some((customer) => customer.id === customerId)) {
        throw fail(404, "CUSTOMER_NOT_FOUND", "The customer was not found.");
      }
      const account = accountOf(ctx.db, customerId, ctx.now);
      return json({
        account,
        transactions: transactionsOf(ctx.db, customerId).slice(0, 50),
      });
    },
  );

  router.post(
    `${base}/accounts/:customerId/adjust`,
    { permission: "rewards.manage" },
    async (ctx) => {
      const customerId = ctx.params.customerId ?? "";
      if (!ctx.db.customers.some((customer) => customer.id === customerId)) {
        throw fail(404, "CUSTOMER_NOT_FOUND", "The customer was not found.");
      }
      const input = await ctx.body(
        z.strictObject({
          coins: z.number().int().min(-1_000_000).max(1_000_000),
          reason: z.enum(REASONS),
          note: z.string().max(500).optional(),
        }),
      );
      if (input.coins === 0) {
        throw fail(
          400,
          "REWARDS_AMOUNT_INVALID",
          "An adjustment moves at least one coin.",
        );
      }
      const id = newId(ctx.now);
      const transaction = writeRow(
        ctx.db,
        plain(
          "adjustment",
          customerId,
          input.coins,
          `adjustment:${id}`,
          ctx.now,
          {
            id,
            reason: input.reason as RewardAdjustmentReason,
            note: input.note ?? null,
            adminId: ctx.admin.id,
          },
        ),
        ctx.now,
      );
      return json(
        { account: accountOf(ctx.db, customerId, ctx.now), transaction },
        201,
      );
    },
  );

  const filteredTransactions = (ctx: { db: Db; query: URLSearchParams }) => {
    const customerId = idParam(ctx.query, "customerId");
    const type = enumParam(ctx.query, "type", TYPES);
    const orderNumber = ctx.query.get("orderNumber");
    return ctx.db.rewardTransactions.filter(
      (row) =>
        (!customerId || row.customerId === customerId) &&
        (!type || row.type === type) &&
        (!orderNumber || row.orderNumber === orderNumber),
    );
  };
  router.get(
    `${base}/transactions/count`,
    { permission: "rewards.read" },
    (ctx) => json({ total: filteredTransactions(ctx).length }),
  );
  router.get(`${base}/transactions`, { permission: "rewards.read" }, (ctx) =>
    json(
      sortedCursorPage(filteredTransactions(ctx), ctx.query, {
        createdAt: (row) => row.at,
        type: (row) => row.type,
      }),
    ),
  );
}

// --- Demo data -----------------------------------------------------------------

/**
 * The rules of the demo, set before the orders are placed so that the
 * deliveries earn coins as the seed walks them, and the welcome coins of
 * every registered customer, spendable on their orders.
 */
export function seedRewardsStart(
  db: Db,
  customers: Customer[],
  now: number,
): void {
  db.rewardsSettings = {
    enabled: true,
    earning: {
      order: { enabled: true, coinsPerEuro: 1 },
      welcome: { enabled: true, coins: 100 },
      referral: {
        inviter: { enabled: true, coins: 100 },
        invitee: { enabled: false, coins: 50 },
      },
      review: { enabled: true, coins: 25 },
      campaign: {
        enabled: false,
        multiplier: 2,
        startsAt: null,
        endsAt: null,
        name: null,
      },
    },
    redemption: {
      enabled: true,
      percentPerCoin: 0.01,
      minCoins: null,
      minRedeemValue: null,
      minOrderValue: null,
      maxCoinsPerOrder: null,
      maxDiscount: 500,
      combinableWithDiscountCodes: true,
    },
    expiry: { enabled: false, inactivityMonths: 12 },
  };
  for (const customer of customers) {
    earnWelcomeCoins(
      db,
      customer,
      Math.min(Date.parse(customer.createdAt), now - 60 * DAY),
    );
  }
}

/**
 * After the reviews and referrals exist: their coins, one adjustment by
 * hand, and the coins back for goods credited after a delivery.
 */
export function seedRewardsFinish(
  db: Db,
  owner: AdminRecord,
  now: number,
): void {
  for (const review of db.reviews) {
    if (review.status === "published" && review.publishedAt) {
      earnReviewCoins(db, review, Date.parse(review.publishedAt));
    }
  }
  for (const referral of db.referrals) {
    if (referral.status === "qualified" && referral.qualifiedAt) {
      earnReferralCoins(db, referral, Date.parse(referral.qualifiedAt));
    }
  }
  for (const order of db.orders) {
    if (order.payment.creditedAmount > 0) {
      reconcileOrderRewards(db, order, "seed", Date.parse(order.updatedAt));
    }
  }
  const generous = db.rewardAccounts
    .filter((account) => account.available > 0)
    .sort((a, b) => b.available - a.available)[0];
  if (generous) {
    const at = now - 6 * DAY;
    writeRow(
      db,
      plain(
        "adjustment",
        generous.customerId,
        50,
        `adjustment:${newId(at)}`,
        at,
        {
          reason: "goodwill",
          note: "A late delivery in October; the customer was very patient.",
          adminId: owner.id,
        },
      ),
      at,
    );
  }
}
