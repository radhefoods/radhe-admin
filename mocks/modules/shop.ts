// Sections 4 (customers), 5 (settings) and 6 (legal texts).

import { z } from "zod";
import type {
  CannotOrderReason,
  Customer,
  CustomerOrdering,
  LegalDocument,
} from "../../src/lib/api/types/index.ts";
import type { Db } from "../db.ts";
import { companyMissing } from "../domain.ts";
import {
  cursorPage,
  enumParam,
  fail,
  json,
  newId,
  noContent,
  validationFailed,
  zCents,
  zTranslated,
} from "../http.ts";
import type { Router } from "../router.ts";
import { DAY, iso } from "../time.ts";

function customerById(db: Db, id: string): Customer {
  const customer = db.customers.find((entry) => entry.id === id);
  if (!customer)
    throw fail(404, "CUSTOMER_NOT_FOUND", "The customer was not found.");
  return customer;
}

/** Whether the customer may place a new order, and why not (4). */
function orderingOf(db: Db, customer: Customer, now: number): CustomerOrdering {
  const override = customer.orderingOverride;
  const applies =
    override !== null &&
    (override.until === null || Date.parse(override.until) > now);
  const overdue = db.orders
    .filter(
      (order) =>
        order.customer.id === customer.id &&
        order.paymentStatus === "overdue" &&
        order.payment,
    )
    .map((order) => ({
      orderNumber: order.orderNumber,
      invoiceNumber: order.payment!.invoice.number,
      amountDue: order.payment!.amountDue,
      deadlineAt: order.payment!.deadline,
    }));

  let reason: CannotOrderReason | null = null;
  if (customer.status === "blocked") reason = "account_blocked";
  else if (applies && override.mode === "blocked") reason = "ordering_blocked";
  else if (overdue.length > 0 && !(applies && override.mode === "allowed")) {
    reason = "payment_overdue";
  }

  return {
    ordering: {
      canOrder: reason === null,
      reason,
      override: applies ? { mode: override.mode, until: override.until } : null,
      overdue,
    },
    history: [...customer.orderingHistory].reverse(),
  };
}

const statusBody = z.strictObject({
  status: z.enum(["active", "blocked"]),
  reason: z.string().max(500).optional(),
});
const orderingBody = z.strictObject({
  action: z.enum(["block", "allow", "clear"]),
  reason: z.string().min(1).max(1000),
  allowDays: z.number().int().min(1).max(365).optional(),
});

const tiersBody = z.strictObject({
  tiers: z
    .array(z.strictObject({ minOrderValue: zCents(0), fee: zCents(0) }))
    .min(1)
    .max(10),
});
const companyBody = z.strictObject({
  name: z.string().min(1).max(120),
  addressLines: z.array(z.string().min(1).max(120)).min(1).max(5),
  email: z.email(),
  phone: z.string().max(40).optional(),
  website: z.url().optional(),
  vatId: z
    .string()
    .regex(
      /^[A-Z]{2}[A-Z0-9]{2,13}$/,
      "vatId must be a VAT id like DE123456789",
    )
    .optional(),
  taxNumber: z.string().max(40).optional(),
  registration: z.string().max(160).optional(),
  logoUrl: z
    .url()
    .regex(/^https:\/\//, "logoUrl must be an https URL")
    .optional(),
  invoiceFooter: z.string().max(1000).optional(),
});
const paymentsBody = z.strictObject({
  reminderHour: z.number().int().min(0).max(23),
  defaultDeadlineDays: z.number().int().min(1).max(60),
  checkoutMinutes: z.number().int().min(30).max(1440),
});

const LEGAL_TYPES = ["terms", "preorder_terms", "privacy"] as const;
const legalContent = z.strictObject({
  en: z.string().max(300_000).nullish(),
  de: z.string().max(300_000).nullish(),
});
const createLegal = z.strictObject({
  type: z.enum(LEGAL_TYPES),
  title: zTranslated(160),
  content: legalContent,
  note: z.string().max(1000).optional(),
});
const updateLegal = z.strictObject({
  title: zTranslated(160).optional(),
  content: legalContent.optional(),
  note: z.string().max(1000).optional(),
});

function legalById(db: Db, id: string): LegalDocument {
  const document = db.legal.find((entry) => entry.id === id);
  if (!document) {
    throw fail(
      404,
      "LEGAL_DOCUMENT_NOT_FOUND",
      "The legal text was not found.",
    );
  }
  return document;
}

/** The published version with the highest number is what customers accept now. */
function currentLegalId(db: Db, type: string): string | null {
  const published = db.legal
    .filter((entry) => entry.type === type && entry.status === "published")
    .sort((a, b) => b.version - a.version);
  return published[0]?.id ?? null;
}

export function registerShop(router: Router): void {
  // --- Customers ------------------------------------------------------------
  const customers = "/v1/admin/customers";

  router.get(customers, { permission: "customers.read" }, (ctx) => {
    const status = enumParam(ctx.query, "status", [
      "active",
      "blocked",
    ] as const);
    const email = ctx.query.get("email")?.trim().toLowerCase();
    if (
      email !== undefined &&
      email !== "" &&
      (email.length < 2 || email.length > 254)
    ) {
      throw validationFailed([
        {
          field: "email",
          problems: ["email must be longer than or equal to 2 characters"],
        },
      ]);
    }
    const rows = ctx.db.customers.filter(
      (customer) =>
        (!status || customer.status === status) &&
        (!email || customer.email.startsWith(email)),
    );
    return json(cursorPage(rows, ctx.query));
  });

  router.get(`${customers}/:id`, { permission: "customers.read" }, (ctx) =>
    json({ customer: customerById(ctx.db, ctx.params.id ?? "") }),
  );

  router.patch(
    `${customers}/:id/status`,
    { permission: "customers.manage" },
    async (ctx) => {
      const input = await ctx.body(statusBody);
      const customer = customerById(ctx.db, ctx.params.id ?? "");
      customer.status = input.status;
      customer.blockedReason =
        input.status === "blocked" ? (input.reason ?? null) : null;
      customer.blockedAt = input.status === "blocked" ? iso(ctx.now) : null;
      customer.updatedAt = iso(ctx.now);
      return json({ customer });
    },
  );

  router.get(
    `${customers}/:id/ordering`,
    { permission: "customers.read" },
    (ctx) =>
      json(
        orderingOf(ctx.db, customerById(ctx.db, ctx.params.id ?? ""), ctx.now),
      ),
  );

  router.post(
    `${customers}/:id/ordering`,
    { permission: "customers.manage" },
    async (ctx) => {
      const input = await ctx.body(orderingBody);
      const customer = customerById(ctx.db, ctx.params.id ?? "");
      if (input.action === "allow" && input.allowDays === undefined) {
        throw validationFailed([
          {
            field: "allowDays",
            problems: ["allowDays is required when the action is allow"],
          },
        ]);
      }
      const until =
        input.action === "allow"
          ? iso(ctx.now + (input.allowDays ?? 0) * DAY)
          : null;
      customer.orderingOverride =
        input.action === "clear"
          ? null
          : {
              mode: input.action === "block" ? "blocked" : "allowed",
              reason: input.reason,
              adminId: ctx.admin.id,
              at: iso(ctx.now),
              until,
            };
      customer.orderingHistory.push({
        action: input.action,
        reason: input.reason,
        adminId: ctx.admin.id,
        at: iso(ctx.now),
        until,
      });
      customer.updatedAt = iso(ctx.now);
      return json(orderingOf(ctx.db, customer, ctx.now));
    },
  );

  // --- Settings -------------------------------------------------------------
  const settings = "/v1/admin/settings";
  const company = (db: Db) => ({
    ...db.settings.company,
    missingForInvoices: companyMissing(db),
  });

  router.get(settings, { permission: "settings.read" }, (ctx) =>
    json({ ...ctx.db.settings, company: company(ctx.db) }),
  );

  router.put(
    `${settings}/delivery-fee`,
    { permission: "settings.manage" },
    async (ctx) => {
      const input = await ctx.body(tiersBody);
      const starts = input.tiers.map((tier) => tier.minOrderValue);
      const problems: string[] = [];
      if (!starts.includes(0)) problems.push("one tier must start at 0");
      if (new Set(starts).size !== starts.length) {
        problems.push("no two tiers may start at the same value");
      }
      if (problems.length > 0)
        throw validationFailed([{ field: "tiers", problems }]);
      ctx.db.settings.deliveryFee = {
        tiers: [...input.tiers].sort(
          (a, b) => a.minOrderValue - b.minOrderValue,
        ),
      };
      return json({ deliveryFee: ctx.db.settings.deliveryFee });
    },
  );

  router.put(
    `${settings}/order-policy`,
    { permission: "settings.manage" },
    async (ctx) => {
      ctx.db.settings.orderPolicy = await ctx.body(
        z.strictObject({
          customerCancellation: z.enum([
            "while_confirmed",
            "until_dispatched",
            "never",
          ]),
        }),
      );
      return json({ orderPolicy: ctx.db.settings.orderPolicy });
    },
  );

  router.put(
    `${settings}/delivery`,
    { permission: "settings.manage" },
    async (ctx) => {
      ctx.db.settings.delivery = await ctx.body(
        z.strictObject({
          defaultMethod: z.enum(["radhe_delivery", "dhl", "hermes"]),
        }),
      );
      return json({ delivery: ctx.db.settings.delivery });
    },
  );

  router.put(
    `${settings}/return-policy`,
    { permission: "settings.manage" },
    async (ctx) => {
      ctx.db.settings.returnPolicy = await ctx.body(
        z.strictObject({ windowDays: z.number().int().min(0).max(365) }),
      );
      return json({ returnPolicy: ctx.db.settings.returnPolicy });
    },
  );

  router.put(
    `${settings}/company`,
    { permission: "settings.manage" },
    async (ctx) => {
      const input = await ctx.body(companyBody);
      ctx.db.settings.company = { ...input, missingForInvoices: [] };
      return json({ company: company(ctx.db) });
    },
  );

  router.put(
    `${settings}/payments`,
    { permission: "settings.manage" },
    async (ctx) => {
      ctx.db.settings.payments = await ctx.body(paymentsBody);
      return json({ payments: ctx.db.settings.payments });
    },
  );

  // --- Legal texts ----------------------------------------------------------
  const legal = "/v1/admin/legal-documents";

  router.get(legal, { permission: "legal.read" }, (ctx) => {
    const type = enumParam(ctx.query, "type", LEGAL_TYPES);
    const items = ctx.db.legal
      .filter((entry) => !type || entry.type === type)
      .sort(
        (a, b) =>
          LEGAL_TYPES.indexOf(a.type) - LEGAL_TYPES.indexOf(b.type) ||
          b.version - a.version,
      )
      .map(({ content: _content, ...summary }) => ({
        ...summary,
        isCurrent: currentLegalId(ctx.db, summary.type) === summary.id,
      }));
    return json({ items, requiredTypes: ["terms", "privacy"] });
  });

  router.post(legal, { permission: "legal.manage" }, async (ctx) => {
    const input = await ctx.body(createLegal);
    const version =
      Math.max(
        0,
        ...ctx.db.legal
          .filter((entry) => entry.type === input.type)
          .map((entry) => entry.version),
      ) + 1;
    const document: LegalDocument = {
      id: newId(ctx.now),
      type: input.type,
      version,
      status: "draft",
      title: input.title,
      content: input.content,
      note: input.note ?? null,
      publishedAt: null,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.legal.push(document);
    return json({ document }, 201);
  });

  router.get(`${legal}/:id`, { permission: "legal.read" }, (ctx) =>
    json({ document: legalById(ctx.db, ctx.params.id ?? "") }),
  );

  router.patch(`${legal}/:id`, { permission: "legal.manage" }, async (ctx) => {
    const input = await ctx.body(updateLegal);
    const document = legalById(ctx.db, ctx.params.id ?? "");
    if (document.status === "published") {
      throw fail(
        409,
        "LEGAL_DOCUMENT_PUBLISHED",
        "A published legal text cannot be changed.",
      );
    }
    if (input.title !== undefined) document.title = input.title;
    if (input.content !== undefined) document.content = input.content;
    if (input.note !== undefined) document.note = input.note;
    document.updatedAt = iso(ctx.now);
    return json({ document });
  });

  router.post(`${legal}/:id/publish`, { permission: "legal.manage" }, (ctx) => {
    const document = legalById(ctx.db, ctx.params.id ?? "");
    if (document.status !== "published") {
      if (!document.content.en?.trim()) {
        throw validationFailed([
          {
            field: "content.en",
            problems: [
              "A legal text needs its English content before it is published.",
            ],
          },
        ]);
      }
      document.status = "published";
      document.publishedAt = iso(ctx.now);
      document.updatedAt = iso(ctx.now);
    }
    return json({ document });
  });

  router.delete(`${legal}/:id`, { permission: "legal.manage" }, (ctx) => {
    const document = legalById(ctx.db, ctx.params.id ?? "");
    if (document.status === "published") {
      throw fail(
        409,
        "LEGAL_DOCUMENT_PUBLISHED",
        "A published legal text cannot be deleted.",
      );
    }
    ctx.db.legal = ctx.db.legal.filter((entry) => entry.id !== document.id);
    return noContent();
  });
}
