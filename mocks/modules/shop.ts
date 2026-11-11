// Sections 4 (customers), 5 (settings) and 6 (legal pages).

import { z } from "zod";
import type {
  Customer,
  LegalDocument,
  LegalPage,
  LegalSlugs,
  LegalType,
} from "../../src/lib/api/types/index.ts";
import type { Db } from "../db.ts";
import { companyMissing } from "../domain.ts";
import {
  enumParam,
  fail,
  json,
  newId,
  noContent,
  searchParam,
  sortedCursorPage,
  validationFailed,
  wordsMatch,
  zCents,
  zTranslated,
} from "../http.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";

function customerById(db: Db, id: string): Customer {
  const customer = db.customers.find((entry) => entry.id === id);
  if (!customer)
    throw fail(404, "CUSTOMER_NOT_FOUND", "The customer was not found.");
  return customer;
}

const statusBody = z.strictObject({
  status: z.enum(["active", "blocked"]),
  reason: z.string().max(500).optional(),
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
  checkoutMinutes: z.number().int().min(30).max(1440),
});
const deliveryBody = z.strictObject({
  defaultMethod: z.enum(["radhe_delivery", "dhl", "hermes"]),
  estimate: z.strictObject({
    en: z.string().min(1).max(120),
    de: z.string().min(1).max(120),
  }),
});

/** The six legal pages, in the order the API answers them. */
const LEGAL_TYPES = [
  "imprint",
  "shipping",
  "refund",
  "terms",
  "privacy",
  "withdrawal",
] as const;
/** Accepted at checkout; the other four inform and never hold an order up. */
const REQUIRED_LEGAL_TYPES: readonly LegalType[] = ["terms", "privacy"];
const LEGAL_STATUSES = ["draft", "published"] as const;
/** The address of each page until the admin sets another one. */
const DEFAULT_LEGAL_SLUGS: Record<LegalType, LegalSlugs> = {
  imprint: { en: "imprint", de: "impressum" },
  shipping: { en: "shipping", de: "versand" },
  refund: { en: "refund-policy", de: "rueckerstattung" },
  terms: { en: "terms", de: "agb" },
  privacy: { en: "privacy", de: "datenschutz" },
  withdrawal: { en: "withdrawal", de: "widerruf" },
};
const zLegalSlug = z
  .string()
  .max(120)
  .regex(
    /^[a-z0-9]+(-[a-z0-9]+)*$/,
    "slug may contain lower-case letters, digits and single hyphens",
  )
  .nullish();
const zLegalLine = z.strictObject({
  en: z.string().max(300).nullish(),
  de: z.string().max(300).nullish(),
});
/** The page as a whole: what is left out or null goes back to the default. */
const legalPageBody = z.strictObject({
  slug: z.strictObject({ en: zLegalSlug, de: zLegalSlug }).nullish(),
  seo: z
    .strictObject({
      title: zLegalLine.nullish(),
      description: zLegalLine.nullish(),
    })
    .nullish(),
});
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
  note: z.string().max(1000).nullable().optional(),
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

/** The published version with the highest number is the one that applies now. */
function currentLegalId(db: Db, type: string): string | null {
  const published = db.legal
    .filter((entry) => entry.type === type && entry.status === "published")
    .sort((a, b) => b.version - a.version);
  return published[0]?.id ?? null;
}

/** The languages of a text that have one, or undefined when none has. */
function filledPair(
  text: { en?: string | null; de?: string | null } | null | undefined,
): { en?: string; de?: string } | undefined {
  const en = text?.en?.trim();
  const de = text?.de?.trim();
  if (!en && !de) return undefined;
  return { ...(en && { en }), ...(de && { de }) };
}

/** The address of a page in each language: what the admin set, else the default. */
function legalSlugs(db: Db, type: LegalType): LegalSlugs {
  const own = db.legalPages[type]?.slug;
  const fallback = DEFAULT_LEGAL_SLUGS[type];
  return { en: own?.en || fallback.en, de: own?.de || fallback.de };
}

/** The page of one type as the admin manages it. */
function legalPage(db: Db, type: LegalType): LegalPage {
  const versions = db.legal
    .filter((entry) => entry.type === type)
    .sort((a, b) => b.version - a.version);
  const summary = (document: LegalDocument | undefined) => {
    if (!document) return null;
    const { content: _content, ...rest } = document;
    return rest;
  };
  const record = db.legalPages[type];
  return {
    type,
    requiresConsent: REQUIRED_LEGAL_TYPES.includes(type),
    slug: legalSlugs(db, type),
    defaultSlug: DEFAULT_LEGAL_SLUGS[type],
    seo: {
      title: record?.seo?.title ?? null,
      description: record?.seo?.description ?? null,
    },
    current: summary(versions.find((entry) => entry.status === "published")),
    draft: summary(versions.find((entry) => entry.status === "draft")),
    versions: versions.length,
    updatedAt: record?.updatedAt ?? null,
  };
}

export function registerShop(router: Router): void {
  // --- Customers ------------------------------------------------------------
  const customers = "/v1/admin/customers";

  const filteredCustomers = (ctx: { db: Db; query: URLSearchParams }) => {
    const status = enumParam(ctx.query, "status", [
      "active",
      "blocked",
      "deleted",
    ] as const);
    const kind = enumParam(ctx.query, "kind", ["registered", "guest"] as const);
    const email = ctx.query.get("email")?.trim().toLowerCase();
    const q = searchParam(ctx.query);
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
    return ctx.db.customers.filter(
      (customer) =>
        (!status || customer.status === status) &&
        (!kind || customer.kind === kind) &&
        (!email || customer.email.startsWith(email)) &&
        wordsMatch(q, [
          `${customer.firstName ?? ""} ${customer.lastName ?? ""}`,
          customer.email,
          customer.phone,
        ]),
    );
  };

  router.get(`${customers}/count`, { permission: "customers.read" }, (ctx) =>
    json({ total: filteredCustomers(ctx).length }),
  );

  router.get(customers, { permission: "customers.read" }, (ctx) =>
    json(
      sortedCursorPage(filteredCustomers(ctx), ctx.query, {
        createdAt: (customer) => customer.createdAt,
        email: (customer) => customer.email,
        status: (customer) => customer.status,
      }),
    ),
  );

  router.get(`${customers}/:id`, { permission: "customers.read" }, (ctx) =>
    json({ customer: customerById(ctx.db, ctx.params.id ?? "") }),
  );

  router.patch(
    `${customers}/:id/status`,
    { permission: "customers.manage" },
    async (ctx) => {
      const input = await ctx.body(statusBody);
      const customer = customerById(ctx.db, ctx.params.id ?? "");
      if (customer.status === "deleted") {
        throw fail(
          409,
          "CUSTOMER_DELETED",
          "The customer closed this account; it cannot be changed.",
        );
      }
      customer.status = input.status;
      customer.blockedReason =
        input.status === "blocked" ? (input.reason ?? null) : null;
      customer.blockedAt = input.status === "blocked" ? iso(ctx.now) : null;
      customer.updatedAt = iso(ctx.now);
      return json({ customer });
    },
  );

  // --- Settings -------------------------------------------------------------
  const settings = "/v1/admin/settings";
  const company = (db: Db) => ({
    ...db.settings.company,
    missingForInvoices: companyMissing(db),
  });

  router.get(settings, { permission: "settings.read" }, (ctx) =>
    json({
      ...ctx.db.settings,
      company: company(ctx.db),
      payments: {
        ...ctx.db.settings.payments,
        stripeConnected: ctx.db.config.stripe,
      },
      integrations: {
        stripeConnected: ctx.db.config.stripe,
        whatsappConfigured: ctx.db.config.whatsapp,
      },
    }),
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
      ctx.db.settings.delivery = await ctx.body(deliveryBody);
      return json({ delivery: ctx.db.settings.delivery });
    },
  );

  router.put(
    `${settings}/return-policy`,
    { permission: "settings.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          windowDays: z.number().int().min(0).max(365),
          issueWindowDays: z.number().int().min(0).max(365).optional(),
        }),
      );
      // `issueWindowDays` defaults to `windowDays` (5).
      ctx.db.settings.returnPolicy = {
        windowDays: input.windowDays,
        issueWindowDays: input.issueWindowDays ?? input.windowDays,
      };
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
    const status = enumParam(ctx.query, "status", LEGAL_STATUSES);
    const items = ctx.db.legal
      .filter((entry) => !type || entry.type === type)
      .filter((entry) => !status || entry.status === status)
      .sort(
        (a, b) =>
          LEGAL_TYPES.indexOf(a.type) - LEGAL_TYPES.indexOf(b.type) ||
          b.version - a.version,
      )
      .map(({ content: _content, ...summary }) => ({
        ...summary,
        isCurrent: currentLegalId(ctx.db, summary.type) === summary.id,
      }));
    return json({
      items,
      types: LEGAL_TYPES,
      requiredTypes: REQUIRED_LEGAL_TYPES,
    });
  });

  // The six pages, also for a type nobody has written yet.
  router.get(`${legal}/pages`, { permission: "legal.read" }, (ctx) =>
    json({
      items: LEGAL_TYPES.map((type) => legalPage(ctx.db, type)),
      requiredTypes: REQUIRED_LEGAL_TYPES,
    }),
  );

  // Address and search-engine texts of one page, as a whole. No version.
  router.put(
    `${legal}/pages/:type`,
    { permission: "legal.manage" },
    async (ctx) => {
      const type = LEGAL_TYPES.find((entry) => entry === ctx.params.type);
      if (!type) {
        throw fail(
          400,
          "BAD_REQUEST",
          `Validation failed (enum string is expected)`,
        );
      }
      const input = await ctx.body(legalPageBody);
      const slug = filledPair(input.slug);
      const fallback = DEFAULT_LEGAL_SLUGS[type];
      const wanted = [
        ...new Set([slug?.en || fallback.en, slug?.de || fallback.de]),
      ];
      // Two pages with one address could not be told apart: an address
      // that is the type or the address of another page is refused.
      for (const address of wanted) {
        const other = LEGAL_TYPES.find((candidate) => {
          if (candidate === type) return false;
          const taken = legalSlugs(ctx.db, candidate);
          return (
            candidate === address ||
            taken.en === address ||
            taken.de === address
          );
        });
        if (other) {
          throw fail(
            409,
            "LEGAL_SLUG_TAKEN",
            `The address "${address}" belongs to another legal page already.`,
            { slug: address, type: other },
          );
        }
      }
      const title = filledPair(input.seo?.title);
      const description = filledPair(input.seo?.description);
      ctx.db.legalPages[type] = {
        ...(slug && { slug }),
        ...((title || description) && {
          seo: { ...(title && { title }), ...(description && { description }) },
        }),
        updatedAt: iso(ctx.now),
      };
      return json({ page: legalPage(ctx.db, type) });
    },
  );

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
      content: filledPair(input.content) ?? {},
      note: input.note ?? null,
      publishedAt: null,
      publishedByAdmin: null,
      createdByAdmin: { id: ctx.admin.id, name: ctx.admin.name },
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
    if (input.content !== undefined)
      document.content = filledPair(input.content) ?? {};
    if (input.note !== undefined) document.note = input.note;
    document.updatedAt = iso(ctx.now);
    return json({ document });
  });

  router.post(`${legal}/:id/publish`, { permission: "legal.manage" }, (ctx) => {
    const document = legalById(ctx.db, ctx.params.id ?? "");
    if (document.status !== "published") {
      // One language is enough: the shop shows it to readers of the other.
      if (!filledPair(document.content)) {
        throw fail(
          400,
          "VALIDATION_FAILED",
          "A legal text needs its content, in English or in German, before it is published.",
        );
      }
      document.status = "published";
      document.publishedAt = iso(ctx.now);
      document.publishedByAdmin = { id: ctx.admin.id, name: ctx.admin.name };
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
