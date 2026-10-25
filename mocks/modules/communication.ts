// Sections 13 (notifications), 14 (announcements) and 15 (attention).

import { z } from "zod";
import type {
  Announcement,
  AnnouncementProgress,
  Customer,
  NotificationChannel,
  NotificationDetail,
  NotificationStatus,
} from "../../src/lib/api/types/index.ts";
import type { Db } from "../db.ts";
import { quotationAttention } from "./quotations.ts";
import {
  orderNeedsRefund,
  orderSummary,
  productSummary,
  queueMessage,
  stockOverview,
} from "../domain.ts";
import {
  cursorPage,
  enumParam,
  fail,
  idParam,
  json,
  newId,
  sortedCursorPage,
  zId,
  zNote,
  zTranslated,
} from "../http.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";

const STATUSES = [
  "queued",
  "sending",
  "sent",
  "failed",
  "skipped",
  "cancelled",
] as const;
const CHANNELS = ["email", "whatsapp"] as const;
const TYPES = [
  "order_confirmed",
  "order_cancelled",
  "order_dispatched",
  "order_delivered",
  "return_requested",
  "return_approved",
  "return_rejected",
  "return_completed",
  "payment_failed",
  "refund_completed",
  "announcement",
] as const;
const WHATSAPP_TYPES = ["order_dispatched", "announcement"];

function emptyCounts(): Record<NotificationStatus, number> {
  return {
    queued: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  };
}

function notificationById(db: Db, id: string): NotificationDetail {
  const found = db.notifications.find((entry) => entry.id === id);
  if (!found)
    throw fail(404, "NOTIFICATION_NOT_FOUND", "The message was not found.");
  return found;
}

function withoutData({ data: _data, ...rest }: NotificationDetail) {
  return rest;
}

/** The stand-in for the provider: every message is accepted. */
function deliver(record: NotificationDetail, now: number): void {
  record.status = "sent";
  record.attempts += 1;
  record.sentAt = iso(now);
  record.nextAttemptAt = null;
  record.lastError = null;
  record.reason = null;
  record.providerMessageId =
    record.channel === "email"
      ? `0100018${newId(now).slice(-12)}@email.amazonses.com`
      : `wamid.${newId(now).slice(-16)}`;
  record.history.push({ at: iso(now), ok: true });
  record.updatedAt = iso(now);
}

function progressOf(db: Db, announcementId: string): AnnouncementProgress {
  const progress = { email: emptyCounts(), whatsapp: emptyCounts() };
  for (const record of db.notifications) {
    if (record.announcementId === announcementId)
      progress[record.channel][record.status] += 1;
  }
  return progress;
}

const announcementBody = z.strictObject({
  subject: zTranslated(160),
  message: z.strictObject({
    en: z.string().min(1).max(2000),
    de: z.string().max(2000).nullish(),
  }),
  link: z.url().max(500).optional(),
  linkLabel: zTranslated(80).optional(),
  productId: zId.optional(),
  channels: z.array(z.enum(CHANNELS)).min(1).max(2).optional(),
});
type AnnouncementBody = z.output<typeof announcementBody>;

function recipientsOf(db: Db): Customer[] {
  return db.customers.filter(
    (customer) =>
      customer.status === "active" && customer.communication.marketingOptIn,
  );
}

function resolveAnnouncement(db: Db, input: AnnouncementBody) {
  const product = input.productId
    ? db.products.find((entry) => entry.id === input.productId)
    : undefined;
  if (input.productId && !product) {
    throw fail(404, "PRODUCT_NOT_FOUND", "The product was not found.");
  }
  const shop = "https://www.radhefoods.de";
  const channels = [
    ...new Set<NotificationChannel>(input.channels ?? ["email"]),
  ];
  return {
    product,
    channels,
    link:
      input.link ?? (product ? `${shop}/products/${product.slug.en}` : shop),
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailHtml(
  subject: string,
  message: string,
  link: string,
  label: string,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;background:#f5f7fb;font-family:Segoe UI,Arial,sans-serif;color:#0a1233">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #dfe4ee;border-radius:12px">
<tr><td style="padding:28px 32px 8px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#545d7a">Radhe Foods</td></tr>
<tr><td style="padding:0 32px;font-family:Georgia,serif;font-size:26px;line-height:1.2">${escapeHtml(subject)}</td></tr>
<tr><td style="padding:16px 32px 8px;font-size:15px;line-height:1.6;white-space:pre-line">${escapeHtml(message)}</td></tr>
<tr><td style="padding:16px 32px 28px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1a45cc;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:8px">${escapeHtml(label)}</a></td></tr>
<tr><td style="padding:16px 32px 24px;border-top:1px solid #dfe4ee;font-size:12px;color:#69718e">You receive this because you asked for news from Radhe Foods. <a href="https://www.radhefoods.de/unsubscribe/demo" style="color:#69718e">Unsubscribe</a></td></tr>
</table></td></tr></table></body></html>`;
}

export function registerCommunication(router: Router): void {
  const notifications = "/v1/admin/notifications";

  const filteredNotifications = (ctx: { db: Db; query: URLSearchParams }) => {
    const status = enumParam(ctx.query, "status", STATUSES);
    const type = enumParam(ctx.query, "type", TYPES);
    const channel = enumParam(ctx.query, "channel", CHANNELS);
    const customerId = idParam(ctx.query, "customerId");
    const orderId = idParam(ctx.query, "orderId");
    const announcementId = idParam(ctx.query, "announcementId");
    const quotationId = idParam(ctx.query, "quotationId");
    const orderNumber = ctx.query.get("orderNumber")?.trim().toUpperCase();
    return ctx.db.notifications.filter(
      (entry) =>
        (!status || entry.status === status) &&
        (!type || entry.type === type) &&
        (!channel || entry.channel === channel) &&
        (!customerId || entry.customerId === customerId) &&
        (!orderId || entry.orderId === orderId) &&
        (!announcementId || entry.announcementId === announcementId) &&
        (!quotationId || entry.quotationId === quotationId) &&
        (!orderNumber || entry.orderNumber === orderNumber),
    );
  };

  router.get(
    `${notifications}/count`,
    { permission: "notifications.read" },
    (ctx) => json({ total: filteredNotifications(ctx).length }),
  );

  router.get(notifications, { permission: "notifications.read" }, (ctx) => {
    const rows = filteredNotifications(ctx);
    const result = sortedCursorPage(rows, ctx.query, {
      createdAt: (entry) => entry.createdAt,
      status: (entry) => entry.status,
      type: (entry) => entry.type,
      channel: (entry) => entry.channel,
    });
    return json({ ...result, items: result.items.map(withoutData) });
  });

  router.get(
    `${notifications}/summary`,
    { permission: "notifications.read" },
    (ctx) => {
      const counts = emptyCounts();
      for (const record of ctx.db.notifications) counts[record.status] += 1;
      return json({ counts, whatsappEnabled: ctx.db.config.whatsapp });
    },
  );

  router.post(
    `${notifications}/run`,
    { permission: "notifications.manage" },
    (ctx) => {
      const result = {
        sent: 0,
        retried: 0,
        failed: 0,
        skipped: 0,
        recovered: 0,
      };
      for (const record of ctx.db.notifications) {
        if (record.status !== "queued") continue;
        if (record.attempts > 0) result.retried += 1;
        deliver(record, ctx.now);
        result.sent += 1;
      }
      return json(result);
    },
  );

  router.get(
    `${notifications}/:id`,
    { permission: "notifications.read" },
    (ctx) =>
      json({ notification: notificationById(ctx.db, ctx.params.id ?? "") }),
  );

  router.post(
    `${notifications}/:id/retry`,
    { permission: "notifications.manage" },
    (ctx) => {
      const record = notificationById(ctx.db, ctx.params.id ?? "");
      const refuse = (message: string) =>
        fail(409, "NOTIFICATION_TRANSITION_NOT_ALLOWED", message);
      if (!["failed", "skipped", "cancelled"].includes(record.status)) {
        throw refuse(
          "Only a failed, skipped or cancelled message can be sent again.",
        );
      }
      if (record.channel === "whatsapp") {
        if (!ctx.db.config.whatsapp)
          throw refuse("WhatsApp is not configured.");
        if (!WHATSAPP_TYPES.includes(record.type)) {
          throw refuse("This type of message has no WhatsApp template.");
        }
      }
      // A full round of attempts begins; the mock's provider accepts at once.
      record.attempts = 0;
      record.status = "queued";
      deliver(record, ctx.now);
      return json({ notification: withoutData(record) });
    },
  );

  router.post(
    `${notifications}/:id/cancel`,
    { permission: "notifications.manage" },
    async (ctx) => {
      const input = await ctx.body(z.strictObject({ reason: zNote(500) }));
      const record = notificationById(ctx.db, ctx.params.id ?? "");
      if (record.status !== "queued") {
        throw fail(
          409,
          "NOTIFICATION_TRANSITION_NOT_ALLOWED",
          "Only a queued message can be withdrawn.",
        );
      }
      record.status = "cancelled";
      record.nextAttemptAt = null;
      record.reason = input.reason ?? "Cancelled by an admin.";
      record.updatedAt = iso(ctx.now);
      return json({ notification: withoutData(record) });
    },
  );

  // --- Announcements (14) ---------------------------------------------------
  const announcements = "/v1/admin/announcements";

  router.post(
    `${announcements}/preview`,
    { permission: "notifications.manage" },
    async (ctx) => {
      const input = await ctx.body(announcementBody);
      const { channels, link } = resolveAnnouncement(ctx.db, input);
      const recipients = recipientsOf(ctx.db);
      const label = {
        en: input.linkLabel?.en ?? "Visit the shop",
        de: input.linkLabel?.de ?? "Zum Shop",
      };
      const text = {
        en: { subject: input.subject.en, message: input.message.en },
        de: {
          subject: input.subject.de || input.subject.en,
          message: input.message.de || input.message.en,
        },
      };
      return json({
        recipients: {
          email: channels.includes("email") ? recipients.length : 0,
          whatsapp: channels.includes("whatsapp")
            ? recipients.filter(
                (customer) => customer.communication.whatsappOptIn,
              ).length
            : 0,
        },
        whatsappEnabled: ctx.db.config.whatsapp,
        link,
        channels,
        email: {
          en: {
            subject: text.en.subject,
            html: emailHtml(text.en.subject, text.en.message, link, label.en),
          },
          de: {
            subject: text.de.subject,
            html: emailHtml(text.de.subject, text.de.message, link, label.de),
          },
        },
        whatsapp: {
          en: {
            name: "radhe_announcement",
            languageCode: "en",
            bodyParameters: ["Anna", text.en.message, link],
          },
          de: {
            name: "radhe_announcement",
            languageCode: "de",
            bodyParameters: ["Anna", text.de.message, link],
          },
        },
      });
    },
  );

  router.post(
    announcements,
    { permission: "notifications.manage" },
    async (ctx) => {
      const input = await ctx.body(announcementBody);
      const { product, channels, link } = resolveAnnouncement(ctx.db, input);
      const recipients = recipientsOf(ctx.db);
      if (recipients.length === 0) {
        throw fail(
          409,
          "ANNOUNCEMENT_NO_RECIPIENTS",
          "No customer has asked for news yet.",
        );
      }
      const id = newId(ctx.now);
      const before = ctx.db.notifications.length;
      for (const customer of recipients) {
        queueMessage(
          ctx.db,
          {
            type: "announcement",
            customer,
            announcementId: id,
            productId: product?.id,
            channels,
            subject: input.subject,
            data: { message: input.message, link },
            // Queued first: an announcement can be withdrawn while it waits.
            outcome: "queued",
          },
          ctx.now,
        );
      }
      const announcement: Announcement = {
        id,
        subject: input.subject,
        message: { en: input.message.en, de: input.message.de ?? null },
        link,
        linkLabel: input.linkLabel ?? null,
        productId: product?.id ?? null,
        productName: product?.name.en ?? null,
        channels,
        recipients: recipients.length,
        queued: ctx.db.notifications.length - before,
        createdBy: ctx.admin.id,
        cancelledAt: null,
        createdAt: iso(ctx.now),
      };
      ctx.db.announcements.push(announcement);
      return json({ announcement, progress: progressOf(ctx.db, id) }, 201);
    },
  );

  router.get(announcements, { permission: "notifications.read" }, (ctx) => {
    const productId = idParam(ctx.query, "productId");
    const rows = ctx.db.announcements.filter(
      (entry) => !productId || entry.productId === productId,
    );
    const result = cursorPage(rows, ctx.query);
    // Each item carries its progress, counted for the page (15).
    return json({
      ...result,
      items: result.items.map((entry) => ({
        ...entry,
        progress: progressOf(ctx.db, entry.id),
      })),
    });
  });

  const announcementById = (db: Db, id: string): Announcement => {
    const found = db.announcements.find((entry) => entry.id === id);
    if (!found)
      throw fail(
        404,
        "ANNOUNCEMENT_NOT_FOUND",
        "The announcement was not found.",
      );
    return found;
  };

  router.get(
    `${announcements}/:id`,
    { permission: "notifications.read" },
    (ctx) => {
      const announcement = announcementById(ctx.db, ctx.params.id ?? "");
      return json({
        announcement,
        progress: progressOf(ctx.db, announcement.id),
      });
    },
  );

  router.post(
    `${announcements}/:id/cancel`,
    { permission: "notifications.manage" },
    (ctx) => {
      const announcement = announcementById(ctx.db, ctx.params.id ?? "");
      for (const record of ctx.db.notifications) {
        if (
          record.announcementId === announcement.id &&
          record.status === "queued"
        ) {
          record.status = "cancelled";
          record.nextAttemptAt = null;
          record.reason = "The announcement was cancelled.";
          record.updatedAt = iso(ctx.now);
        }
      }
      announcement.cancelledAt ??= iso(ctx.now);
      return json({
        announcement,
        progress: progressOf(ctx.db, announcement.id),
      });
    },
  );

  // --- Attention (15) -------------------------------------------------------

  router.get("/v1/admin/attention", { permission: "orders.read" }, (ctx) => {
    const newest = <T extends { id: string }>(rows: T[]) =>
      [...rows].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 5);
    const { db } = ctx;
    const toProcess = db.orders.filter((order) => order.status === "confirmed");
    const needRefund = db.orders.filter((order) => orderNeedsRefund(order));
    const pendingRefunds = db.refunds.filter(
      (refund) => refund.status === "pending",
    );
    const failedRefunds = db.refunds.filter(
      (refund) => refund.status === "failed",
    );
    const requested = db.returns.filter(
      (entry) => entry.status === "requested",
    );
    // Products with a pack size at or below its threshold (15).
    const low = db.products.filter((product) => stockOverview(product).isLow);
    const failedMessages = db.notifications.filter(
      (entry) => entry.status === "failed",
    );
    return json({
      orders: {
        toProcess: toProcess.length,
        items: newest(toProcess).map(orderSummary),
      },
      refunds: {
        needed: needRefund.length,
        orders: newest(needRefund).map(orderSummary),
        pending: pendingRefunds.length,
        failed: failedRefunds.length,
        items: newest(pendingRefunds),
      },
      returns: { requested: requested.length, items: newest(requested) },
      stock: {
        low: low.length,
        items: [...low]
          .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
          .slice(0, 5)
          .map((product) => productSummary(db, product)),
      },
      notifications: {
        failed: failedMessages.length,
        queued: db.notifications.filter((entry) => entry.status === "queued")
          .length,
        items: newest(failedMessages).map(withoutData),
      },
      quotations: quotationAttention(db),
    });
  });
}
