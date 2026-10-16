// The rules the mock shares between its seed data and its routes: bills,
// invoices, messages, the payment of an order, and how stored records
// become the API's objects.

import type {
  Category,
  Customer,
  InvoiceDetail,
  InvoiceSummary,
  NotificationChannel,
  NotificationDetail,
  NotificationType,
  OrderDetail,
  OrderStatus,
  OrderSummary,
  PaymentBlock,
  PriceView,
  ProductDetail,
  ProductSummary,
  Refundable,
  SettableOrderStatus,
  Totals,
} from "../src/lib/api/types/index.ts";
import type {
  CategoryRecord,
  Db,
  OrderRecord,
  ProductRecord,
  StockRecord,
} from "./db.ts";
import { newId } from "./http.ts";
import { berlinDay, iso } from "./time.ts";

// --- State machine (9.1) ----------------------------------------------------

/** What the admin can set from each status; a pending order is confirmed by its payment. */
export const ORDER_ALLOWED: Record<OrderStatus, SettableOrderStatus[]> = {
  pending_payment: [],
  confirmed: ["processing", "dispatched"],
  processing: ["confirmed", "dispatched"],
  dispatched: ["processing", "delivered"],
  delivered: ["dispatched"],
  returned: [],
  cancelled: [],
};

export const CANCELLABLE: OrderStatus[] = [
  "pending_payment",
  "confirmed",
  "processing",
  "dispatched",
];
/** Delivery method, tracking and quantity corrections. */
export const CHANGEABLE: OrderStatus[] = [
  "confirmed",
  "processing",
  "dispatched",
  "delivered",
];

// --- Catalogue --------------------------------------------------------------

const PER: Record<string, { per: "kg" | "l" | "pcs"; factor: number }> = {
  g: { per: "kg", factor: 1000 },
  kg: { per: "kg", factor: 1 },
  ml: { per: "l", factor: 1000 },
  l: { per: "l", factor: 1 },
  pcs: { per: "pcs", factor: 1 },
};

export function packLabel(value: number, unit: string): string {
  return `${value} ${unit}`;
}

export function priceView(product: {
  regularPrice: number;
  salePrice: number | null;
  vatRate: number;
  packSize: { value: number; unit: string };
}): PriceView {
  const price = product.salePrice ?? product.regularPrice;
  const onSale = product.salePrice !== null;
  const base = PER[product.packSize.unit];
  return {
    currency: "EUR",
    price,
    regularPrice: product.regularPrice,
    salePrice: product.salePrice,
    onSale,
    discountPercent: onSale
      ? Math.round((1 - price / product.regularPrice) * 100)
      : null,
    discountAmount: onSale ? product.regularPrice - price : null,
    vatIncluded: true,
    vatRate: product.vatRate,
    vatPercent: product.vatRate / 100,
    vatAmount: vatOf(price, product.vatRate),
    basePrice: base
      ? {
          amount: Math.round((price * base.factor) / product.packSize.value),
          per: base.per,
        }
      : null,
  };
}

export function vatOf(gross: number, rate: number): number {
  return Math.round((gross * rate) / (10000 + rate));
}

/** The stock as the API shows it (8): `isLow` needs a threshold. */
export function stockView(stock: StockRecord) {
  return {
    quantity: stock.quantity,
    lowStockThreshold: stock.lowStockThreshold,
    isLow:
      stock.lowStockThreshold !== null &&
      stock.quantity <= stock.lowStockThreshold,
  };
}

function groupOf(db: Db, product: ProductRecord): ProductRecord[] {
  if (!product.variantGroupId) return [];
  return db.products
    .filter((entry) => entry.variantGroupId === product.variantGroupId)
    .sort((a, b) => a.packSize.value - b.packSize.value);
}

export function productSummary(db: Db, product: ProductRecord): ProductSummary {
  const category = db.categories.find(
    (entry) => entry.id === product.categoryId,
  );
  const primary =
    product.images.find((image) => image.isPrimary) ?? product.images[0];
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    category: {
      id: product.categoryId,
      name: category?.name ?? { en: "Unknown" },
    },
    packSize: product.packSize,
    pricing: priceView(product),
    status: product.status,
    isAvailable: product.isAvailable,
    isFeatured: product.isFeatured,
    sortOrder: product.sortOrder,
    stock: stockView(product.stock),
    variantGroupId: product.variantGroupId,
    isDefaultVariant: product.isDefaultVariant,
    packSizeCount: Math.max(1, groupOf(db, product).length),
    imageCount: product.images.length,
    image: primary
      ? {
          id: primary.id,
          alt: primary.alt.en ?? product.name.en,
          isPrimary: true,
          url: primary.url,
          sizes: primary.sizes,
        }
      : null,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

/** Orders that count for "in use": every one that was not cancelled. */
export function productInUse(db: Db, productId: string): number {
  return db.orders.filter(
    (order) =>
      order.status !== "cancelled" &&
      order.items.some((item) => item.productId === productId),
  ).length;
}

export function productDetail(db: Db, product: ProductRecord): ProductDetail {
  // Whether `DELETE` would succeed now (8), with the reason of a refusal.
  const orders = productInUse(db, product.id);
  const notDeletableReason =
    product.status === "active"
      ? {
          code: "PRODUCT_IS_ACTIVE" as const,
          message: "Archive the product before deleting it.",
        }
      : orders > 0
        ? {
            code: "PRODUCT_IN_USE" as const,
            message: `The product cannot be deleted. It is part of ${orders} order(s). Archive it instead.`,
          }
        : null;
  return {
    ...productSummary(db, product),
    deletable: notDeletableReason === null,
    notDeletableReason,
    gtin: product.gtin,
    subtitle: product.subtitle,
    shortDescription: product.shortDescription,
    description: product.description,
    highlights: product.highlights,
    uses: product.uses,
    categoryId: product.categoryId,
    minOrderQuantity: product.minOrderQuantity,
    maxOrderQuantity: product.maxOrderQuantity,
    storageType: product.storageType,
    food: product.food,
    tags: product.tags,
    searchKeywords: product.searchKeywords,
    seo: product.seo,
    images: product.images.map((image, index) => ({
      ...image,
      isPrimary: product.images.some((entry) => entry.isPrimary)
        ? image.isPrimary
        : index === 0,
    })),
    packSizes: groupOf(db, product).map((entry) => ({
      id: entry.id,
      sku: entry.sku,
      packSize: entry.packSize,
      pricing: priceView(entry),
      status: entry.status,
      isAvailable: entry.isAvailable,
      stock: stockView(entry.stock),
      isDefault: entry.isDefaultVariant,
    })),
    publishedAt: product.publishedAt,
  };
}

export function ancestorsOf(db: Db, category: CategoryRecord): string[] {
  const chain: string[] = [];
  let parentId = category.parentId;
  while (parentId) {
    chain.unshift(parentId);
    parentId =
      db.categories.find((entry) => entry.id === parentId)?.parentId ?? null;
  }
  return chain;
}

export function descendantIds(db: Db, id: string): string[] {
  const children = db.categories.filter((entry) => entry.parentId === id);
  return [id, ...children.flatMap((child) => descendantIds(db, child.id))];
}

export function categoryView(db: Db, category: CategoryRecord): Category {
  const ancestorIds = ancestorsOf(db, category);
  const inside = new Set(descendantIds(db, category.id));
  return {
    ...category,
    ancestorIds,
    level: (ancestorIds.length + 1) as 1 | 2 | 3,
    productCount: db.products.filter((product) =>
      inside.has(product.categoryId),
    ).length,
  };
}

/** The flat list in display order: each parent followed by its children. */
export function orderedCategories(
  db: Db,
  parentId: string | null = null,
): CategoryRecord[] {
  return db.categories
    .filter((entry) => entry.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((entry) => [entry, ...orderedCategories(db, entry.id)]);
}

// --- Bills ------------------------------------------------------------------

export function deliveryFeeFor(db: Db, subtotal: number): number {
  const tiers = [...db.settings.deliveryFee.tiers].sort(
    (a, b) => a.minOrderValue - b.minOrderValue,
  );
  let fee = 0;
  for (const tier of tiers) if (subtotal >= tier.minOrderValue) fee = tier.fee;
  return fee;
}

/**
 * The bill of some lines and a delivery fee. The fee carries the VAT rate
 * of the largest share of the goods (the API shares it by net value; the
 * tax adviser still has to confirm that, architecture 15).
 */
export function totalsOf(
  lines: { gross: number; vatRate: number }[],
  deliveryFee: number,
): Totals {
  const byRate = new Map<number, number>();
  for (const line of lines) {
    byRate.set(line.vatRate, (byRate.get(line.vatRate) ?? 0) + line.gross);
  }
  const subtotal = lines.reduce((sum, line) => sum + line.gross, 0);
  if (deliveryFee > 0) {
    const main =
      [...byRate.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 700;
    byRate.set(main, (byRate.get(main) ?? 0) + deliveryFee);
  }
  const vat = [...byRate.entries()]
    .filter(([, gross]) => gross > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([vatRate, gross]) => {
      const tax = vatOf(gross, vatRate);
      return { vatRate, gross, net: gross - tax, vat: tax };
    });
  const vatTotal = vat.reduce((sum, entry) => sum + entry.vat, 0);
  const total = subtotal + deliveryFee;
  return {
    currency: "EUR",
    subtotal,
    deliveryFee,
    total,
    netTotal: total - vatTotal,
    vatTotal,
    vat,
  };
}

/**
 * The final bill: delivered minus returned units at the agreed prices. The
 * agreed delivery fee stays, and is 0 only when nothing was kept.
 */
export function recomputeFinal(order: OrderRecord): void {
  for (const item of order.items) {
    const kept = Math.max(0, item.deliveredQuantity - item.returnedQuantity);
    item.finalLineTotal = kept * item.unitPrice;
  }
  const kept = order.items.some((item) => item.finalLineTotal > 0);
  order.finalTotals = totalsOf(
    order.items.map((item) => ({
      gross: item.finalLineTotal,
      vatRate: item.vatRate,
    })),
    kept ? order.totals.deliveryFee : 0,
  );
}

// --- Orders -----------------------------------------------------------------

/** `refundableAmount` and `needsRefund` of the payment block (11.1). */
export function refundState(order: OrderRecord): {
  refundableAmount: number;
  needsRefund: boolean;
} {
  const payment = order.payment;
  const refundableAmount = Math.max(
    0,
    payment.paidAmount - payment.refundedAmount,
  );
  return {
    refundableAmount,
    needsRefund:
      refundableAmount > 0 &&
      (order.status === "cancelled" ||
        payment.creditedAmount - payment.refundedAmount > 0),
  };
}

export function paymentBlock(
  db: Db,
  order: OrderRecord,
  now: number,
): PaymentBlock {
  const payment = order.payment;
  const invoice = payment.invoiceId
    ? db.invoices.find((entry) => entry.id === payment.invoiceId)
    : undefined;
  const pageOpen =
    order.status === "pending_payment" &&
    payment.checkoutUrl !== null &&
    payment.checkoutExpiresAt !== null &&
    Date.parse(payment.checkoutExpiresAt) > now;
  return {
    status: order.paymentStatus,
    amount: payment.amount,
    paidAmount: payment.paidAmount,
    creditedAmount: payment.creditedAmount,
    refundedAmount: payment.refundedAmount,
    method: payment.paymentType,
    paidAt: payment.paidAt,
    receiptUrl: payment.receiptUrl,
    invoice: invoice
      ? {
          number: invoice.number,
          issuedAt: invoice.issuedAt,
          pdfPath: `/v1/store/invoices/${invoice.number}/pdf`,
        }
      : null,
    checkout: pageOpen
      ? { url: payment.checkoutUrl!, expiresAt: payment.checkoutExpiresAt! }
      : null,
    canPayOnline:
      order.status === "pending_payment" &&
      (order.paymentStatus === "pending" || order.paymentStatus === "failed") &&
      db.config.stripe,
    lastFailure: payment.lastFailure,
    attempts: payment.attempts,
    checkoutSessionId: payment.checkoutSessionId,
    checkoutExpiresAt: payment.checkoutExpiresAt,
    paymentIntentId: payment.paymentIntentId,
    chargeId: payment.chargeId,
    authorizedAt: payment.authorizedAt,
    invoiceId: payment.invoiceId,
    ...refundState(order),
  };
}

/** What can be refunded, and what the cancellation or the credit notes call for (11). */
export function refundableOf(db: Db, order: OrderRecord): Refundable {
  const payment = order.payment;
  const openAmount = db.refunds
    .filter(
      (refund) =>
        refund.orderId === order.id &&
        (refund.status === "pending" || refund.status === "processing"),
    )
    .reduce((sum, refund) => sum + refund.amount, 0);
  const maximum = Math.max(
    0,
    payment.paidAmount - payment.refundedAmount - openAmount,
  );
  const calledFor =
    order.status === "cancelled" ? payment.paidAmount : payment.creditedAmount;
  const suggested = Math.min(
    maximum,
    Math.max(0, calledFor - payment.refundedAmount - openAmount),
  );
  return {
    paidAmount: payment.paidAmount,
    refundedAmount: payment.refundedAmount,
    openAmount,
    maximum,
    suggested,
    // Stripe can refund what it captured, once it is connected (18).
    stripePossible: db.config.stripe && payment.paymentIntentId !== null,
  };
}

const CARRIER_URL: Record<string, (tracking: string) => string> = {
  dhl: (tracking) =>
    `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${tracking}&lang=en`,
  hermes: (tracking) =>
    `https://www.myhermes.de/empfangen/sendungsverfolgung/sendungsinformation#${tracking}`,
};

export function trackingUrl(
  method: string,
  tracking: string | null,
): string | null {
  return tracking && CARRIER_URL[method] ? CARRIER_URL[method](tracking) : null;
}

export function orderSummary(order: OrderRecord): OrderSummary {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    placedAt: order.placedAt,
    // The summary names the customer (0.9).
    customer: {
      ...order.customer,
      name:
        [order.customer.firstName, order.customer.lastName]
          .filter((part) => part && part.trim() !== "")
          .join(" ") || null,
    },
    total: order.totals.total,
    finalTotal: order.finalTotals.total,
    paidAmount: order.payment.paidAmount,
    currency: "EUR",
    lineCount: order.items.length,
    itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    city: order.deliveryAddress.city,
    postalCode: order.deliveryAddress.postalCode,
    delivery: {
      ...order.delivery,
      trackingUrl: trackingUrl(
        order.delivery.method,
        order.delivery.trackingNumber,
      ),
    },
  };
}

export function orderDetail(
  db: Db,
  order: OrderRecord,
  now: number,
): OrderDetail {
  return {
    ...orderSummary(order),
    language: order.language,
    items: order.items,
    totals: order.totals,
    finalTotals: order.finalTotals,
    adjustments: order.adjustments,
    deliveryAddress: order.deliveryAddress,
    note: order.note,
    payment: paymentBlock(db, order, now),
    canCancel: CANCELLABLE.includes(order.status),
    allowedStatuses: ORDER_ALLOWED[order.status],
    cancellation: order.cancellation,
    consent: order.consent,
    statusHistory: order.statusHistory,
    updatedAt: order.updatedAt,
  };
}

export function pushHistory(
  order: OrderRecord,
  entry: {
    field: "order" | "payment" | "delivery";
    from: string | null;
    to: string;
    by?: "customer" | "admin" | "system";
    adminId?: string | null;
    note?: string | null;
  },
  now: number,
): void {
  order.statusHistory.push({
    field: entry.field,
    from: entry.from,
    to: entry.to,
    at: iso(now),
    by: entry.by ?? "admin",
    adminId: entry.adminId ?? null,
    note: entry.note ?? null,
  });
  order.updatedAt = iso(now);
}

/** Whether the money of an order is listed as waiting for a refund (9: `needsRefund`). */
export function orderNeedsRefund(order: OrderRecord): boolean {
  return refundState(order).needsRefund;
}

// --- Messages (13) ----------------------------------------------------------

const WHATSAPP_TYPES: NotificationType[] = ["order_dispatched", "announcement"];

const SUBJECT: Record<NotificationType, [string, string]> = {
  order_confirmed: [
    "Your order {n} is confirmed",
    "Ihre Bestellung {n} ist bestätigt",
  ],
  order_cancelled: [
    "Your order {n} was cancelled",
    "Ihre Bestellung {n} wurde storniert",
  ],
  order_dispatched: [
    "Your order {n} is on its way",
    "Ihre Bestellung {n} ist unterwegs",
  ],
  order_delivered: [
    "Your order {n} was delivered",
    "Ihre Bestellung {n} wurde geliefert",
  ],
  return_requested: [
    "We received your return request",
    "Wir haben Ihre Rücksendeanfrage erhalten",
  ],
  return_approved: [
    "Your return was approved",
    "Ihre Rücksendung wurde genehmigt",
  ],
  return_rejected: ["About your return request", "Zu Ihrer Rücksendeanfrage"],
  return_completed: [
    "Your return is complete",
    "Ihre Rücksendung ist abgeschlossen",
  ],
  payment_failed: [
    "Your payment for order {n} did not go through",
    "Ihre Zahlung für Bestellung {n} ist fehlgeschlagen",
  ],
  refund_completed: [
    "Your refund is on its way",
    "Ihre Erstattung ist unterwegs",
  ],
  announcement: ["{s}", "{s}"],
};

export interface MessageInput {
  type: NotificationType;
  customer: Customer;
  order?: OrderRecord;
  returnId?: string;
  refundId?: string;
  announcementId?: string;
  productId?: string;
  data?: Record<string, unknown>;
  /** For announcements: the chosen channels. */
  channels?: NotificationChannel[];
  attachInvoiceId?: string;
  subject?: { en: string; de?: string | null };
  /** Seeds: how this message ended. Routes send at once. */
  outcome?: "sent" | "failed" | "queued";
  error?: string;
}

/**
 * Queues the message of an event. One record per channel: email always;
 * WhatsApp for the types that have a template, to customers who gave a
 * number and said yes. While WhatsApp is not configured, such a record is
 * stored as `skipped` and can be retried later (section 18).
 */
export function queueMessage(db: Db, input: MessageInput, now: number): void {
  const { customer, order } = input;
  const locale = order?.language ?? customer.locale;
  const pattern = SUBJECT[input.type][locale === "de" ? 1 : 0];
  const announcementSubject =
    (locale === "de" ? input.subject?.de : null) ?? input.subject?.en ?? "";
  const subject = pattern
    .replace("{n}", order?.orderNumber ?? "")
    .replace("{s}", announcementSubject);

  const wantsWhatsapp =
    WHATSAPP_TYPES.includes(input.type) &&
    customer.communication.whatsappOptIn &&
    Boolean(customer.communication.whatsappNumber) &&
    (input.type !== "announcement" ||
      (input.channels ?? []).includes("whatsapp"));
  const channels: NotificationChannel[] = [
    ...(input.type !== "announcement" ||
    (input.channels ?? ["email"]).includes("email")
      ? (["email"] as const)
      : []),
    ...(wantsWhatsapp ? (["whatsapp"] as const) : []),
  ];

  for (const channel of channels) {
    const skipped = channel === "whatsapp" && !db.config.whatsapp;
    const outcome = skipped ? "skipped" : (input.outcome ?? "sent");
    const at = iso(now);
    const record: NotificationDetail = {
      id: newId(now),
      type: input.type,
      channel,
      to:
        channel === "email"
          ? customer.email
          : (customer.communication.whatsappNumber ?? ""),
      customerId: customer.id,
      orderId: order?.id ?? null,
      orderNumber: order?.orderNumber ?? null,
      productId: input.productId ?? null,
      returnId: input.returnId ?? null,
      refundId: input.refundId ?? null,
      announcementId: input.announcementId ?? null,
      locale,
      subject: channel === "email" ? subject : null,
      attachments:
        channel === "email" && input.attachInvoiceId
          ? [{ kind: "invoice_pdf", id: input.attachInvoiceId }]
          : [],
      status: outcome,
      attempts: outcome === "sent" ? 1 : outcome === "failed" ? 6 : 0,
      maxAttempts: 6,
      nextAttemptAt: outcome === "queued" ? at : null,
      sentAt: outcome === "sent" ? at : null,
      providerMessageId:
        outcome === "sent"
          ? channel === "email"
            ? `0100018${newId(now).slice(-12)}@email.amazonses.com`
            : `wamid.${newId(now).slice(-16)}`
          : null,
      lastError:
        outcome === "failed"
          ? (input.error ?? "Provider refused the message.")
          : null,
      reason: skipped ? "WhatsApp is not configured." : null,
      history:
        outcome === "sent"
          ? [{ at, ok: true }]
          : outcome === "failed"
            ? [
                {
                  at,
                  ok: false,
                  error: input.error ?? "Provider refused the message.",
                },
              ]
            : [],
      createdAt: at,
      updatedAt: at,
      data: {
        ...(order
          ? {
              orderNumber: order.orderNumber,
              customerName:
                `${order.customer.firstName ?? ""} ${order.customer.lastName ?? ""}`.trim(),
            }
          : {}),
        ...input.data,
      },
    };
    db.notifications.push(record);
  }
}

// --- Invoices (12) ----------------------------------------------------------

function nextNumber(
  db: Db,
  kind: "invoice" | "creditNote",
  now: number,
): string {
  const year = berlinDay(now).slice(0, 4);
  if (kind === "invoice") {
    db.counters.invoice += 1;
    return `INV-${year}-${String(db.counters.invoice).padStart(6, "0")}`;
  }
  db.counters.creditNote += 1;
  return `CN-${year}-${String(db.counters.creditNote).padStart(6, "0")}`;
}

function sellerOf(db: Db): InvoiceDetail["seller"] {
  const {
    missingForInvoices: _missing,
    logoUrl: _logo,
    invoiceFooter: _footer,
    ...seller
  } = db.settings.company;
  return seller;
}

function customerBlock(order: OrderRecord): InvoiceDetail["customer"] {
  const address = order.deliveryAddress;
  return {
    name: `${address.firstName} ${address.lastName}`,
    company: address.company ?? null,
    addressLines: [
      `${address.street} ${address.houseNumber}`,
      ...(address.additionalLine ? [address.additionalLine] : []),
      `${address.postalCode} ${address.city}`,
    ],
    email: order.customer.email,
  };
}

/** What still blocks invoicing (5). */
export function companyMissing(db: Db) {
  const company = db.settings.company;
  const missing: ("name" | "addressLines" | "email" | "vatId or taxNumber")[] =
    [];
  if (!company.name.trim()) missing.push("name");
  if (company.addressLines.length === 0) missing.push("addressLines");
  if (!company.email.trim()) missing.push("email");
  if (!company.vatId && !company.taxNumber) missing.push("vatId or taxNumber");
  return missing;
}

/**
 * The invoice of a paid order, issued the moment the money is captured
 * (12): from the agreed bill, issued and paid at the same moment.
 */
export function issueInvoice(
  db: Db,
  order: OrderRecord,
  now: number,
): InvoiceDetail {
  const language = order.language;
  const invoice: InvoiceDetail = {
    id: newId(now),
    number: nextNumber(db, "invoice", now),
    type: "invoice",
    orderNumber: order.orderNumber,
    issuedAt: iso(now),
    paidAt: iso(now),
    total: order.totals.total,
    currency: "EUR",
    language,
    invoiceNumber: null,
    creditReason: null,
    orderId: order.id,
    customerId: order.customer.id,
    creditReference: null,
    seller: sellerOf(db),
    customer: customerBlock(order),
    lines: [
      ...order.items.map((item) => ({
        description: `${(language === "de" ? item.name.de : null) ?? item.name.en}, ${item.packSize.label}`,
        sku: item.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate,
        vatPercent: item.vatPercent,
        lineTotal: item.lineTotal,
      })),
      ...(order.totals.deliveryFee > 0
        ? [
            {
              description: language === "de" ? "Lieferung" : "Delivery",
              sku: null,
              quantity: 1,
              unitPrice: order.totals.deliveryFee,
              vatRate: order.totals.vat[0]?.vatRate ?? 700,
              vatPercent: (order.totals.vat[0]?.vatRate ?? 700) / 100,
              lineTotal: order.totals.deliveryFee,
            },
          ]
        : []),
    ],
    totals: order.totals,
    footer: db.settings.company.invoiceFooter ?? null,
  };
  db.invoices.push(invoice);
  order.payment.invoiceId = invoice.id;
  order.payment.invoiceNumber = invoice.number;
  return invoice;
}

/**
 * A credit note after a correction or a return of a paid order (12). The
 * final bill went down; what was paid too much waits for a refund the
 * admin decides (`needsRefund`).
 */
export function issueCreditNote(
  db: Db,
  order: OrderRecord,
  amount: number,
  reason: "return" | "adjustment",
  now: number,
  reference: string | null = null,
): InvoiceDetail | null {
  const payment = order.payment;
  if (!payment.invoiceNumber || amount <= 0) return null;
  const rate =
    order.finalTotals.vat[0]?.vatRate ?? order.totals.vat[0]?.vatRate ?? 700;
  const totals = totalsOf([{ gross: amount, vatRate: rate }], 0);
  const note: InvoiceDetail = {
    id: newId(now),
    number: nextNumber(db, "creditNote", now),
    type: "credit_note",
    orderNumber: order.orderNumber,
    issuedAt: iso(now),
    paidAt: null,
    total: amount,
    currency: "EUR",
    language: order.language,
    invoiceNumber: payment.invoiceNumber,
    creditReason: reason,
    orderId: order.id,
    customerId: order.customer.id,
    creditReference: reference,
    seller: sellerOf(db),
    customer: customerBlock(order),
    lines: [
      {
        description:
          reason === "return"
            ? "Credit for returned goods"
            : "Credit for goods not delivered",
        sku: null,
        quantity: 1,
        unitPrice: amount,
        vatRate: rate,
        vatPercent: rate / 100,
        lineTotal: amount,
      },
    ],
    totals,
    footer: db.settings.company.invoiceFooter ?? null,
  };
  db.invoices.push(note);
  payment.creditedAmount += amount;
  pushHistory(
    order,
    {
      field: "payment",
      from: order.paymentStatus,
      to: "credited",
      by: "system",
      note: note.number,
    },
    now,
  );
  return note;
}

export function invoiceSummary(invoice: InvoiceDetail): InvoiceSummary {
  return {
    id: invoice.id,
    number: invoice.number,
    type: invoice.type,
    orderNumber: invoice.orderNumber,
    issuedAt: invoice.issuedAt,
    paidAt: invoice.paidAt,
    total: invoice.total,
    currency: invoice.currency,
    language: invoice.language,
    invoiceNumber: invoice.invoiceNumber,
    creditReason: invoice.creditReason,
  };
}

export function customerOf(db: Db, order: OrderRecord): Customer | undefined {
  return db.customers.find((entry) => entry.id === order.customer.id);
}
