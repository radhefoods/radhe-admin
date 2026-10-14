// The rules the mock shares between its seed data and its routes: bills,
// invoices, messages, and how stored records become the API's objects.

import type {
  CargoStatus,
  InvoiceDetail,
  InvoiceSummary,
  NotificationChannel,
  NotificationDetail,
  NotificationType,
  OrderStatus,
  PaymentBlock,
  PaymentStatus,
  PriceView,
  ProductDetail,
  ProductSummary,
  SettableOrderStatus,
  Totals,
  Category,
  Cargo,
  CargoDetail,
  OrderDetail,
  OrderSummary,
  CargoAttention,
  Customer,
} from "../src/lib/api/types/index.ts";
import type {
  CargoRecord,
  CategoryRecord,
  Db,
  OrderRecord,
  ProductRecord,
} from "./db.ts";
import { newId } from "./http.ts";
import { berlinDay, deadlineAfterDays, iso, nextReminder } from "./time.ts";

// --- State machines (9.1, 10.1) ---------------------------------------------

export const CARGO_ALLOWED: Record<CargoStatus, CargoStatus[]> = {
  draft: ["scheduled", "taking_orders", "cancelled"],
  scheduled: ["draft", "taking_orders", "cancelled"],
  taking_orders: ["orders_closed", "cancelled"],
  orders_closed: ["taking_orders", "in_transit", "cancelled"],
  in_transit: ["orders_closed", "arrived", "cancelled"],
  arrived: ["in_transit", "delivering"],
  delivering: ["arrived", "delivered"],
  delivered: ["delivering"],
  cancelled: [],
};

export const ORDER_ALLOWED: Record<OrderStatus, SettableOrderStatus[]> = {
  confirmed: ["preparing", "dispatched"],
  preparing: ["confirmed", "dispatched"],
  dispatched: ["preparing", "delivered", "delivery_failed"],
  delivery_failed: ["dispatched", "delivered"],
  delivered: ["dispatched"],
  returned: [],
  cancelled: [],
};

export const CANCELLABLE: OrderStatus[] = [
  "confirmed",
  "preparing",
  "dispatched",
  "delivery_failed",
];
export const MOVABLE: OrderStatus[] = [
  "confirmed",
  "preparing",
  "delivery_failed",
];
export const CHANGEABLE: OrderStatus[] = [
  "confirmed",
  "preparing",
  "dispatched",
  "delivery_failed",
  "delivered",
];
/** A cargo in one of these can be given orders. */
export const CAN_TAKE_ORDERS: CargoStatus[] = [
  "draft",
  "scheduled",
  "taking_orders",
  "orders_closed",
  "in_transit",
  "arrived",
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

export function productDetail(db: Db, product: ProductRecord): ProductDetail {
  // Whether `DELETE` would succeed now (8), with the reason of a refusal.
  const notDeletableReason =
    product.status === "active"
      ? {
          code: "PRODUCT_IS_ACTIVE" as const,
          message: "Archive the product before deleting it.",
        }
      : db.cargoProducts.some((entry) => entry.productId === product.id)
        ? {
            code: "PRODUCT_IN_USE" as const,
            message: "The product was part of a cargo and cannot be deleted.",
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

// --- Cargos -----------------------------------------------------------------

export function cargoAttention(
  cargo: CargoRecord,
  now: number,
): CargoAttention | null {
  const open = Date.parse(cargo.orderOpenAt);
  const close = Date.parse(cargo.orderCloseAt);
  if (cargo.status === "scheduled" && now >= close) return "window_missed";
  if (cargo.status === "scheduled" && now >= open) return "opening_due";
  if (cargo.status === "taking_orders" && now >= close) return "closing_due";
  return null;
}

export function cargoView(db: Db, cargo: CargoRecord, now: number): Cargo {
  const settings = db.cargoProducts.filter(
    (entry) => entry.cargoId === cargo.id,
  );
  const { statusHistory: _history, ...rest } = cargo;
  return {
    ...rest,
    isAcceptingOrders:
      cargo.status === "taking_orders" &&
      now >= Date.parse(cargo.orderOpenAt) &&
      now < Date.parse(cargo.orderCloseAt),
    attention: cargoAttention(cargo, now),
    allowedStatuses: CARGO_ALLOWED[cargo.status],
    products: {
      total: settings.length,
      enabled: settings.filter((entry) => entry.isEnabled).length,
    },
  };
}

export function cargoDetail(
  db: Db,
  cargo: CargoRecord,
  now: number,
): CargoDetail {
  return { ...cargoView(db, cargo, now), statusHistory: cargo.statusHistory };
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

export function paymentBlock(db: Db, order: OrderRecord): PaymentBlock {
  if (!order.payment) {
    return {
      status: "not_enabled",
      canActivate: order.status === "delivered" && order.finalTotals.total > 0,
    };
  }
  const owing =
    order.paymentStatus === "due" || order.paymentStatus === "overdue";
  const { failedAt: _failedAt, ...payment } = order.payment;
  return {
    ...payment,
    status: order.paymentStatus as Exclude<PaymentStatus, "not_enabled">,
    canActivate: false,
    isOverdue: order.paymentStatus === "overdue",
    canPayOnline: owing && db.config.stripe,
    canRecordCash: owing,
    canWaive: owing,
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
    type: order.type,
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
    cargo: order.cargo,
    total: order.totals.total,
    finalTotal: order.finalTotals.total,
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

export function orderDetail(db: Db, order: OrderRecord): OrderDetail {
  return {
    ...orderSummary(order),
    language: order.language,
    items: order.items,
    totals: order.totals,
    finalTotals: order.finalTotals,
    adjustments: order.adjustments,
    deliveryAddress: order.deliveryAddress,
    note: order.note,
    payment: paymentBlock(db, order),
    canCancel: CANCELLABLE.includes(order.status),
    allowedStatuses: ORDER_ALLOWED[order.status],
    canMove: MOVABLE.includes(order.status),
    cancellation: order.cancellation,
    consent: order.consent,
    statusHistory: order.statusHistory,
    updatedAt: order.updatedAt,
  };
}

export function pushHistory(
  order: OrderRecord,
  entry: {
    field: "order" | "payment" | "cargo" | "delivery" | "delivery_window";
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

/** Releases or takes the units of an order in its cargo. */
export function reserve(
  db: Db,
  order: OrderRecord,
  cargoId: string,
  sign: 1 | -1,
): void {
  for (const item of order.items) {
    let setting = db.cargoProducts.find(
      (entry) =>
        entry.cargoId === cargoId && entry.productId === item.productId,
    );
    if (!setting && sign === 1) {
      setting = {
        cargoId,
        productId: item.productId,
        isEnabled: true,
        maxQuantity: null,
        orderedQuantity: 0,
      };
      db.cargoProducts.push(setting);
    }
    if (setting) {
      setting.orderedQuantity = Math.max(
        0,
        setting.orderedQuantity + sign * item.quantity,
      );
    }
  }
}

// --- Messages (14) ----------------------------------------------------------

const WHATSAPP_TYPES: NotificationType[] = [
  "order_dispatched",
  "payment_request",
  "payment_reminder",
  "announcement",
];

const SUBJECT: Record<NotificationType, [string, string]> = {
  order_confirmed: [
    "Your pre-order {n} is confirmed",
    "Ihre Vorbestellung {n} ist bestätigt",
  ],
  order_cancelled: [
    "Your order {n} was cancelled",
    "Ihre Bestellung {n} wurde storniert",
  ],
  order_moved: [
    "New delivery days for order {n}",
    "Neue Liefertage für Bestellung {n}",
  ],
  delivery_rescheduled: [
    "The delivery of order {n} has new days",
    "Die Lieferung von Bestellung {n} hat neue Tage",
  ],
  order_dispatched: [
    "Your order {n} is on its way",
    "Ihre Bestellung {n} ist unterwegs",
  ],
  order_delivered: [
    "Your order {n} was delivered",
    "Ihre Bestellung {n} wurde geliefert",
  ],
  delivery_failed: [
    "We could not deliver order {n}",
    "Wir konnten Bestellung {n} nicht zustellen",
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
  payment_request: ["Your invoice {i}", "Ihre Rechnung {i}"],
  payment_reminder: [
    "Reminder: invoice {i} is open",
    "Erinnerung: Rechnung {i} ist offen",
  ],
  payment_received: [
    "Payment received for order {n}",
    "Zahlung erhalten für Bestellung {n}",
  ],
  payment_failed: [
    "Your payment did not go through",
    "Ihre Zahlung ist fehlgeschlagen",
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
 * stored as `skipped` and can be retried later (section 19).
 */
export function queueMessage(db: Db, input: MessageInput, now: number): void {
  const { customer, order } = input;
  const locale = order?.language ?? customer.locale;
  const invoiceNumber = order?.payment?.invoice.number ?? "";
  const pattern = SUBJECT[input.type][locale === "de" ? 1 : 0];
  const announcementSubject =
    (locale === "de" ? input.subject?.de : null) ?? input.subject?.en ?? "";
  const subject = pattern
    .replace("{n}", order?.orderNumber ?? "")
    .replace("{i}", invoiceNumber)
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
      cargoId: order?.cargo.id ?? null,
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

// --- Invoices (13) and payment activation (12) ------------------------------

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
 * Activates the payment of a delivered order: the invoice is written from
 * the final bill, the deadline is the end of the chosen day in German time,
 * the first reminder is due the next day at the reminder hour.
 */
export function activatePayment(
  db: Db,
  order: OrderRecord,
  deadlineDays: number,
  adminId: string | null,
  now: number,
): InvoiceDetail {
  const deadline = deadlineAfterDays(deadlineDays, now);
  const language = order.language;
  const invoice: InvoiceDetail = {
    id: newId(now),
    number: nextNumber(db, "invoice", now),
    type: "invoice",
    orderNumber: order.orderNumber,
    issuedAt: iso(now),
    dueAt: deadline,
    paidAt: null,
    total: order.finalTotals.total,
    currency: "EUR",
    language,
    invoiceNumber: null,
    creditReason: null,
    orderId: order.id,
    customerId: order.customer.id,
    cargoId: order.cargo.id,
    deliveredOn: order.delivery.deliveredAt
      ? berlinDay(Date.parse(order.delivery.deliveredAt))
      : null,
    creditReference: null,
    seller: sellerOf(db),
    customer: customerBlock(order),
    lines: [
      ...order.items
        .filter((item) => item.finalLineTotal > 0)
        .map((item) => ({
          description: `${(language === "de" ? item.name.de : null) ?? item.name.en}, ${item.packSize.label}`,
          sku: item.sku,
          quantity: Math.max(0, item.deliveredQuantity - item.returnedQuantity),
          unitPrice: item.unitPrice,
          vatRate: item.vatRate,
          vatPercent: item.vatPercent,
          lineTotal: item.finalLineTotal,
        })),
      ...(order.finalTotals.deliveryFee > 0
        ? [
            {
              description: language === "de" ? "Lieferung" : "Delivery",
              sku: null,
              quantity: 1,
              unitPrice: order.finalTotals.deliveryFee,
              vatRate: order.finalTotals.vat[0]?.vatRate ?? 700,
              vatPercent: (order.finalTotals.vat[0]?.vatRate ?? 700) / 100,
              lineTotal: order.finalTotals.deliveryFee,
            },
          ]
        : []),
    ],
    totals: order.finalTotals,
    footer: db.settings.company.invoiceFooter ?? null,
  };
  db.invoices.push(invoice);

  order.payment = {
    activatedAt: iso(now),
    activatedBy: adminId,
    deadlineDays,
    deadline,
    invoice: { id: invoice.id, number: invoice.number },
    invoicedAmount: invoice.total,
    creditedAmount: 0,
    paidAmount: 0,
    refundedAmount: 0,
    amountDue: invoice.total,
    method: null,
    paidAt: null,
    stripe: null,
    cash: null,
    reminders: {
      nextAt: nextReminder(db.settings.payments.reminderHour, now),
      sentCount: 0,
      lastSentAt: null,
      paused: false,
    },
    waivedReason: null,
    failedAt: null,
  };
  const before = order.paymentStatus;
  order.paymentStatus = "due";
  pushHistory(
    order,
    { field: "payment", from: before, to: "due", adminId },
    now,
  );
  return invoice;
}

/**
 * A credit note after a correction or a return of an invoiced order. What
 * is owed goes down; an unpaid invoice with nothing left is settled by it.
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
  if (!payment || amount <= 0) return null;
  const rate =
    order.finalTotals.vat[0]?.vatRate ?? order.totals.vat[0]?.vatRate ?? 700;
  const totals = totalsOf([{ gross: amount, vatRate: rate }], 0);
  const note: InvoiceDetail = {
    id: newId(now),
    number: nextNumber(db, "creditNote", now),
    type: "credit_note",
    orderNumber: order.orderNumber,
    issuedAt: iso(now),
    dueAt: null,
    paidAt: null,
    total: amount,
    currency: "EUR",
    language: order.language,
    invoiceNumber: payment.invoice.number,
    creditReason: reason,
    orderId: order.id,
    customerId: order.customer.id,
    cargoId: order.cargo.id,
    deliveredOn: null,
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
  payment.amountDue = Math.max(
    0,
    payment.invoicedAmount - payment.creditedAmount - payment.paidAmount,
  );
  pushHistory(
    order,
    {
      field: "payment",
      from: order.paymentStatus,
      to: "credited",
      by: "system",
    },
    now,
  );
  const owing =
    order.paymentStatus === "due" || order.paymentStatus === "overdue";
  if (owing && payment.amountDue === 0) {
    const before = order.paymentStatus;
    order.paymentStatus = "paid";
    payment.method = "credit";
    payment.paidAt = iso(now);
    payment.reminders.nextAt = null;
    pushHistory(
      order,
      { field: "payment", from: before, to: "paid", by: "system" },
      now,
    );
  }
  return note;
}

export function invoiceSummary(invoice: InvoiceDetail): InvoiceSummary {
  return {
    id: invoice.id,
    number: invoice.number,
    type: invoice.type,
    orderNumber: invoice.orderNumber,
    issuedAt: invoice.issuedAt,
    dueAt: invoice.dueAt,
    paidAt: invoice.paidAt,
    total: invoice.total,
    currency: invoice.currency,
    language: invoice.language,
    invoiceNumber: invoice.invoiceNumber,
    creditReason: invoice.creditReason,
  };
}

/** Books a payment of the full amount due. */
export function markPaid(
  db: Db,
  order: OrderRecord,
  method: "cash" | "stripe",
  now: number,
  by: "admin" | "customer" | "system" = "admin",
  adminId: string | null = null,
): void {
  const payment = order.payment;
  if (!payment) return;
  const before = order.paymentStatus;
  payment.paidAmount += payment.amountDue;
  payment.amountDue = 0;
  payment.method = method;
  payment.paidAt = iso(now);
  payment.reminders.nextAt = null;
  order.paymentStatus = "paid";
  const invoice = db.invoices.find((entry) => entry.id === payment.invoice.id);
  if (invoice) invoice.paidAt = iso(now);
  pushHistory(
    order,
    { field: "payment", from: before, to: "paid", by, adminId },
    now,
  );
}

export function customerOf(db: Db, order: OrderRecord): Customer | undefined {
  return db.customers.find((entry) => entry.id === order.customer.id);
}
