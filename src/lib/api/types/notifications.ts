// Sections 14 (notifications) and 15 (announcements).

import type {
  AdminRef,
  CursorQuery,
  CustomerRef,
  Id,
  IsoDateTime,
  Locale,
  SortParam,
  Translated,
  TranslatedOptional,
} from "./common";

export const NOTIFICATION_TYPES = [
  "order_confirmed",
  "order_cancelled",
  "order_moved",
  "delivery_rescheduled",
  "order_dispatched",
  "order_delivered",
  "delivery_failed",
  "return_requested",
  "return_approved",
  "return_rejected",
  "return_completed",
  "payment_request",
  "payment_reminder",
  "payment_received",
  "payment_failed",
  "refund_completed",
  "announcement",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The types that are also sent by WhatsApp (14.1). */
export const WHATSAPP_NOTIFICATION_TYPES: readonly NotificationType[] = [
  "order_dispatched",
  "payment_request",
  "payment_reminder",
  "announcement",
];

export const NOTIFICATION_CHANNELS = ["email", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_STATUSES = [
  "queued",
  "sending",
  "sent",
  "failed",
  "skipped",
  "cancelled",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** 14.2. */
export interface Notification {
  id: Id;
  type: NotificationType;
  channel: NotificationChannel;
  /** The email address or the WhatsApp number. */
  to: string;
  customerId: Id | null;
  customer?: CustomerRef | null;
  orderId: Id | null;
  orderNumber: string | null;
  cargoId: Id | null;
  productId: Id | null;
  returnId: Id | null;
  refundId: Id | null;
  announcementId: Id | null;
  locale: Locale;
  /** Emails only. */
  subject: string | null;
  attachments: { kind: string; id: Id }[];
  status: NotificationStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: IsoDateTime | null;
  sentAt: IsoDateTime | null;
  providerMessageId: string | null;
  lastError: string | null;
  /** Explains a `skipped` or `cancelled` record. */
  reason: string | null;
  history: { at: IsoDateTime; ok: boolean; error?: string }[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

/** The detail adds the values the message was rendered from. */
export interface NotificationDetail extends Notification {
  data: Record<string, unknown>;
}

export const NOTIFICATION_SORT_FIELDS = [
  "createdAt",
  "status",
  "type",
  "channel",
] as const;
export type NotificationSortField = (typeof NOTIFICATION_SORT_FIELDS)[number];

export interface NotificationQuery extends CursorQuery {
  status?: NotificationStatus;
  type?: NotificationType;
  channel?: NotificationChannel;
  customerId?: Id;
  orderId?: Id;
  orderNumber?: string;
  announcementId?: Id;
  /** Default `createdAt:desc`. */
  sort?: SortParam<NotificationSortField>;
}

export type NotificationCounts = Record<NotificationStatus, number>;

export interface NotificationSummary {
  counts: NotificationCounts;
  whatsappEnabled: boolean;
}

export interface NotificationRunResult {
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  recovered: number;
}

// --- Announcements (15) -----------------------------------------------------

export interface Announcement {
  id: Id;
  subject: Translated;
  message: Translated;
  link: string | null;
  linkLabel: TranslatedOptional | null;
  productId: Id | null;
  productName: string | null;
  cargoId: Id | null;
  cargoCode: string | null;
  channels: NotificationChannel[];
  recipients: number;
  queued: number;
  createdBy: Id | null;
  createdByAdmin?: AdminRef | null;
  cancelledBy?: Id | null;
  cancelledByAdmin?: AdminRef | null;
  cancelledAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  /** In the list: the same counts as the detail (15). */
  progress?: AnnouncementProgress;
}

/** Counts per channel and status, always all keys. */
export type AnnouncementProgress = Record<
  NotificationChannel,
  NotificationCounts
>;

export interface AnnouncementInput {
  subject: Translated;
  message: Translated;
  link?: string;
  linkLabel?: Translated;
  productId?: Id;
  cargoId?: Id;
  /** Default `["email"]`. */
  channels?: NotificationChannel[];
}

export interface AnnouncementPreview {
  recipients: { email: number; whatsapp: number };
  whatsappEnabled: boolean;
  link: string;
  channels: NotificationChannel[];
  email: Partial<Record<Locale, { subject: string; html: string }>>;
  whatsapp?: Partial<
    Record<
      Locale,
      { name: string; languageCode: string; bodyParameters: string[] }
    >
  >;
}

export interface AnnouncementWithProgress {
  announcement: Announcement;
  progress: AnnouncementProgress;
}

export interface AnnouncementQuery extends CursorQuery {
  productId?: Id;
  cargoId?: Id;
}
