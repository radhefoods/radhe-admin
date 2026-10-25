// Section 24: wholesale quotations. doc/QUOTATIONS.md sections 5 to 7.

import { z } from "zod";
import type {
  AdminRef,
  NotificationDetail,
  NotificationType,
  QuotationContact,
  QuotationDetail,
  QuotationItem,
  QuotationStatus,
  QuotationSummary,
  QuotationTotals,
} from "../../src/lib/api/types/index.ts";
import type { AdminRecord, Db, ProductRecord, VariantRecord } from "../db.ts";
import { cartonOf } from "../domain.ts";
import {
  enumParam,
  fail,
  json,
  newId,
  page,
  searchParam,
  wordsMatch,
  zId,
} from "../http.ts";
import { textPdf } from "../pdf.ts";
import type { Router } from "../router.ts";
import { DAY, HOUR, berlinDay, iso } from "../time.ts";

/** A line as stored: the amount is worked out on reading. */
export type QuotationItemRecord = Omit<QuotationItem, "lineTotal">;

/** A quotation as stored: counts, totals and amounts are worked out on reading. */
export interface QuotationRecord {
  id: string;
  number: string;
  status: QuotationStatus;
  contact: QuotationContact;
  message: string | null;
  consent: { acceptedAt: string; ip: string; userAgent: string };
  locale: "en" | "de";
  items: QuotationItemRecord[];
  revision: number;
  sentAt: string | null;
  firstSentAt: string | null;
  sentCount: number;
  pricedAt: string | null;
  closedAt: string | null;
  updatedBy: AdminRef | null;
  sentBy: AdminRef | null;
  closedBy: AdminRef | null;
  createdAt: string;
  updatedAt: string;
}

const STATUSES: QuotationStatus[] = [
  "new",
  "draft",
  "sent",
  "accepted",
  "declined",
  "cancelled",
];
const SORTS = ["newest", "updated", "company"] as const;
const OPEN: QuotationStatus[] = ["new", "draft", "sent"];

const zPatch = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: zId,
        unitPrice: z.number().int().min(1).max(10_000_000).optional(),
        cartons: z.number().int().min(1).max(10_000).optional(),
      }),
    )
    .min(1)
    .max(200),
});

// --- Views ------------------------------------------------------------------

function totalsOf(record: QuotationRecord): QuotationTotals | null {
  if (record.items.some((item) => item.unitPrice === null)) return null;
  const byRate = new Map<number, number>();
  for (const item of record.items) {
    const net = item.cartons * (item.unitPrice ?? 0);
    byRate.set(item.vatRate, (byRate.get(item.vatRate) ?? 0) + net);
  }
  // VAT is added per rate on the net sum of that rate, rounded once per rate.
  const vat = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([vatRate, net]) => {
      const amount = Math.round((net * vatRate) / 10000);
      return { vatRate, net, vat: amount, gross: net + amount };
    });
  const net = vat.reduce((sum, entry) => sum + entry.net, 0);
  const vatTotal = vat.reduce((sum, entry) => sum + entry.vat, 0);
  return {
    cartons: record.items.reduce((sum, item) => sum + item.cartons, 0),
    net,
    vat,
    vatTotal,
    gross: net + vatTotal,
  };
}

export function quotationSummary(record: QuotationRecord): QuotationSummary {
  const { items, message: _m, consent: _c, locale: _l, ...rest } = record;
  return {
    ...rest,
    itemCount: items.length,
    cartons: items.reduce((sum, item) => sum + item.cartons, 0),
    pricedLines: items.filter((item) => item.unitPrice !== null).length,
    totals: totalsOf(record),
  };
}

function quotationDetail(record: QuotationRecord): QuotationDetail {
  return {
    ...quotationSummary(record),
    message: record.message,
    consent: record.consent,
    locale: record.locale,
    items: record.items.map((item) => ({
      ...item,
      lineTotal: item.unitPrice === null ? null : item.cartons * item.unitPrice,
    })),
  };
}

function emailsOf(db: Db, id: string) {
  return db.notifications
    .filter((entry) => entry.quotationId === id)
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .map(({ data: _data, ...rest }) => rest);
}

function answer(db: Db, record: QuotationRecord) {
  return json({
    quotation: quotationDetail(record),
    notifications: emailsOf(db, record.id),
  });
}

function byId(db: Db, id: string): QuotationRecord {
  const found = db.quotations.find((entry) => entry.id === id);
  if (!found) throw fail(404, "QUOTATION_NOT_FOUND", "Quotation not found.");
  return found;
}

function ref(admin: AdminRecord): AdminRef {
  return { id: admin.id, name: admin.name };
}

function statusInvalid(record: QuotationRecord, allowed: QuotationStatus[]) {
  const message =
    record.status === "sent"
      ? "The quotation was sent already. Change a price for a revision, or resend it."
      : `A ${record.status} quotation does not allow this.`;
  return fail(409, "QUOTATION_STATUS_INVALID", message, {
    status: record.status,
    allowed,
  });
}

/** The start page group (15): requests nobody has priced yet, the newest five. */
export function quotationAttention(db: Db) {
  const fresh = db.quotations
    .filter((entry) => entry.status === "new")
    .sort((a, b) => (a.id < b.id ? 1 : -1));
  return { new: fresh.length, items: fresh.slice(0, 5).map(quotationSummary) };
}

// --- Emails (section 6) -----------------------------------------------------

const SUBJECT: Record<
  Extract<
    NotificationType,
    "quotation_received" | "quotation_request_admin" | "quotation_sent"
  >,
  (record: QuotationRecord) => string
> = {
  quotation_received: (record) =>
    `We received your quotation request ${record.number}`,
  quotation_request_admin: (record) =>
    `New quotation request ${record.number} from ${record.contact.company}`,
  quotation_sent: (record) =>
    record.revision > 1
      ? `Your updated quotation ${record.number} from Radhe Foods`
      : `Your quotation ${record.number} from Radhe Foods`,
};

/** One email about a quotation, as the notifications module would queue it. */
export function quotationEmail(
  db: Db,
  record: QuotationRecord,
  type: keyof typeof SUBJECT,
  at: number,
  outcome: "sent" | "failed" | "skipped" = "sent",
): NotificationDetail {
  const toShop = type === "quotation_request_admin";
  const to = toShop ? db.settings.company.email || "" : record.contact.email;
  const skipped = toShop && !to;
  const status = skipped ? "skipped" : outcome;
  const email: NotificationDetail = {
    id: newId(at),
    type,
    channel: "email",
    to,
    customerId: null,
    orderId: null,
    orderNumber: null,
    productId: null,
    returnId: null,
    refundId: null,
    announcementId: null,
    quotationId: record.id,
    locale: "en",
    subject: SUBJECT[type](record),
    attachments:
      type === "quotation_sent"
        ? [{ kind: "quotation_pdf", id: record.id }]
        : [],
    status,
    attempts: status === "sent" ? 1 : status === "failed" ? 6 : 0,
    maxAttempts: 6,
    nextAttemptAt: null,
    sentAt: status === "sent" ? iso(at) : null,
    providerMessageId:
      status === "sent"
        ? `0100018${newId(at).slice(-12)}@email.amazonses.com`
        : null,
    lastError:
      status === "failed"
        ? "554 Message rejected: Email address is not verified."
        : null,
    reason: skipped ? "The company email is empty in the settings." : null,
    history:
      status === "sent"
        ? [{ at: iso(at), ok: true }]
        : status === "failed"
          ? Array.from({ length: 6 }, (_, index) => ({
              at: iso(at + index * 10 * 60_000),
              ok: false,
              error: "554 Message rejected: Email address is not verified.",
            }))
          : [],
    createdAt: iso(at),
    updatedAt: iso(status === "failed" ? at + 50 * 60_000 : at),
    data: {
      number: record.number,
      company: record.contact.company,
      lines: record.items.map((item) => ({
        name: item.name,
        carton: item.carton.label,
        cartons: item.cartons,
      })),
    },
  };
  db.notifications.push(email);
  return email;
}

// --- The PDF -----------------------------------------------------------------

function money(cents: number): string {
  return `€${(cents / 100).toFixed(2)}`;
}

function quotationPdf(db: Db, record: QuotationRecord): Uint8Array {
  const company = db.settings.company;
  const totals = totalsOf(record);
  return textPdf([
    { text: company.name || "Radhe Foods", size: 18, bold: true },
    { text: [company.email, company.phone].filter(Boolean).join("  ·  ") },
    {
      text: `Quotation ${record.number}${record.revision > 1 ? `  (revision ${record.revision})` : ""}`,
      size: 15,
      bold: true,
      gap: 26,
    },
    {
      text: `Date: ${berlinDay(Date.parse(record.updatedAt))}    Request: ${berlinDay(Date.parse(record.createdAt))}`,
    },
    { text: "Prepared for", bold: true, gap: 22 },
    { text: record.contact.company },
    { text: record.contact.name },
    {
      text: [record.contact.city, record.contact.email]
        .filter(Boolean)
        .join("  ·  "),
    },
    { text: "Lines", bold: true, gap: 22 },
    ...record.items.map((item, index) => ({
      text: `${index + 1}. ${item.name} (${item.sku}, ${item.carton.label})   ${item.cartons} x ${
        item.unitPrice === null ? "–" : money(item.unitPrice)
      }   ${item.vatRate / 100} %   ${
        item.unitPrice === null ? "–" : money(item.cartons * item.unitPrice)
      }`,
    })),
    ...(totals
      ? [
          { text: `Net total: ${money(totals.net)}`, gap: 18 },
          ...totals.vat.map((entry) => ({
            text: `VAT ${entry.vatRate / 100} %: ${money(entry.vat)}`,
          })),
          {
            text: `Total incl. VAT: ${money(totals.gross)}`,
            size: 13,
            bold: true,
          },
        ]
      : [{ text: "Prices to be confirmed", bold: true, gap: 18 }]),
    {
      text: "Prices per carton and net of VAT; delivery arranged at the order.",
      gap: 22,
    },
  ]);
}

// --- Routes -----------------------------------------------------------------

export function registerQuotations(router: Router): void {
  const base = "/v1/admin/quotations";

  router.get(base, { permission: "quotations.read" }, (ctx) => {
    const status = enumParam(ctx.query, "status", STATUSES);
    const sort = enumParam(ctx.query, "sort", SORTS) ?? "newest";
    const q = searchParam(ctx.query);
    const rows = ctx.db.quotations
      .filter(
        (entry) =>
          (!status || entry.status === status) &&
          wordsMatch(q, [
            entry.number,
            entry.contact.company,
            entry.contact.name,
            entry.contact.email,
          ]),
      )
      .sort((a, b) => {
        if (sort === "company") {
          return (
            a.contact.company.localeCompare(b.contact.company) ||
            (a.id < b.id ? 1 : -1)
          );
        }
        if (sort === "updated") {
          return a.updatedAt < b.updatedAt
            ? 1
            : a.updatedAt > b.updatedAt
              ? -1
              : 0;
        }
        return a.id < b.id ? 1 : -1;
      });
    return json(page(rows.map(quotationSummary), ctx.query));
  });

  router.get(`${base}/:id`, { permission: "quotations.read" }, (ctx) =>
    answer(ctx.db, byId(ctx.db, ctx.params.id ?? "")),
  );

  router.get(`${base}/:id/pdf`, { permission: "quotations.read" }, (ctx) => {
    const record = byId(ctx.db, ctx.params.id ?? "");
    return new Response(quotationPdf(ctx.db, record) as BodyInit, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `inline; filename="${record.number}.pdf"`,
      },
    });
  });

  router.patch(
    `${base}/:id`,
    { permission: "quotations.manage" },
    async (ctx) => {
      const record = byId(ctx.db, ctx.params.id ?? "");
      const input = await ctx.body(zPatch);
      if (!OPEN.includes(record.status)) throw statusInvalid(record, OPEN);
      for (const line of input.items) {
        if (!record.items.some((item) => item.id === line.id)) {
          throw fail(
            404,
            "QUOTATION_ITEM_NOT_FOUND",
            "This line does not belong to the quotation.",
            { id: line.id },
          );
        }
      }
      for (const line of input.items) {
        const item = record.items.find((entry) => entry.id === line.id)!;
        if (line.unitPrice !== undefined) item.unitPrice = line.unitPrice;
        if (line.cartons !== undefined) item.cartons = line.cartons;
      }
      record.status = "draft";
      record.pricedAt = iso(ctx.now);
      record.updatedBy = ref(ctx.admin);
      record.updatedAt = iso(ctx.now);
      return answer(ctx.db, record);
    },
  );

  router.post(
    `${base}/:id/send`,
    { permission: "quotations.manage" },
    (ctx) => {
      const record = byId(ctx.db, ctx.params.id ?? "");
      if (record.status !== "new" && record.status !== "draft") {
        throw statusInvalid(record, ["new", "draft"]);
      }
      const unpriced = record.items
        .filter((item) => item.unitPrice === null)
        .map((item) => item.id);
      if (unpriced.length > 0) {
        throw fail(
          400,
          "QUOTATION_NOT_PRICED",
          "Every line needs a price before the quotation is sent.",
          { unpriced },
        );
      }
      record.status = "sent";
      record.revision += 1;
      record.sentAt = iso(ctx.now);
      record.firstSentAt ??= iso(ctx.now);
      record.sentCount += 1;
      record.sentBy = ref(ctx.admin);
      record.updatedAt = iso(ctx.now);
      quotationEmail(ctx.db, record, "quotation_sent", ctx.now);
      return answer(ctx.db, record);
    },
  );

  router.post(
    `${base}/:id/resend`,
    { permission: "quotations.manage" },
    (ctx) => {
      const record = byId(ctx.db, ctx.params.id ?? "");
      if (record.status !== "sent") throw statusInvalid(record, ["sent"]);
      record.sentAt = iso(ctx.now);
      record.sentCount += 1;
      record.sentBy = ref(ctx.admin);
      record.updatedAt = iso(ctx.now);
      quotationEmail(ctx.db, record, "quotation_sent", ctx.now);
      return answer(ctx.db, record);
    },
  );

  for (const outcome of ["accept", "decline"] as const) {
    router.post(
      `${base}/:id/${outcome}`,
      { permission: "quotations.manage" },
      (ctx) => {
        const record = byId(ctx.db, ctx.params.id ?? "");
        if (record.status !== "sent") throw statusInvalid(record, ["sent"]);
        record.status = outcome === "accept" ? "accepted" : "declined";
        record.closedAt = iso(ctx.now);
        record.closedBy = ref(ctx.admin);
        record.updatedAt = iso(ctx.now);
        return answer(ctx.db, record);
      },
    );
  }

  router.post(
    `${base}/:id/cancel`,
    { permission: "quotations.manage" },
    (ctx) => {
      const record = byId(ctx.db, ctx.params.id ?? "");
      if (!OPEN.includes(record.status)) throw statusInvalid(record, OPEN);
      record.status = "cancelled";
      record.closedAt = iso(ctx.now);
      record.closedBy = ref(ctx.admin);
      record.updatedAt = iso(ctx.now);
      return answer(ctx.db, record);
    },
  );
}

// --- Seed -------------------------------------------------------------------

interface SeedLine {
  product: ProductRecord;
  variant: VariantRecord;
  cartons: number;
  /** Net cents per carton; `null` while unpriced. */
  unitPrice: number | null;
}

/**
 * Seven requests from the wholesale site, one per stage of the workflow:
 * closed ones from weeks ago, one sent and waiting, one half priced, two
 * new. The lines copy the catalogue as it is at the request.
 */
export function seedQuotations(db: Db, now: number, admin: AdminRecord): void {
  const boxed = db.products.flatMap((product) =>
    product.variants
      .filter((variant) => variant.unitsPerCarton !== null)
      .map((variant) => ({ product, variant })),
  );
  if (boxed.length < 4) return;
  const pick = (index: number) => boxed[index % boxed.length]!;
  // A fair net price per carton: the retail price of the packs, less about a fifth.
  const netOf = (line: { variant: VariantRecord }) =>
    Math.round(
      (line.variant.regularPrice * (line.variant.unitsPerCarton ?? 1)) /
        1.07 /
        1.25,
    );
  const line = (index: number, cartons: number, priced: boolean): SeedLine => {
    const entry = pick(index);
    return {
      ...entry,
      cartons,
      unitPrice: priced ? netOf(entry) : null,
    };
  };

  const create = (
    at: number,
    contact: QuotationContact,
    lines: SeedLine[],
    message: string | null,
    locale: "en" | "de" = "en",
  ): QuotationRecord => {
    db.counters.quotation += 1;
    const record: QuotationRecord = {
      id: newId(at),
      number: `Q-${berlinDay(at).slice(0, 4)}-${String(db.counters.quotation).padStart(4, "0")}`,
      status: "new",
      contact,
      message,
      consent: {
        acceptedAt: iso(at),
        ip: `203.0.113.${(db.counters.quotation * 37) % 250}`,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36",
      },
      locale,
      items: lines.map((entry, index) => ({
        id: newId(at + index + 1),
        productId: entry.product.id,
        variantId: entry.variant.id,
        sku: entry.variant.sku,
        name: entry.product.name.en,
        brand: entry.product.brand,
        packSize: entry.variant.packSize,
        carton: cartonOf(entry.variant)!,
        cartons: entry.cartons,
        vatRate: entry.product.vatRate,
        unitPrice: entry.unitPrice,
      })),
      revision: 0,
      sentAt: null,
      firstSentAt: null,
      sentCount: 0,
      pricedAt: null,
      closedAt: null,
      updatedBy: null,
      sentBy: null,
      closedBy: null,
      createdAt: iso(at),
      updatedAt: iso(at),
    };
    db.quotations.push(record);
    quotationEmail(db, record, "quotation_received", at + 2000);
    return record;
  };
  const priced = (record: QuotationRecord, at: number) => {
    record.status = "draft";
    record.pricedAt = iso(at);
    record.updatedBy = ref(admin);
    record.updatedAt = iso(at);
  };
  const sent = (record: QuotationRecord, at: number) => {
    record.status = "sent";
    record.revision += 1;
    record.sentAt = iso(at);
    record.firstSentAt ??= iso(at);
    record.sentCount += 1;
    record.sentBy = ref(admin);
    record.updatedAt = iso(at);
    quotationEmail(db, record, "quotation_sent", at);
  };
  const closed = (
    record: QuotationRecord,
    status: QuotationStatus,
    at: number,
  ) => {
    record.status = status;
    record.closedAt = iso(at);
    record.closedBy = ref(admin);
    record.updatedAt = iso(at);
  };

  // Accepted: two lines, priced and sent three weeks ago, ordered a week later.
  let at = now - 24 * DAY;
  let record = create(
    at,
    {
      name: "Priya Sharma",
      company: "Sharma Supermarkt",
      email: "priya@sharma-markt.de",
      phone: "+49 69 1234567",
      city: "Frankfurt am Main",
    },
    [line(0, 3, true), line(1, 2, true)],
    "Delivery on Tuesdays please.",
  );
  quotationEmail(db, record, "quotation_request_admin", at + 3000);
  priced(record, at + 3 * HOUR);
  sent(record, at + 4 * HOUR);
  closed(record, "accepted", at + 7 * DAY);

  // Declined: one line, a second revision after a lower price, no order.
  at = now - 16 * DAY;
  record = create(
    at,
    {
      name: "Arjun Mehta",
      company: "Taj Mahal Restaurant",
      email: "einkauf@tajmahal-offenbach.de",
      phone: "+49 69 9876543",
      city: "Offenbach",
    },
    [line(2, 6, true)],
    null,
  );
  quotationEmail(db, record, "quotation_request_admin", at + 3000);
  priced(record, at + DAY);
  sent(record, at + DAY + HOUR);
  record.items[0]!.unitPrice = Math.round(record.items[0]!.unitPrice! * 0.95);
  priced(record, at + 3 * DAY);
  sent(record, at + 3 * DAY + HOUR);
  closed(record, "declined", at + 9 * DAY);

  // Cancelled: an unpriced request that turned out to be spam.
  at = now - 7 * DAY;
  record = create(
    at,
    {
      name: "Max Mustermann",
      company: "Best Deals Trading",
      email: "offers@best-deals-trading.example",
      phone: null,
      city: null,
    },
    [line(3, 50, false), line(4, 50, false)],
    "Send best price for container. Urgent.",
  );
  quotationEmail(db, record, "quotation_request_admin", at + 3000);
  closed(record, "cancelled", at + 2 * HOUR);

  // Sent and waiting for the answer: three lines, revision 1, two days ago.
  at = now - 4 * DAY;
  record = create(
    at,
    {
      name: "Lena Hoffmann",
      company: "Spice Corner GmbH",
      email: "lena.hoffmann@spicecorner.de",
      phone: "+49 6151 445566",
      city: "Darmstadt",
    },
    [line(5, 4, true), line(6, 2, true), line(0, 1, true)],
    "We open a second shop in November and need a first stock.",
  );
  quotationEmail(db, record, "quotation_request_admin", at + 3000);
  priced(record, at + 5 * HOUR);
  sent(record, now - 2 * DAY);

  // Draft: three lines, two of them priced yesterday.
  at = now - 2 * DAY - 3 * HOUR;
  record = create(
    at,
    {
      name: "Ravi Nair",
      company: "Curry House Mainz",
      email: "ravi@curryhouse-mainz.de",
      phone: "+49 6131 778899",
      city: "Mainz",
    },
    [line(1, 5, true), line(7, 3, true), line(2, 2, false)],
    null,
    "de",
  );
  quotationEmail(db, record, "quotation_request_admin", at + 3000);
  priced(record, now - DAY);

  // New, five hours ago; the heads-up to the shop failed at the provider.
  at = now - 5 * HOUR;
  record = create(
    at,
    {
      name: "Mei Lin",
      company: "Asia Markt Wiesbaden",
      email: "bestellung@asiamarkt-wi.de",
      phone: "+49 611 332211",
      city: "Wiesbaden",
    },
    [line(8, 2, false), line(3, 4, false)],
    null,
  );
  quotationEmail(db, record, "quotation_request_admin", at + 3000, "failed");

  // New, forty minutes ago, with a message.
  at = now - 40 * 60_000;
  record = create(
    at,
    {
      name: "Anita Desai",
      company: "Namaste Catering",
      email: "anita@namaste-catering.de",
      phone: "+49 69 5566778",
      city: "Frankfurt am Main",
    },
    [
      line(9, 3, false),
      line(4, 2, false),
      line(6, 1, false),
      line(5, 2, false),
    ],
    "Monthly supply for our canteen contracts. Could you quote delivery to two addresses?",
  );
  quotationEmail(db, record, "quotation_request_admin", at + 3000);
}
