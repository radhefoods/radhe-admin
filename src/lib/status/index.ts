import type {
  AdminStatus,
  BannerStatus,
  CustomerStatus,
  InvoiceType,
  LegalStatus,
  NotificationStatus,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  RefundStatus,
  ReturnStatus,
} from "@/lib/api/types";

/**
 * One tone, one meaning, across orders, payments, returns, refunds and
 * messages:
 *
 *   neutral    not started, or ended: nothing to do
 *   planned    accepted and waiting for its time
 *   moving     someone or something is working on it
 *   attention  waiting for a person or for money (the colour of time)
 *   success    good, live or done
 *   danger     a problem
 */
export type Tone =
  "neutral" | "planned" | "moving" | "attention" | "success" | "danger";

export interface StatusMeta {
  label: string;
  tone: Tone;
}

/** `pending_payment` reads as `Pending payment`: the API's name, made readable. */
export function humanize(value: string): string {
  const text = value.replace(/_/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function table<K extends string>(
  tones: Record<K, Tone>,
  labels: Partial<Record<K, string>> = {},
): Record<K, StatusMeta> {
  const result = {} as Record<K, StatusMeta>;
  for (const key of Object.keys(tones) as K[]) {
    result[key] = { label: labels[key] ?? humanize(key), tone: tones[key] };
  }
  return result;
}

/**
 * A pending order waits for the customer (neutral); a confirmed one is
 * paid and waits for a person to prepare it (attention).
 */
export const ORDER_STATUS = table<OrderStatus>({
  pending_payment: "neutral",
  confirmed: "attention",
  processing: "moving",
  dispatched: "moving",
  delivered: "success",
  cancelled: "neutral",
  returned: "neutral",
});

export const PAYMENT_STATUS = table<PaymentStatus>({
  pending: "neutral",
  authorized: "moving",
  paid: "success",
  failed: "danger",
  refunded: "neutral",
});

export const RETURN_STATUS = table<ReturnStatus>({
  requested: "attention",
  approved: "planned",
  rejected: "danger",
  completed: "success",
  cancelled: "neutral",
});

export const REFUND_STATUS = table<RefundStatus>({
  pending: "attention",
  processing: "moving",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
});

export const NOTIFICATION_STATUS = table<NotificationStatus>({
  queued: "planned",
  sending: "moving",
  sent: "success",
  failed: "danger",
  skipped: "neutral",
  cancelled: "neutral",
});

export const PRODUCT_STATUS = table<ProductStatus>({
  draft: "neutral",
  active: "success",
  archived: "neutral",
});

export const CUSTOMER_STATUS = table<CustomerStatus>({
  active: "success",
  blocked: "danger",
});

export const ADMIN_STATUS = table<AdminStatus>({
  active: "success",
  disabled: "neutral",
});

export const LEGAL_STATUS = table<LegalStatus>({
  draft: "neutral",
  published: "success",
});

/** A live banner is in the shop; a scheduled one waits for its start. */
export const BANNER_STATUS = table<BannerStatus>({
  live: "success",
  scheduled: "planned",
  expired: "neutral",
  inactive: "neutral",
});

export const INVOICE_TYPE = table<InvoiceType>({
  invoice: "planned",
  credit_note: "moving",
});

export const STATUS_TABLES = {
  order: ORDER_STATUS,
  payment: PAYMENT_STATUS,
  return: RETURN_STATUS,
  refund: REFUND_STATUS,
  notification: NOTIFICATION_STATUS,
  product: PRODUCT_STATUS,
  customer: CUSTOMER_STATUS,
  admin: ADMIN_STATUS,
  legal: LEGAL_STATUS,
  invoiceType: INVOICE_TYPE,
  banner: BANNER_STATUS,
} as const;

export type StatusKind = keyof typeof STATUS_TABLES;

/** A status the panel does not know (a newer API) is shown in grey. */
export function statusMeta(kind: StatusKind, value: string): StatusMeta {
  const known = (STATUS_TABLES[kind] as Record<string, StatusMeta>)[value];
  return known ?? { label: humanize(value), tone: "neutral" };
}

/** `[{ value, label }]` of a status table, for filters. */
export function statusOptions<K extends string>(
  statuses: Record<K, StatusMeta>,
): { value: K; label: string }[] {
  return (Object.keys(statuses) as K[]).map((value) => ({
    value,
    label: statuses[value].label,
  }));
}
