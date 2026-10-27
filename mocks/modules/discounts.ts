// Section 26: discount codes of the retail shop. doc/DISCOUNT_CODES.md.
// The codes, their uses by orders, the arithmetic that spreads a discount
// over the lines of an order, and the admin routes.

import { z } from "zod";
import type {
  DiscountCode,
  DiscountState,
  DiscountType,
  DiscountUse,
  DiscountUseState,
  OrderItem,
} from "../../src/lib/api/types/index.ts";
import type { AdminRecord, Db, OrderRecord } from "../db.ts";
import {
  enumParam,
  fail,
  json,
  newId,
  noContent,
  page,
  searchParam,
} from "../http.ts";
import type { Router } from "../router.ts";
import { DAY, iso } from "../time.ts";

export interface DiscountCodeRecord {
  id: string;
  code: string;
  note: string | null;
  type: DiscountType;
  value: number;
  appliesToSaleItems: boolean;
  minOrderValue: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  oncePerCustomer: boolean;
  isActive: boolean;
  usedCount: number;
  reservedCount: number;
  /** The admin who created it. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

/** One order made with a code. */
export interface DiscountUseRecord {
  id: string;
  codeId: string;
  code: string;
  customerId: string;
  customerEmail: string;
  orderId: string;
  orderNumber: string;
  amount: number;
  state: DiscountUseState;
  /** True while reserved or used. */
  counts: boolean;
  perCustomer: boolean;
  at: string;
  settledAt: string | null;
}

const CODE = /^[A-Z0-9](?:[A-Z0-9-]{2,18})[A-Z0-9]$/;
const GENERATED_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

// --- Views ------------------------------------------------------------------------

/** Derived in this order: switched off, before the start, after the end, used up, active. */
export function discountState(
  record: DiscountCodeRecord,
  now: number,
): DiscountState {
  if (!record.isActive) return "inactive";
  if (record.startsAt && Date.parse(record.startsAt) > now) return "scheduled";
  if (record.expiresAt && Date.parse(record.expiresAt) <= now) return "expired";
  if (
    record.maxUses !== null &&
    record.usedCount + record.reservedCount >= record.maxUses
  ) {
    return "exhausted";
  }
  return "active";
}

export function discountView(
  db: Db,
  record: DiscountCodeRecord,
  now: number,
): DiscountCode {
  const admin = db.admins.find((entry) => entry.id === record.createdBy);
  return {
    id: record.id,
    code: record.code,
    note: record.note,
    type: record.type,
    value: record.value,
    appliesToSaleItems: record.appliesToSaleItems,
    minOrderValue: record.minOrderValue,
    startsAt: record.startsAt,
    expiresAt: record.expiresAt,
    maxUses: record.maxUses,
    oncePerCustomer: record.oncePerCustomer,
    isActive: record.isActive,
    usedCount: record.usedCount,
    reservedCount: record.reservedCount,
    remainingUses:
      record.maxUses === null
        ? null
        : Math.max(0, record.maxUses - record.usedCount - record.reservedCount),
    state: discountState(record, now),
    createdBy: admin ? { id: admin.id, name: admin.name } : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function useView(record: DiscountUseRecord): DiscountUse {
  return {
    id: record.id,
    orderId: record.orderId,
    orderNumber: record.orderNumber,
    customer: { id: record.customerId, email: record.customerEmail },
    amount: record.amount,
    state: record.state,
    at: record.at,
    settledAt: record.settledAt,
  };
}

function discountById(db: Db, id: string): DiscountCodeRecord {
  const found = db.discountCodes.find((entry) => entry.id === id);
  if (!found) throw fail(404, "DISCOUNT_NOT_FOUND", "Discount code not found.");
  return found;
}

const inUse = (record: DiscountCodeRecord) =>
  record.usedCount + record.reservedCount > 0;

function inUseError(record: DiscountCodeRecord) {
  return fail(
    409,
    "DISCOUNT_IN_USE",
    "Orders were made with this code; it keeps its text and cannot be deleted.",
    { usedCount: record.usedCount, reservedCount: record.reservedCount },
  );
}

// --- The arithmetic (section 3) --------------------------------------------------------

/**
 * The discount of some lines: the amount, and each line's share in
 * proportion to its value, rounded down with the cents left over going to
 * the largest remainders. A line on sale is left out when the code says so.
 */
export function discountShares(
  items: Pick<OrderItem, "lineTotal" | "regularUnitPrice" | "unitPrice">[],
  code: Pick<DiscountCodeRecord, "type" | "value" | "appliesToSaleItems">,
): { amount: number; shares: number[] } {
  const eligible = items.map(
    (item) =>
      code.appliesToSaleItems ||
      item.regularUnitPrice === null ||
      item.regularUnitPrice === item.unitPrice,
  );
  const goods = items.reduce(
    (sum, item, index) => sum + (eligible[index] ? item.lineTotal : 0),
    0,
  );
  const amount =
    goods === 0
      ? 0
      : code.type === "percent"
        ? Math.round((goods * code.value) / 100)
        : Math.min(code.value, goods);
  const exact = items.map((item, index) =>
    eligible[index] && goods > 0 ? (amount * item.lineTotal) / goods : 0,
  );
  const shares = exact.map((value) => Math.floor(value));
  let left = amount - shares.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .filter((entry) => eligible[entry.index])
    .sort((a, b) => b.remainder - a.remainder);
  for (const entry of order) {
    if (left <= 0) break;
    shares[entry.index] = (shares[entry.index] ?? 0) + 1;
    left -= 1;
  }
  return { amount, shares };
}

/** The part of a line's discount that belongs to `units` of its `quantity`. */
export function discountOfUnits(
  item: Pick<OrderItem, "discountAmount" | "quantity">,
  units: number,
): number {
  if (item.quantity === 0) return 0;
  return Math.round((item.discountAmount * units) / item.quantity);
}

// --- Uses by orders ------------------------------------------------------------------

/**
 * Checkout: the order is made with the code, one use is reserved. The
 * order's lines carry their shares already (`discountShares`).
 */
export function reserveDiscountUse(
  db: Db,
  order: OrderRecord,
  code: DiscountCodeRecord,
  amount: number,
  now: number,
): void {
  code.reservedCount += 1;
  code.updatedAt = iso(now);
  db.discountUses.push({
    id: newId(now),
    codeId: code.id,
    code: code.code,
    customerId: order.customer.id,
    customerEmail: order.customer.email,
    orderId: order.id,
    orderNumber: order.orderNumber,
    amount,
    state: "reserved",
    counts: true,
    perCustomer: code.oncePerCustomer,
    at: iso(now),
    settledAt: null,
  });
  order.discount = {
    code: code.code,
    type: code.type,
    value: code.value,
    amount,
    state: "reserved",
  };
}

/** The payment counts the use (`used`); an order given up unpaid gives it back (`released`). */
export function settleDiscountUse(
  db: Db,
  order: OrderRecord,
  state: "used" | "released",
  now: number,
): void {
  const use = db.discountUses.find(
    (entry) => entry.orderId === order.id && entry.state === "reserved",
  );
  if (!use) return;
  use.state = state;
  use.counts = state === "used";
  use.settledAt = iso(now);
  const code = db.discountCodes.find((entry) => entry.id === use.codeId);
  if (code) {
    code.reservedCount = Math.max(0, code.reservedCount - 1);
    if (state === "used") code.usedCount += 1;
    code.updatedAt = iso(now);
  }
  if (order.discount) order.discount = { ...order.discount, state };
}

// --- Routes ------------------------------------------------------------------------

const zInstant = z.iso.datetime({ offset: true });
const zCode = z
  .string()
  .trim()
  .min(4)
  .max(20)
  .transform((value) => value.toUpperCase())
  .refine((value) => CODE.test(value), {
    message:
      "code must be 4 to 20 letters, digits and hyphens, starting and ending with a letter or digit",
  });

const zCreate = z.strictObject({
  code: zCode.optional(),
  note: z.string().max(200).optional(),
  type: z.enum(["percent", "fixed"]),
  value: z.number().int().min(1).max(1_000_000),
  appliesToSaleItems: z.boolean().optional(),
  minOrderValue: z.number().int().min(1).max(10_000_000).nullable().optional(),
  startsAt: zInstant.nullable().optional(),
  expiresAt: zInstant.nullable().optional(),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().optional(),
  oncePerCustomer: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const zPatch = zCreate.partial();

const utc = (value: string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

function assertRules(
  type: DiscountType,
  value: number,
  startsAt: string | null,
  expiresAt: string | null,
): void {
  if (type === "percent" && value > 100) {
    throw fail(400, "DISCOUNT_VALUE_INVALID", "A percentage is at most 100.");
  }
  if (startsAt && expiresAt && Date.parse(expiresAt) <= Date.parse(startsAt)) {
    throw fail(
      400,
      "DISCOUNT_SCHEDULE_INVALID",
      "expiresAt must come after startsAt.",
    );
  }
}

function assertFree(db: Db, code: string, except?: string): void {
  if (
    db.discountCodes.some((entry) => entry.code === code && entry.id !== except)
  ) {
    throw fail(409, "DISCOUNT_CODE_TAKEN", "This code exists already.");
  }
}

/** Eight characters of `A–Z 2–9` without `I` and `O`, not taken yet. */
export function generateCode(
  db: Db,
  random: () => number = Math.random,
): string {
  for (;;) {
    let code = "";
    for (let index = 0; index < 8; index += 1) {
      code +=
        GENERATED_ALPHABET[Math.floor(random() * GENERATED_ALPHABET.length)];
    }
    if (!db.discountCodes.some((entry) => entry.code === code)) return code;
  }
}

export function registerDiscounts(router: Router): void {
  const base = "/v1/admin/discounts";
  const STATES: readonly DiscountState[] = [
    "active",
    "inactive",
    "scheduled",
    "expired",
    "exhausted",
  ];

  router.get(base, { permission: "discounts.read" }, (ctx) => {
    const q = searchParam(ctx.query)?.toLowerCase();
    const status = enumParam(ctx.query, "status", STATES);
    const rows = [...ctx.db.discountCodes]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .filter(
        (entry) =>
          !q ||
          entry.code.toLowerCase().includes(q) ||
          (entry.note ?? "").toLowerCase().includes(q),
      )
      .map((entry) => discountView(ctx.db, entry, ctx.now))
      .filter((entry) => !status || entry.state === status);
    return json(page(rows, ctx.query, 24));
  });

  router.post(base, { permission: "discounts.manage" }, async (ctx) => {
    const input = await ctx.body(zCreate);
    const startsAt = utc(input.startsAt);
    const expiresAt = utc(input.expiresAt);
    assertRules(input.type, input.value, startsAt, expiresAt);
    const code = input.code ?? generateCode(ctx.db);
    assertFree(ctx.db, code);
    const record: DiscountCodeRecord = {
      id: newId(ctx.now),
      code,
      note: input.note?.trim() || null,
      type: input.type,
      value: input.value,
      appliesToSaleItems: input.appliesToSaleItems ?? true,
      minOrderValue: input.minOrderValue ?? null,
      startsAt,
      expiresAt,
      maxUses: input.maxUses ?? null,
      oncePerCustomer: input.oncePerCustomer ?? false,
      isActive: input.isActive ?? true,
      usedCount: 0,
      reservedCount: 0,
      createdBy: ctx.admin.id,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.discountCodes.push(record);
    return json({ discount: discountView(ctx.db, record, ctx.now) }, 201);
  });

  router.get(`${base}/:id`, { permission: "discounts.read" }, (ctx) =>
    json({
      discount: discountView(
        ctx.db,
        discountById(ctx.db, ctx.params.id ?? ""),
        ctx.now,
      ),
    }),
  );

  router.patch(
    `${base}/:id`,
    { permission: "discounts.manage" },
    async (ctx) => {
      const input = await ctx.body(zPatch);
      const record = discountById(ctx.db, ctx.params.id ?? "");
      const type = input.type ?? record.type;
      const value = input.value ?? record.value;
      const startsAt =
        input.startsAt === undefined ? record.startsAt : utc(input.startsAt);
      const expiresAt =
        input.expiresAt === undefined ? record.expiresAt : utc(input.expiresAt);
      assertRules(type, value, startsAt, expiresAt);
      if (input.code !== undefined && input.code !== record.code) {
        if (inUse(record)) throw inUseError(record);
        assertFree(ctx.db, input.code, record.id);
        record.code = input.code;
      }
      if (input.note !== undefined) record.note = input.note.trim() || null;
      record.type = type;
      record.value = value;
      if (input.appliesToSaleItems !== undefined) {
        record.appliesToSaleItems = input.appliesToSaleItems;
      }
      if (input.minOrderValue !== undefined) {
        record.minOrderValue = input.minOrderValue;
      }
      record.startsAt = startsAt;
      record.expiresAt = expiresAt;
      if (input.maxUses !== undefined) record.maxUses = input.maxUses;
      if (input.oncePerCustomer !== undefined) {
        record.oncePerCustomer = input.oncePerCustomer;
      }
      if (input.isActive !== undefined) record.isActive = input.isActive;
      record.updatedAt = iso(ctx.now);
      return json({ discount: discountView(ctx.db, record, ctx.now) });
    },
  );

  router.delete(`${base}/:id`, { permission: "discounts.manage" }, (ctx) => {
    const record = discountById(ctx.db, ctx.params.id ?? "");
    if (inUse(record)) throw inUseError(record);
    ctx.db.discountCodes = ctx.db.discountCodes.filter(
      (entry) => entry !== record,
    );
    return noContent();
  });

  router.get(`${base}/:id/uses`, { permission: "discounts.read" }, (ctx) => {
    const record = discountById(ctx.db, ctx.params.id ?? "");
    const rows = ctx.db.discountUses
      .filter((entry) => entry.codeId === record.id)
      .sort((a, b) => b.at.localeCompare(a.at))
      .map(useView);
    return json(page(rows, ctx.query, 24));
  });
}

// --- Demo data -------------------------------------------------------------------

/**
 * The codes of the demo, made before the orders so that some orders can
 * be placed with them. Their counts follow from the orders.
 */
export interface DemoDiscountCodes {
  spring: DiscountCodeRecord;
  earlyBird: DiscountCodeRecord;
  welcome: DiscountCodeRecord;
  diwali: DiscountCodeRecord;
  staff: DiscountCodeRecord;
  xmas: DiscountCodeRecord;
}

export function seedDiscountCodes(
  db: Db,
  now: number,
  admin: AdminRecord,
): DemoDiscountCodes {
  const long = now - 60 * DAY;
  let at = long;
  const make = (
    code: string,
    input: Partial<DiscountCodeRecord> &
      Pick<DiscountCodeRecord, "type" | "value">,
  ): DiscountCodeRecord => {
    at += 3 * DAY;
    const record: DiscountCodeRecord = {
      id: newId(at),
      code,
      note: null,
      appliesToSaleItems: true,
      minOrderValue: null,
      startsAt: null,
      expiresAt: null,
      maxUses: null,
      oncePerCustomer: false,
      isActive: true,
      usedCount: 0,
      reservedCount: 0,
      createdBy: admin.id,
      createdAt: iso(at),
      updatedAt: iso(at),
      ...input,
    };
    db.discountCodes.push(record);
    return record;
  };
  return {
    spring: make("SPRING15", {
      type: "percent",
      value: 15,
      note: "Spring sale on the homepage",
      expiresAt: iso(now - 30 * DAY),
    }),
    earlyBird: make("EARLYBIRD", {
      type: "percent",
      value: 12,
      note: "First three orders of the new range",
      maxUses: 3,
    }),
    welcome: make("WELCOME5", {
      type: "fixed",
      value: 500,
      note: "Sign-up email",
      minOrderValue: 2500,
      oncePerCustomer: true,
    }),
    diwali: make("DIWALI10", {
      type: "percent",
      value: 10,
      note: "Diwali newsletter",
      maxUses: 100,
      oncePerCustomer: true,
      expiresAt: iso(now + 20 * DAY),
    }),
    staff: make("STAFF50", {
      type: "percent",
      value: 50,
      note: "Family and staff; switched off outside the test week",
      appliesToSaleItems: false,
      isActive: false,
    }),
    xmas: make("XMAS20", {
      type: "percent",
      value: 20,
      note: "Christmas campaign",
      startsAt: iso(now + 30 * DAY),
      expiresAt: iso(now + 60 * DAY),
      maxUses: 50,
    }),
  };
}
