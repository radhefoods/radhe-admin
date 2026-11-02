import type {
  AdminStatus,
  BannerStatus,
  BlogVisibility,
  CustomerStatus,
  DiscountState,
  DiscountUseState,
  InvoiceType,
  IssueStatus,
  LegalStatus,
  NotificationStatus,
  OrderRewardsState,
  OrderStatus,
  PaymentStatus,
  ProductStatus,
  QuotationStatus,
  ReferralStatus,
  RefundStatus,
  ReturnStatus,
  ReviewStatus,
  RewardTransactionState,
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

/** A deleted account was closed by the customer: nothing to do, grey (4). */
export const CUSTOMER_STATUS = table<CustomerStatus>(
  { active: "success", blocked: "danger", deleted: "neutral" },
  { deleted: "Deleted account" },
);

/**
 * An open report waits for a person; one in review is being looked at;
 * resolved is done; rejected and cancelled are over (29).
 */
export const ISSUE_STATUS = table<IssueStatus>({
  open: "attention",
  in_review: "moving",
  resolved: "success",
  rejected: "neutral",
  cancelled: "neutral",
});

/** A pending review waits for a person; a published one is in the shop (28). */
export const REVIEW_STATUS = table<ReviewStatus>({
  pending: "attention",
  published: "success",
  rejected: "neutral",
});

/** Registered waits for the first delivered order; qualified counts; void does not (27). */
export const REFERRAL_STATUS = table<ReferralStatus>({
  registered: "planned",
  qualified: "success",
  void: "neutral",
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

/** A scheduled post is published with a date in the future: the shop shows it then. */
export const BLOG_VISIBILITY = table<BlogVisibility>({
  draft: "neutral",
  scheduled: "planned",
  published: "success",
});

/**
 * A new request waits for a person to price it; a draft is being priced;
 * a sent quotation waits for the customer's answer (24).
 */
export const QUOTATION_STATUS = table<QuotationStatus>({
  new: "attention",
  draft: "moving",
  sent: "planned",
  accepted: "success",
  declined: "neutral",
  cancelled: "neutral",
});

/**
 * A code the shop takes right now is active; a scheduled one waits for
 * its start; expired and exhausted ones are over; inactive is switched off (26).
 */
export const DISCOUNT_STATE = table<DiscountState>({
  active: "success",
  scheduled: "planned",
  expired: "neutral",
  exhausted: "neutral",
  inactive: "neutral",
});

/** A use waits for the payment, counted once paid, given back when the order was given up unpaid. */
export const DISCOUNT_USE_STATE = table<DiscountUseState>(
  { reserved: "attention", used: "success", released: "neutral" },
  {
    reserved: "Waiting for payment",
    used: "Paid",
    released: "Given up unpaid",
  },
);

export const INVOICE_TYPE = table<InvoiceType>({
  invoice: "planned",
  credit_note: "moving",
});

/** A row of the coin ledger (30): a redemption waits for the payment, the rest is done. */
export const REWARD_TRANSACTION_STATE = table<RewardTransactionState>(
  {
    done: "success",
    reserved: "attention",
    spent: "success",
    released: "neutral",
  },
  {
    done: "Done",
    reserved: "Waiting for payment",
    spent: "Spent",
    released: "Given back",
  },
);

/** The coins redeemed on an order (30), like the use of a discount code. */
export const REWARD_USE_STATE = table<OrderRewardsState>(
  { reserved: "attention", used: "success", released: "neutral" },
  {
    reserved: "Waiting for payment",
    used: "Spent",
    released: "Given back unpaid",
  },
);

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
  blogPost: BLOG_VISIBILITY,
  quotation: QUOTATION_STATUS,
  discount: DISCOUNT_STATE,
  discountUse: DISCOUNT_USE_STATE,
  issue: ISSUE_STATUS,
  review: REVIEW_STATUS,
  referral: REFERRAL_STATUS,
  rewardTransaction: REWARD_TRANSACTION_STATE,
  rewardUse: REWARD_USE_STATE,
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
