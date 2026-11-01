// Sections 27 (referrals), 28 (product reviews) and 29 (problem reports),
// with the guests and closed accounts of section 4 that they rest on.
// doc/CUSTOMER_ACCOUNTS.md has the long version.

import { z } from "zod";
import type {
  Customer,
  CustomerRef,
  Issue,
  IssueImage,
  IssueProblem,
  IssueResolution,
  IssueStatus,
  Referral,
  Review,
  ReviewStatus,
} from "../../src/lib/api/types/index.ts";
import type { AdminRecord, Db, OrderRecord } from "../db.ts";
import { issueCreditNote, recomputeFinal } from "../domain.ts";
import {
  enumParam,
  fail,
  idParam,
  json,
  newId,
  noContent,
  sortedCursorPage,
  zId,
} from "../http.ts";
import type { Router } from "../router.ts";
import { DAY, HOUR, iso } from "../time.ts";
import { releaseUnits } from "./stock.ts";

/** The referral as stored: the two customers are named on reading (0.9). */
export type ReferralRecord = Omit<Referral, "referrer" | "referred">;
/** The review as stored: the customer is named on reading. */
export type ReviewRecord = Omit<Review, "customer">;
/** The report as stored: the customer is named on reading. */
export type IssueRecord = Omit<Issue, "customer">;

export const DELETED_NAME = "Deleted account";

/**
 * A customer next to an id (0.9, 4): the name and email, or the words of a
 * closed account with no email.
 */
export function customerRef(db: Db, id: string): CustomerRef | null {
  const found = db.customers.find((customer) => customer.id === id);
  if (!found) return null;
  if (found.status === "deleted") {
    return { id: found.id, name: DELETED_NAME, email: null, deleted: true };
  }
  const name = [found.firstName, found.lastName]
    .filter((part) => part && part.trim() !== "")
    .join(" ");
  return { id: found.id, name: name || null, email: found.email };
}

const REFERRAL_STATUSES = ["registered", "qualified", "void"] as const;
const REVIEW_STATUSES = ["pending", "published", "rejected"] as const;
const ISSUE_STATUSES = [
  "open",
  "in_review",
  "resolved",
  "rejected",
  "cancelled",
] as const;

function referralView(db: Db, record: ReferralRecord): Referral {
  return {
    ...record,
    referrer: customerRef(db, record.referrerId),
    referred: customerRef(db, record.referredId),
  };
}

function reviewById(db: Db, id: string): ReviewRecord {
  const found = db.reviews.find((entry) => entry.id === id);
  if (!found) throw fail(404, "REVIEW_NOT_FOUND", "The review was not found.");
  return found;
}

function issueById(db: Db, id: string): IssueRecord {
  const found = db.issues.find((entry) => entry.id === id);
  if (!found)
    throw fail(404, "ISSUE_NOT_FOUND", "The problem report was not found.");
  return found;
}

function moveIssue(
  record: IssueRecord,
  to: IssueStatus,
  allowedFrom: IssueStatus[],
  adminId: string | null,
  note: string | null,
  now: number,
): void {
  if (!allowedFrom.includes(record.status)) {
    throw fail(
      409,
      "ISSUE_TRANSITION_NOT_ALLOWED",
      "This change of status is not allowed.",
      { from: record.status, to },
    );
  }
  record.statusHistory.push({
    from: record.status,
    to,
    at: iso(now),
    by: adminId ? "admin" : "customer",
    adminId,
    note,
  });
  record.status = to;
  record.updatedAt = iso(now);
}

/** The reason of the correction, from the problems (29). */
function adjustmentReason(
  problems: IssueProblem[],
): "missing" | "wrong_item" | "damaged" | "customer_complaint" {
  for (const reason of ["missing", "wrong_item", "damaged"] as const) {
    if (problems.includes(reason)) return reason;
  }
  return "customer_complaint";
}

/**
 * A refund resolution (29): the units come off the delivered quantity of
 * the order, as a correction with the note "Problem report RF-1084-P1";
 * the credit note follows and the money waits in the refund queue.
 * Answers the cents credited.
 */
export function applyIssueRefund(
  db: Db,
  record: IssueRecord,
  order: OrderRecord,
  quantities: Map<string, number>,
  adminId: string,
  now: number,
): number {
  const before = order.finalTotals.total;
  const reason = adjustmentReason(record.problems);
  for (const item of record.items) {
    const units = quantities.get(item.variantId) ?? 0;
    if (units <= 0) continue;
    const line = order.items.find(
      (entry) => entry.variantId === item.variantId,
    );
    if (!line) {
      throw fail(
        400,
        "ORDER_ITEM_NOT_FOUND",
        "The order has no such pack size.",
        { variantId: item.variantId },
      );
    }
    if (units > line.deliveredQuantity - line.returnedQuantity) {
      throw fail(
        400,
        "ISSUE_QUANTITY_INVALID",
        "More units than were delivered and kept.",
        { variantId: item.variantId, max: line.deliveredQuantity },
      );
    }
    const from = line.deliveredQuantity;
    line.deliveredQuantity -= units;
    item.refundedQuantity = units;
    order.adjustments.push({
      productId: line.productId,
      variantId: line.variantId,
      sku: line.sku,
      from,
      to: line.deliveredQuantity,
      reason,
      note: `Problem report ${record.issueNumber}`,
      adminId,
      at: iso(now),
    });
    releaseUnits(db, order, line.variantId, units, now);
  }
  recomputeFinal(order);
  order.updatedAt = iso(now);
  const credited = before - order.finalTotals.total;
  if (credited > 0) {
    issueCreditNote(db, order, credited, "adjustment", now, record.issueNumber);
  }
  return credited;
}

export function registerAccounts(router: Router): void {
  // --- Referrals (27) -------------------------------------------------------
  const referrals = "/v1/admin/referrals";
  const filteredReferrals = (ctx: { db: Db; query: URLSearchParams }) => {
    const status = enumParam(ctx.query, "status", REFERRAL_STATUSES);
    const referrerId = idParam(ctx.query, "referrerId");
    const referredId = idParam(ctx.query, "referredId");
    return ctx.db.referrals.filter(
      (entry) =>
        (!status || entry.status === status) &&
        (!referrerId || entry.referrerId === referrerId) &&
        (!referredId || entry.referredId === referredId),
    );
  };

  router.get(`${referrals}/count`, { permission: "customers.read" }, (ctx) =>
    json({ total: filteredReferrals(ctx).length }),
  );
  router.get(referrals, { permission: "customers.read" }, (ctx) => {
    const page = sortedCursorPage(filteredReferrals(ctx), ctx.query, {
      createdAt: (entry) => entry.registeredAt,
      status: (entry) => entry.status,
    });
    return json({
      ...page,
      items: page.items.map((entry) => referralView(ctx.db, entry)),
    });
  });

  // --- Reviews (28) ---------------------------------------------------------
  const reviews = "/v1/admin/reviews";
  const filteredReviews = (ctx: { db: Db; query: URLSearchParams }) => {
    const status = enumParam(ctx.query, "status", REVIEW_STATUSES);
    const productId = idParam(ctx.query, "productId");
    const customerId = idParam(ctx.query, "customerId");
    const rating = ctx.query.get("rating");
    return ctx.db.reviews.filter(
      (entry) =>
        (!status || entry.status === status) &&
        (!productId || entry.productId === productId) &&
        (!customerId || entry.customerId === customerId) &&
        (!rating || entry.rating === Number(rating)),
    );
  };

  router.get(`${reviews}/count`, { permission: "reviews.read" }, (ctx) =>
    json({ total: filteredReviews(ctx).length }),
  );
  router.get(reviews, { permission: "reviews.read" }, (ctx) =>
    json(
      sortedCursorPage(filteredReviews(ctx), ctx.query, {
        createdAt: (entry) => entry.writtenAt,
        status: (entry) => entry.status,
        rating: (entry) => entry.rating,
      }),
    ),
  );
  router.get(`${reviews}/:id`, { permission: "reviews.read" }, (ctx) =>
    json({ review: reviewById(ctx.db, ctx.params.id ?? "") }),
  );
  router.post(
    `${reviews}/:id/approve`,
    { permission: "reviews.manage" },
    (ctx) => {
      const review = reviewById(ctx.db, ctx.params.id ?? "");
      review.status = "published";
      review.publishedAt = review.publishedAt ?? iso(ctx.now);
      review.moderation = {
        adminId: ctx.admin.id,
        at: iso(ctx.now),
        note: null,
      };
      review.updatedAt = iso(ctx.now);
      return json({ review });
    },
  );
  router.post(
    `${reviews}/:id/reject`,
    { permission: "reviews.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({ note: z.string().min(1).max(1000) }),
      );
      const review = reviewById(ctx.db, ctx.params.id ?? "");
      review.status = "rejected";
      review.publishedAt = null;
      review.moderation = {
        adminId: ctx.admin.id,
        at: iso(ctx.now),
        note: input.note,
      };
      review.updatedAt = iso(ctx.now);
      return json({ review });
    },
  );
  router.post(
    `${reviews}/:id/reply`,
    { permission: "reviews.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({ text: z.string().min(1).max(2000) }),
      );
      const review = reviewById(ctx.db, ctx.params.id ?? "");
      review.reply = {
        text: input.text,
        adminId: ctx.admin.id,
        at: iso(ctx.now),
      };
      review.updatedAt = iso(ctx.now);
      return json({ review });
    },
  );
  router.delete(
    `${reviews}/:id/reply`,
    { permission: "reviews.manage" },
    (ctx) => {
      const review = reviewById(ctx.db, ctx.params.id ?? "");
      review.reply = null;
      review.updatedAt = iso(ctx.now);
      return json({ review });
    },
  );
  router.delete(`${reviews}/:id`, { permission: "reviews.manage" }, (ctx) => {
    const review = reviewById(ctx.db, ctx.params.id ?? "");
    ctx.db.reviews = ctx.db.reviews.filter((entry) => entry.id !== review.id);
    return noContent();
  });

  // --- Problem reports (29) -------------------------------------------------
  const issues = "/v1/admin/issues";
  const filteredIssues = (ctx: { db: Db; query: URLSearchParams }) => {
    const status = enumParam(ctx.query, "status", ISSUE_STATUSES);
    const customerId = idParam(ctx.query, "customerId");
    const orderNumber = ctx.query.get("orderNumber")?.trim().toUpperCase();
    return ctx.db.issues.filter(
      (entry) =>
        (!status || entry.status === status) &&
        (!customerId || entry.customerId === customerId) &&
        (!orderNumber || entry.orderNumber === orderNumber),
    );
  };

  router.get(`${issues}/count`, { permission: "orders.read" }, (ctx) =>
    json({ total: filteredIssues(ctx).length }),
  );
  router.get(issues, { permission: "orders.read" }, (ctx) =>
    json(
      sortedCursorPage(filteredIssues(ctx), ctx.query, {
        createdAt: (entry) => entry.reportedAt,
        status: (entry) => entry.status,
      }),
    ),
  );
  router.get(`${issues}/:id`, { permission: "orders.read" }, (ctx) =>
    json({ issue: issueById(ctx.db, ctx.params.id ?? "") }),
  );

  const notes = {
    note: z.string().max(1000).optional(),
    internalNote: z.string().max(2000).optional(),
  };

  router.post(
    `${issues}/:id/review`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(z.strictObject(notes));
      const issue = issueById(ctx.db, ctx.params.id ?? "");
      if (issue.status === "in_review") return json({ issue });
      moveIssue(
        issue,
        "in_review",
        ["open"],
        ctx.admin.id,
        input.note ?? null,
        ctx.now,
      );
      if (input.internalNote !== undefined)
        issue.internalNote = input.internalNote;
      return json({ issue });
    },
  );

  router.post(
    `${issues}/:id/resolve`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          resolution: z.enum(["refund", "replacement", "none"]),
          items: z
            .array(
              z.strictObject({
                variantId: zId,
                quantity: z.number().int().min(0).max(10000),
              }),
            )
            .optional(),
          ...notes,
        }),
      );
      const issue = issueById(ctx.db, ctx.params.id ?? "");
      if (issue.status === "resolved") return json({ issue });
      if (issue.status !== "in_review") {
        throw fail(
          409,
          "ISSUE_TRANSITION_NOT_ALLOWED",
          "Only a report in review can be resolved.",
          { from: issue.status, to: "resolved" },
        );
      }
      let amount: number | null = null;
      if (input.resolution === "refund") {
        const quantities = new Map(
          issue.items.map((item) => [item.variantId, item.quantity]),
        );
        if (input.items) {
          for (const item of input.items) {
            const reported = quantities.get(item.variantId);
            if (reported === undefined) {
              throw fail(
                400,
                "ORDER_ITEM_NOT_FOUND",
                "The report has no such pack size.",
                { variantId: item.variantId },
              );
            }
            if (item.quantity > reported) {
              throw fail(
                400,
                "ISSUE_QUANTITY_INVALID",
                "More than the customer reported.",
                { variantId: item.variantId, max: reported },
              );
            }
            quantities.set(item.variantId, item.quantity);
          }
        }
        if ([...quantities.values()].every((quantity) => quantity === 0)) {
          throw fail(
            400,
            "ISSUE_QUANTITY_INVALID",
            "Nothing to refund. Settle the report with a note instead.",
          );
        }
        const order = ctx.db.orders.find((entry) => entry.id === issue.orderId);
        if (!order)
          throw fail(404, "ORDER_NOT_FOUND", "The order was not found.");
        amount = applyIssueRefund(
          ctx.db,
          issue,
          order,
          quantities,
          ctx.admin.id,
          ctx.now,
        );
      }
      moveIssue(
        issue,
        "resolved",
        ["in_review"],
        ctx.admin.id,
        input.note ?? null,
        ctx.now,
      );
      issue.decidedAt = iso(ctx.now);
      issue.resolution = {
        type: input.resolution,
        amount,
        note: input.note ?? null,
        adminId: ctx.admin.id,
        at: iso(ctx.now),
      };
      if (input.internalNote !== undefined)
        issue.internalNote = input.internalNote;
      return json({ issue });
    },
  );

  router.post(
    `${issues}/:id/reject`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          note: z.string().min(1).max(1000),
          internalNote: notes.internalNote,
        }),
      );
      const issue = issueById(ctx.db, ctx.params.id ?? "");
      if (issue.status === "rejected") return json({ issue });
      moveIssue(
        issue,
        "rejected",
        ["in_review"],
        ctx.admin.id,
        input.note,
        ctx.now,
      );
      issue.decidedAt = iso(ctx.now);
      if (input.internalNote !== undefined)
        issue.internalNote = input.internalNote;
      return json({ issue });
    },
  );
}

/** The two groups of the attention overview (15). */
export function accountsAttention(db: Db): {
  issues: { open: number; items: IssueRecord[] };
  reviews: { pending: number };
} {
  const open = db.issues
    .filter((entry) => entry.status === "open")
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  return {
    issues: { open: open.length, items: open.slice(0, 5) },
    reviews: {
      pending: db.reviews.filter((entry) => entry.status === "pending").length,
    },
  };
}

// --- The demo data ------------------------------------------------------------

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** A referral code of 8 characters (27); without I and O, which read as digits. */
export function referralCode(seed: number): string {
  let state = seed | 0;
  let code = "";
  for (let index = 0; index < 8; index += 1) {
    state = (Math.imul(state, 1103515245) + 12345) | 0;
    code += CODE_ALPHABET[(state >>> 16) % CODE_ALPHABET.length];
  }
  return code;
}

/** "Priya S.": the name the shop shows under a review. */
export function authorName(customer: Customer): string {
  const first = customer.firstName?.trim() || "Customer";
  const initial = customer.lastName?.trim()?.[0];
  return initial ? `${first} ${initial.toUpperCase()}.` : first;
}

/** A customer's photo for a report: the placeholder route draws it. */
function issuePhoto(
  publicUrl: string,
  at: number,
  hue: number,
  label: string,
): IssueImage {
  const url = (size: number) =>
    `${publicUrl}/media/placeholder/${hue}/${size}/${encodeURIComponent(label)}.svg`;
  return {
    id: newId(at),
    url: url(1600),
    sizes: {
      small: { url: url(320), width: 320, height: 320 },
      medium: { url: url(800), width: 800, height: 800 },
      large: { url: url(1600), width: 1600, height: 1600 },
    },
  };
}

/** Closes an account the way `POST /v1/store/me/delete` does (3). */
export function closeAccount(db: Db, customer: Customer, at: number): void {
  customer.status = "deleted";
  customer.deletedAt = iso(at);
  customer.email = `deleted:${customer.id}`;
  customer.firstName = null;
  customer.lastName = null;
  customer.phone = null;
  customer.addresses = [];
  customer.referralCode = null;
  customer.lastLoginAt = null;
  customer.communication = {
    whatsappNumber: null,
    whatsappOptIn: false,
    whatsappOptInAt: null,
    marketingOptIn: false,
    marketingOptInAt: null,
    marketingOptOutAt: null,
  };
  customer.updatedAt = iso(at);
  // The records that name the customer point at the anonymised account (4).
  for (const order of db.orders) {
    if (order.customer.id !== customer.id) continue;
    order.customer = {
      id: customer.id,
      email: null,
      name: DELETED_NAME,
      deleted: true,
    };
  }
  for (const use of db.discountUses) {
    if (use.customerId === customer.id)
      use.customerEmail = `deleted:${customer.id}`;
  }
  db.reviews = db.reviews.filter((entry) => entry.customerId !== customer.id);
  db.referrals = db.referrals.filter(
    (entry) =>
      entry.referrerId !== customer.id && entry.referredId !== customer.id,
  );
}

interface Rng {
  int: (min: number, max: number) => number;
  pick: <T>(list: readonly T[]) => T;
  chance: (probability: number) => boolean;
}

/**
 * Guests, a closed account, referral codes and referrals, reviews, order
 * feedback and problem reports, on top of the customers and orders that
 * exist. Runs after the orders and returns are seeded.
 */
export function seedAccounts(
  db: Db,
  now: number,
  owner: AdminRecord,
  rng: Rng,
): void {
  const registered = db.customers.filter(
    (customer) => customer.status === "active",
  );
  const ordersOf = (customer: Customer) =>
    db.orders.filter((order) => order.customer.id === customer.id);
  const deliveredOf = (customer: Customer) =>
    ordersOf(customer)
      .filter((order) => order.status === "delivered")
      .sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  const untouched = (order: OrderRecord) =>
    order.adjustments.length === 0 &&
    !db.returns.some((entry) => entry.orderId === order.id);

  // --- Guests: every fifth customer ordered without an account (2) ---------
  const guests = new Set<string>();
  registered.forEach((customer, index) => {
    if (index % 7 === 3) {
      customer.kind = "guest";
      customer.emailVerifiedAt = null;
      customer.lastLoginAt = null;
      guests.add(customer.id);
    }
  });
  for (const order of db.orders) order.isGuest = guests.has(order.customer.id);

  // --- Referral codes, and whom they brought (7) -----------------------------
  const inviters = registered.filter(
    (customer, index) => !guests.has(customer.id) && index % 3 === 0,
  );
  inviters.forEach((customer, index) => {
    customer.referralCode = referralCode(index + 7);
  });
  // The invited people: those with a delivered order first, so that the
  // qualified and void referrals have an order to point at.
  const invitable = registered
    .filter(
      (customer) =>
        !guests.has(customer.id) &&
        !customer.referralCode &&
        Date.parse(customer.createdAt) > now - 80 * DAY,
    )
    .sort(
      (a, b) =>
        Number(deliveredOf(b).length > 0) - Number(deliveredOf(a).length > 0),
    );
  const plans: ("registered" | "qualified" | "void")[] = [
    "qualified",
    "registered",
    "qualified",
    "void",
    "registered",
    "qualified",
    "registered",
  ];
  const withOrders = invitable.filter((entry) => deliveredOf(entry).length > 0);
  const withoutOrders = invitable.filter(
    (entry) => deliveredOf(entry).length === 0,
  );
  plans.forEach((status, index) => {
    const referrer = inviters[index % inviters.length];
    const referred =
      status === "registered"
        ? (withoutOrders.shift() ?? withOrders.pop())
        : withOrders.shift();
    if (!referrer || !referred || !referrer.referralCode) return;
    const delivered = deliveredOf(referred);
    const first = delivered[0];
    const registeredAt = Date.parse(referred.createdAt);
    const qualifies = status !== "registered" && first;
    referred.referredBy = referrer.id;
    db.referrals.push({
      id: newId(registeredAt),
      status: qualifies ? status : "registered",
      code: referrer.referralCode,
      referrerId: referrer.id,
      referredId: referred.id,
      registeredAt: iso(registeredAt),
      orderId: qualifies ? first.id : null,
      orderNumber: qualifies ? first.orderNumber : null,
      qualifiedAt: qualifies ? (first.delivery.deliveredAt ?? null) : null,
      voidReason: qualifies && status === "void" ? "refunded" : null,
      voidAt:
        qualifies && status === "void"
          ? iso(
              Date.parse(first.delivery.deliveredAt ?? first.placedAt) +
                3 * DAY,
            )
          : null,
    });
  });

  // --- Order feedback and reviews (8) -----------------------------------------
  const delivered = db.orders
    .filter((order) => order.status === "delivered")
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt));
  const comments = [
    "Everything arrived fresh and well packed.",
    "Schnelle Lieferung, gerne wieder.",
    null,
    "The box was a bit battered but the food was fine.",
    null,
    "Great spices, the atta is as good as at home.",
  ];
  delivered.forEach((order, index) => {
    if (index % 3 !== 1) return;
    const deliveredAt = Date.parse(
      order.delivery.deliveredAt ?? order.placedAt,
    );
    order.feedback = {
      rating: rng.int(3, 5),
      deliveryRating: index % 2 === 0 ? rng.int(2, 5) : null,
      comment: comments[(index / 3) % comments.length] ?? null,
      at: iso(deliveredAt + rng.int(3, 40) * HOUR),
    };
  });

  const texts: { rating: number; title: string | null; text: string }[] = [
    {
      rating: 5,
      title: "Just like home",
      text: "The flour makes soft rotis every time. We have ordered it three times now and it has always been fresh.",
    },
    {
      rating: 4,
      title: "Good quality, big pack",
      text: "Very good quality. The 5 kg bag is a lot for two people, a smaller one would be nice.",
    },
    {
      rating: 2,
      title: "Arrived late",
      text: "The product itself is fine, but the parcel took a week and the delivery person was rude.",
    },
    {
      rating: 5,
      title: null,
      text: "Sehr aromatisch, genau wie auf dem Markt in Mumbai. Klare Empfehlung.",
    },
    {
      rating: 3,
      title: "Okay",
      text: "Decent, but I have had better. The packaging could be more generous.",
    },
    {
      rating: 5,
      title: "Perfect for dal",
      text: "Cooks quickly and tastes wonderful. Will buy again with the next order.",
    },
    {
      rating: 1,
      title: "Not fresh",
      text: "The pack smelled stale when I opened it. I expected better from Radhe Foods.",
    },
    {
      rating: 4,
      title: "Tasty",
      text: "Good value for the price, nice flavour. Four stars because the lid was hard to open.",
    },
    {
      rating: 5,
      title: "Lovely",
      text: "Beautiful colour and smell. My mother approves, which says everything.",
    },
  ];
  const statuses: ReviewStatus[] = [
    "published",
    "pending",
    "pending",
    "published",
    "rejected",
    "published",
    "pending",
    "published",
    "pending",
  ];
  const reviewed = new Set<string>();
  let written = 0;
  for (const order of delivered) {
    if (written >= texts.length) break;
    if (guests.has(order.customer.id) || order.customer.deleted) continue;
    const customer = db.customers.find(
      (entry) => entry.id === order.customer.id,
    );
    const item = order.items.find(
      (entry) => !reviewed.has(`${order.customer.id}:${entry.productId}`),
    );
    if (!customer || !item) continue;
    const product = db.products.find((entry) => entry.id === item.productId);
    if (!product) continue;
    reviewed.add(`${order.customer.id}:${item.productId}`);
    const body = texts[written]!;
    const status = statuses[written]!;
    const deliveredAt = Date.parse(
      order.delivery.deliveredAt ?? order.placedAt,
    );
    const writtenAt = Math.min(
      now - 2 * HOUR,
      deliveredAt + rng.int(1, 6) * DAY,
    );
    const decidedAt = writtenAt + rng.int(4, 30) * HOUR;
    const decided = status !== "pending" && decidedAt < now;
    db.reviews.push({
      id: newId(writtenAt),
      productId: product.id,
      product: {
        id: product.id,
        slug: product.slug.en,
        name: product.name,
        imageUrl: product.images[0]?.sizes.small.url ?? null,
      },
      customerId: customer.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      rating: body.rating,
      title: body.title,
      text: body.text,
      locale: customer.locale,
      authorName: authorName(customer),
      status: decided ? status : "pending",
      publishedAt: decided && status === "published" ? iso(decidedAt) : null,
      moderation: decided
        ? {
            adminId: owner.id,
            at: iso(decidedAt),
            note:
              status === "rejected"
                ? "Please leave out the name of the delivery person; we take that up with the carrier directly."
                : null,
          }
        : null,
      reply:
        decided && status === "published" && written === 0
          ? {
              text: "Thank you! We mill the atta in small batches, which is why it stays so fresh.",
              adminId: owner.id,
              at: iso(decidedAt + 2 * HOUR),
            }
          : null,
      writtenAt: iso(writtenAt),
      editedAt: written === 2 ? iso(writtenAt + DAY) : null,
      updatedAt: iso(decided ? decidedAt : writtenAt),
    });
    written += 1;
  }

  // --- Problem reports (9) ----------------------------------------------------
  const candidates = delivered.filter(untouched).slice(-10);
  const reports: {
    status: IssueStatus;
    problems: IssueProblem[];
    wish: IssueResolution;
    description: string;
    photos: number;
    whole?: boolean;
    units?: number;
  }[] = [
    {
      status: "open",
      problems: ["damaged"],
      wish: "refund",
      description:
        "The bag of flour had a tear along the side and about a third had spilled into the box. Photos attached.",
      photos: 2,
    },
    {
      status: "open",
      problems: ["late", "other"],
      wish: "none",
      description:
        "The parcel came four days after the promised date, and nobody told us. Just letting you know.",
      photos: 0,
      whole: true,
    },
    {
      status: "open",
      problems: ["missing"],
      wish: "replacement",
      description:
        "One of the two packs was not in the box. The invoice lists both.",
      photos: 1,
    },
    {
      status: "in_review",
      problems: ["wrong_item"],
      wish: "refund",
      description:
        "I ordered the 1 kg pack and received the 500 g pack twice. The label on the box says 1 kg.",
      photos: 1,
    },
    {
      status: "resolved",
      problems: ["not_fresh", "damaged"],
      wish: "refund",
      description:
        "The pack was swollen and smelled off when opened. Best-before date is fine, so it must have been the transport.",
      photos: 2,
    },
    {
      status: "rejected",
      problems: ["other"],
      wish: "refund",
      description:
        "I do not like the taste. Please take it back and refund me.",
      photos: 0,
    },
    {
      status: "cancelled",
      problems: ["missing"],
      wish: "refund",
      description: "A pack was missing from the delivery.",
      photos: 0,
    },
  ];
  const counts = new Map<string, number>();
  reports.forEach((report, index) => {
    const order = candidates[index];
    if (!order) return;
    const count = (counts.get(order.id) ?? 0) + 1;
    counts.set(order.id, count);
    const deliveredAt = Date.parse(
      order.delivery.deliveredAt ?? order.placedAt,
    );
    const reportedAt = Math.min(
      now - (index + 1) * 5 * HOUR,
      deliveredAt + rng.int(6, 60) * HOUR,
    );
    const line = order.items[0]!;
    const items = report.whole
      ? []
      : [
          {
            productId: line.productId,
            variantId: line.variantId,
            sku: line.sku,
            name: line.name,
            packSize: line.packSize,
            quantity: Math.min(report.units ?? 1, line.deliveredQuantity),
            refundedQuantity: 0,
            unitPrice: line.unitPrice,
            vatRate: line.vatRate,
          },
        ];
    const record: IssueRecord = {
      id: newId(reportedAt),
      issueNumber: `${order.orderNumber}-P${count}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      customerId: order.customer.id,
      status: "open",
      reportedAt: iso(reportedAt),
      decidedAt: null,
      items,
      reportedAmount: items.reduce(
        (sum, item) => sum + item.quantity * item.unitPrice,
        0,
      ),
      problems: report.problems,
      description: report.description,
      images: Array.from({ length: report.photos }, (_, photo) =>
        issuePhoto(
          db.config.publicUrl,
          reportedAt + photo + 1,
          (index * 47 + photo * 23) % 360,
          `Photo ${photo + 1}`,
        ),
      ),
      preferredResolution: report.wish,
      resolution: null,
      internalNote: null,
      statusHistory: [
        {
          from: null,
          to: "open",
          at: iso(reportedAt),
          by: "customer",
          adminId: null,
          note: null,
        },
      ],
      updatedAt: iso(reportedAt),
    };
    db.issues.push(record);
    if (report.status === "open") return;
    if (report.status === "cancelled") {
      moveIssue(
        record,
        "cancelled",
        ["open"],
        null,
        null,
        reportedAt + 2 * HOUR,
      );
      return;
    }
    const reviewedAt = reportedAt + 3 * HOUR;
    moveIssue(record, "in_review", ["open"], owner.id, null, reviewedAt);
    record.internalNote =
      report.status === "in_review"
        ? "Asked the carrier for the scan of the parcel."
        : null;
    if (report.status === "in_review") return;
    const decidedAt = reviewedAt + 5 * HOUR;
    if (report.status === "rejected") {
      const note =
        "Taste is a matter of preference and not a fault of the product; opened food cannot be taken back. We are sorry it was not to your liking.";
      moveIssue(record, "rejected", ["in_review"], owner.id, note, decidedAt);
      record.decidedAt = iso(decidedAt);
      return;
    }
    const quantities = new Map(
      record.items.map((item) => [item.variantId, item.quantity]),
    );
    const amount = applyIssueRefund(
      db,
      record,
      order,
      quantities,
      owner.id,
      decidedAt,
    );
    const note =
      "We are sorry about the spoiled pack. The units are credited; the refund follows within a few days.";
    moveIssue(record, "resolved", ["in_review"], owner.id, note, decidedAt);
    record.decidedAt = iso(decidedAt);
    record.resolution = {
      type: "refund",
      amount,
      note,
      adminId: owner.id,
      at: iso(decidedAt),
    };
  });

  // --- One customer closed the account (3) ------------------------------------
  const leaving = registered.find(
    (customer) =>
      !guests.has(customer.id) &&
      !customer.referralCode &&
      !customer.referredBy &&
      deliveredOf(customer).length > 0 &&
      ordersOf(customer).every(
        (order) => order.status === "delivered" || order.status === "cancelled",
      ) &&
      !db.returns.some(
        (entry) =>
          entry.customerId === customer.id &&
          (entry.status === "requested" || entry.status === "approved"),
      ) &&
      !db.issues.some(
        (entry) =>
          entry.customerId === customer.id &&
          (entry.status === "open" || entry.status === "in_review"),
      ),
  );
  if (leaving) closeAccount(db, leaving, now - 6 * DAY - 4 * HOUR);
}
