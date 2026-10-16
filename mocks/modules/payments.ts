// Sections 11 (payments and refunds) and 12 (invoices and credit notes).
// The admin records no payment: the shop is paid at checkout. What the
// admin decides are refunds.

import { z } from "zod";
import type { InvoiceDetail, Refund } from "../../src/lib/api/types/index.ts";
import type { Db } from "../db.ts";
import {
  customerOf,
  invoiceSummary,
  paymentBlock,
  pushHistory,
  queueMessage,
  refundableOf,
} from "../domain.ts";
import {
  cursorPage,
  enumParam,
  fail,
  idParam,
  json,
  newId,
  sortedCursorPage,
  validationFailed,
  zCents,
  zNote,
} from "../http.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";
import { orderById } from "./orders.ts";

const REFUND_STATUSES = [
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
] as const;

function refundById(db: Db, id: string): Refund {
  const refund = db.refunds.find((entry) => entry.id === id);
  if (!refund) throw fail(404, "REFUND_NOT_FOUND", "The refund was not found.");
  return refund;
}

function moveRefund(
  refund: Refund,
  to: Refund["status"],
  by: "admin" | "stripe",
  adminId: string | null,
  note: string | null,
  now: number,
): void {
  refund.statusHistory.push({
    from: refund.status,
    to,
    at: iso(now),
    by,
    adminId,
    note,
  });
  refund.status = to;
}

/** The money went back: the order carries it, and the customer hears of it. */
export function completeRefund(
  db: Db,
  refund: Refund,
  by: "admin" | "stripe",
  adminId: string | null,
  note: string | null,
  now: number,
): void {
  moveRefund(refund, "completed", by, adminId, note, now);
  refund.completedAt = iso(now);
  const order = db.orders.find((entry) => entry.id === refund.orderId);
  if (!order) return;
  order.payment.refundedAmount += refund.amount;
  pushHistory(
    order,
    {
      field: "payment",
      from: order.paymentStatus,
      to: "refunded",
      by: by === "stripe" ? "system" : "admin",
      adminId,
      note: refund.refundNumber,
    },
    now,
  );
  if (
    order.payment.paidAmount > 0 &&
    order.payment.refundedAmount >= order.payment.paidAmount
  ) {
    order.paymentStatus = "refunded";
  }
  const customer = customerOf(db, order);
  if (customer) {
    queueMessage(
      db,
      {
        type: "refund_completed",
        customer,
        order,
        refundId: refund.id,
        data: {
          amount: refund.amount,
          method: refund.method,
          way: refund.manual?.way ?? null,
        },
      },
      now,
    );
  }
}

// --- A small PDF, enough to open and print ----------------------------------

function latin1(text: string): string {
  return text
    .replace(/€/g, "\x80")
    .replace(/[–—]/g, "-")
    .replace(/[^\x00-\xff]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}

function money(cents: number): string {
  const absolute = Math.abs(cents).toString().padStart(3, "0");
  return `${cents < 0 ? "-" : ""}${absolute.slice(0, -2)},${absolute.slice(-2)} €`;
}

export function invoicePdf(invoice: InvoiceDetail): Uint8Array {
  const german = invoice.language === "de";
  const credit = invoice.type === "credit_note";
  const title = credit
    ? german
      ? "Gutschrift"
      : "Credit note"
    : german
      ? "Rechnung"
      : "Invoice";
  const lines: { text: string; size?: number; bold?: boolean; gap?: number }[] =
    [
      { text: invoice.seller.name, size: 18, bold: true },
      ...invoice.seller.addressLines.map((text) => ({ text })),
      {
        text: [invoice.seller.email, invoice.seller.phone]
          .filter(Boolean)
          .join("  ·  "),
      },
      { text: `${title} ${invoice.number}`, size: 15, bold: true, gap: 26 },
      {
        text: `${german ? "Datum" : "Date"}: ${invoice.issuedAt.slice(0, 10)}    ${german ? "Bestellung" : "Order"}: ${invoice.orderNumber}`,
      },
      ...(invoice.invoiceNumber
        ? [
            {
              text: `${german ? "Zur Rechnung" : "For invoice"}: ${invoice.invoiceNumber}`,
            },
          ]
        : []),
      ...(invoice.paidAt
        ? [
            {
              text: `${german ? "Bezahlt am" : "Paid on"}: ${invoice.paidAt.slice(0, 10)}`,
            },
          ]
        : []),
      { text: invoice.customer.name, bold: true, gap: 22 },
      ...invoice.customer.addressLines.map((text) => ({ text })),
      { text: german ? "Positionen" : "Items", bold: true, gap: 22 },
      ...invoice.lines.map((line) => ({
        text: `${line.quantity} x ${line.description}   ${money(line.unitPrice)}   =   ${money(line.lineTotal)}   (${line.vatPercent} %)`,
      })),
      {
        text: `${german ? "Netto" : "Net"}: ${money(invoice.totals.netTotal)}`,
        gap: 18,
      },
      ...invoice.totals.vat.map((entry) => ({
        text: `${german ? "USt." : "VAT"} ${entry.vatRate / 100} %: ${money(entry.vat)}`,
      })),
      {
        text: `${german ? "Gesamt" : "Total"}: ${money(invoice.totals.total)}`,
        size: 13,
        bold: true,
      },
      ...(invoice.seller.vatId
        ? [{ text: `USt-IdNr.: ${invoice.seller.vatId}`, gap: 26 }]
        : []),
      ...(invoice.footer ? [{ text: invoice.footer }] : []),
    ];

  let y = 790;
  let stream = "BT\n";
  for (const line of lines) {
    const size = line.size ?? 10.5;
    y -= (line.gap ?? 0) + size + 5;
    stream += `/${line.bold ? "F2" : "F1"} ${size} Tf\n1 0 0 1 56 ${y} Tm\n(${latin1(line.text)}) Tj\n`;
  }
  stream += "ET\n";

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 6 0 R /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(pdf, (char) => char.charCodeAt(0) & 0xff);
}

export function registerPayments(router: Router): void {
  const orders = "/v1/admin/orders";

  router.get(
    `${orders}/:id/payment`,
    { permission: "payments.read" },
    (ctx) => {
      const order = orderById(ctx.db, ctx.params.id ?? "");
      return json({
        orderNumber: order.orderNumber,
        status: order.status,
        payment: paymentBlock(ctx.db, order, ctx.now),
        refundable: refundableOf(ctx.db, order),
        documents: ctx.db.invoices
          .filter((invoice) => invoice.orderId === order.id)
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .map(invoiceSummary),
        refunds: ctx.db.refunds
          .filter((refund) => refund.orderId === order.id)
          .sort((a, b) => (a.id < b.id ? 1 : -1)),
      });
    },
  );

  router.post(
    `${orders}/:id/payment/refunds`,
    { permission: "payments.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          amount: zCents(1),
          reason: z.enum([
            "return",
            "adjustment",
            "goodwill",
            "duplicate_payment",
            "other",
          ]),
          method: z.enum(["stripe", "manual"]),
          manual: z
            .strictObject({
              way: z.enum(["bank_transfer", "cash", "other"]),
              reference: z.string().max(200).optional(),
            })
            .optional(),
          note: zNote(1000),
        }),
      );
      const order = orderById(ctx.db, ctx.params.id ?? "");
      const refundable = refundableOf(ctx.db, order);
      if (refundable.paidAmount <= 0) {
        throw fail(
          409,
          "REFUND_AMOUNT_INVALID",
          "Nothing was paid on this order.",
        );
      }
      if (input.amount > refundable.maximum) {
        throw fail(
          400,
          "REFUND_AMOUNT_INVALID",
          "The amount is more than can be refunded.",
          refundable,
        );
      }
      if (input.method === "stripe") {
        if (order.payment.paymentIntentId === null) {
          throw fail(
            400,
            "REFUND_METHOD_INVALID",
            "The order was not paid through Stripe.",
          );
        }
        if (!ctx.db.config.stripe) {
          throw fail(
            503,
            "PAYMENTS_NOT_CONFIGURED",
            "Online payment is not set up.",
          );
        }
      }
      if (input.method === "manual" && !input.manual) {
        throw validationFailed([
          {
            field: "manual",
            problems: ["manual is required for method manual"],
          },
        ]);
      }
      const count = ctx.db.refunds.filter(
        (refund) => refund.orderId === order.id,
      ).length;
      // The stand-in for Stripe confirms at once.
      const status = input.method === "stripe" ? "completed" : "pending";
      const refund: Refund = {
        id: newId(ctx.now),
        refundNumber: `${order.orderNumber}-RF${count + 1}`,
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.customer.id,
        invoiceNumber: order.payment.invoiceNumber,
        amount: input.amount,
        reason: input.reason,
        method: input.method,
        status: "pending",
        manual:
          input.method === "manual" && input.manual
            ? {
                way: input.manual.way,
                reference: input.manual.reference ?? null,
                paidAt: null,
              }
            : null,
        stripe:
          input.method === "stripe"
            ? {
                refundId: `re_3Demo${newId(ctx.now).slice(-10)}`,
                paymentIntentId: order.payment.paymentIntentId,
                stripeStatus: "pending",
                failureReason: null,
              }
            : null,
        note: input.note ?? null,
        createdBy: ctx.admin.id,
        createdAt: iso(ctx.now),
        completedAt: null,
        statusHistory: [
          {
            from: null,
            to: "pending",
            at: iso(ctx.now),
            by: "admin",
            adminId: ctx.admin.id,
            note: null,
          },
        ],
      };
      ctx.db.refunds.push(refund);
      if (status === "completed" && refund.stripe) {
        refund.stripe.stripeStatus = "succeeded";
        completeRefund(
          ctx.db,
          refund,
          "stripe",
          null,
          "Stripe: succeeded",
          ctx.now + 1000,
        );
      }
      return json({ refund }, 201);
    },
  );

  // --- Refunds --------------------------------------------------------------
  const refunds = "/v1/admin/refunds";

  const filteredRefunds = (ctx: { db: Db; query: URLSearchParams }) => {
    const status = enumParam(ctx.query, "status", REFUND_STATUSES);
    const orderNumber = ctx.query.get("orderNumber")?.trim().toUpperCase();
    return ctx.db.refunds.filter(
      (refund) =>
        (!status || refund.status === status) &&
        (!orderNumber || refund.orderNumber === orderNumber),
    );
  };

  router.get(`${refunds}/count`, { permission: "payments.read" }, (ctx) =>
    json({ total: filteredRefunds(ctx).length }),
  );

  router.get(refunds, { permission: "payments.read" }, (ctx) =>
    json(
      sortedCursorPage(filteredRefunds(ctx), ctx.query, {
        createdAt: (refund) => refund.createdAt,
        amount: (refund) => refund.amount,
        status: (refund) => refund.status,
      }),
    ),
  );

  router.get(`${refunds}/:id`, { permission: "payments.read" }, (ctx) =>
    json({ refund: refundById(ctx.db, ctx.params.id ?? "") }),
  );

  router.post(
    `${refunds}/:id/complete`,
    { permission: "payments.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          paidAt: z.iso.datetime({ offset: true }).optional(),
          reference: z.string().max(200).optional(),
          note: zNote(1000),
        }),
      );
      const refund = refundById(ctx.db, ctx.params.id ?? "");
      if (refund.status === "completed") return json({ refund });
      if (
        refund.method !== "manual" ||
        refund.status !== "pending" ||
        !refund.manual
      ) {
        throw fail(
          409,
          "REFUND_TRANSITION_NOT_ALLOWED",
          "Only a pending manual refund can be completed.",
          {
            status: refund.status,
            method: refund.method,
          },
        );
      }
      refund.manual.paidAt = input.paidAt
        ? iso(Date.parse(input.paidAt))
        : iso(ctx.now);
      if (input.reference !== undefined)
        refund.manual.reference = input.reference;
      completeRefund(
        ctx.db,
        refund,
        "admin",
        ctx.admin.id,
        input.note ?? null,
        ctx.now,
      );
      return json({ refund });
    },
  );

  router.post(
    `${refunds}/:id/cancel`,
    { permission: "payments.manage" },
    async (ctx) => {
      const input = await ctx.body(z.strictObject({ note: zNote(1000) }));
      const refund = refundById(ctx.db, ctx.params.id ?? "");
      if (refund.status !== "pending" && refund.status !== "failed") {
        throw fail(
          409,
          "REFUND_TRANSITION_NOT_ALLOWED",
          "Only a pending or failed refund can be withdrawn.",
          {
            status: refund.status,
            method: refund.method,
          },
        );
      }
      moveRefund(
        refund,
        "cancelled",
        "admin",
        ctx.admin.id,
        input.note ?? null,
        ctx.now,
      );
      return json({ refund });
    },
  );

  router.post(
    `${refunds}/:id/sync`,
    { permission: "payments.manage" },
    (ctx) => {
      const refund = refundById(ctx.db, ctx.params.id ?? "");
      if (!ctx.db.config.stripe) {
        throw fail(
          503,
          "PAYMENTS_NOT_CONFIGURED",
          "Online payment is not set up.",
        );
      }
      // The stand-in for Stripe says "succeeded" when it is asked.
      if (
        refund.method === "stripe" &&
        (refund.status === "processing" || refund.status === "failed") &&
        refund.stripe
      ) {
        refund.stripe.stripeStatus = "succeeded";
        refund.stripe.failureReason = null;
        completeRefund(
          ctx.db,
          refund,
          "stripe",
          null,
          "Stripe: succeeded",
          ctx.now,
        );
      }
      return json({ refund });
    },
  );

  // --- Invoices and credit notes (12) ---------------------------------------
  const invoices = "/v1/admin/invoices";

  const invoiceById = (db: Db, id: string): InvoiceDetail => {
    const invoice = db.invoices.find((entry) => entry.id === id);
    if (!invoice)
      throw fail(404, "INVOICE_NOT_FOUND", "The document was not found.");
    return invoice;
  };

  router.get(invoices, { permission: "payments.read" }, (ctx) => {
    const type = enumParam(ctx.query, "type", [
      "invoice",
      "credit_note",
    ] as const);
    const customerId = idParam(ctx.query, "customerId");
    const orderNumber = ctx.query.get("orderNumber")?.trim().toUpperCase();
    // One document by its number, or the beginning of a number (12).
    const number = ctx.query.get("number")?.trim().toUpperCase();
    if (number && !/^(INV|CN)-\d{4}-\d{6}$/.test(number)) {
      throw validationFailed([
        {
          field: "number",
          problems: ["number must look like INV-2026-000123 or CN-2026-000007"],
        },
      ]);
    }
    const prefix = number
      ? undefined
      : ctx.query.get("q")?.trim().toUpperCase();
    const rows = ctx.db.invoices.filter(
      (invoice) =>
        (!type || invoice.type === type) &&
        (!customerId || invoice.customerId === customerId) &&
        (!orderNumber || invoice.orderNumber === orderNumber) &&
        (!number || invoice.number === number) &&
        (!prefix || invoice.number.startsWith(prefix)),
    );
    const result = cursorPage(rows, ctx.query);
    return json({ ...result, items: result.items.map(invoiceSummary) });
  });

  router.get(`${invoices}/:id`, { permission: "payments.read" }, (ctx) =>
    json({ invoice: invoiceById(ctx.db, ctx.params.id ?? "") }),
  );

  router.get(`${invoices}/:id/pdf`, { permission: "payments.read" }, (ctx) => {
    const invoice = invoiceById(ctx.db, ctx.params.id ?? "");
    return new Response(invoicePdf(invoice) as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${invoice.number}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  });
}
