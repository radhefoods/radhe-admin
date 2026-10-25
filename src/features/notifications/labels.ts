import {
  NOTIFICATION_TYPES,
  WHATSAPP_NOTIFICATION_TYPES,
  type Notification,
  type NotificationChannel,
  type NotificationStatus,
  type NotificationType,
} from "@/lib/api/types";
import { humanize } from "@/lib/status";

// The words of the notifications log, and the pure rules behind its
// buttons and its "rendered from" table.

export const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  email: "Email",
  whatsapp: "WhatsApp",
};

/** The types whose API name does not read well on its own (24). */
const TYPE_LABELS: Partial<Record<NotificationType, string>> = {
  quotation_received: "Quotation request received",
  quotation_request_admin: "New quotation request (to the shop)",
  quotation_sent: "Quotation sent",
};

/** `order_dispatched` reads as `Order dispatched`: the API's name, made readable. */
export function typeLabel(type: string): string {
  return TYPE_LABELS[type as NotificationType] ?? humanize(type);
}

export const TYPE_OPTIONS = NOTIFICATION_TYPES.map((value) => ({
  value,
  label: typeLabel(value),
}));

export const CHANNEL_OPTIONS = (
  Object.keys(CHANNEL_LABEL) as NotificationChannel[]
).map((value) => ({ value, label: CHANNEL_LABEL[value] }));

/** What each status means, for the summary and the detail page (14.1). */
export const STATUS_MEANING: Record<NotificationStatus, string> = {
  queued: "Waiting to go out, or due for another attempt.",
  sending: "Being handed to the provider right now.",
  sent: "Accepted by the provider.",
  failed: "Given up: the provider refused it, or six attempts failed.",
  skipped: "Not sent on purpose, for example while WhatsApp is not configured.",
  cancelled: "Withdrawn by an admin before it went out.",
};

/** The statuses a message can be sent again from (14: retry). */
export const RETRYABLE: readonly NotificationStatus[] = [
  "failed",
  "skipped",
  "cancelled",
];

export function canRetry(status: NotificationStatus): boolean {
  return RETRYABLE.includes(status);
}

/** Only a queued message can be withdrawn (14: cancel). */
export function canCancel(status: NotificationStatus): boolean {
  return status === "queued";
}

/**
 * Why a retry cannot work right now although the status allows it (14:
 * `409 NOTIFICATION_TRANSITION_NOT_ALLOWED`): a WhatsApp message while
 * WhatsApp is not configured, or a type that has no WhatsApp template.
 * `whatsappEnabled` is `undefined` while the summary is still loading.
 */
export function retryBlocked(
  message: Pick<Notification, "channel" | "type">,
  whatsappEnabled: boolean | undefined,
): string | null {
  if (message.channel !== "whatsapp") return null;
  if (!WHATSAPP_NOTIFICATION_TYPES.includes(message.type as NotificationType)) {
    return "Messages of this type have no WhatsApp template: it cannot be sent by WhatsApp.";
  }
  if (whatsappEnabled === false) {
    return "WhatsApp is not configured yet. The message can be sent once it is.";
  }
  return null;
}

/** What the API's refusal of a retry or a cancellation means for this message. */
export function refusalText(
  action: "retry" | "cancel",
  message: Pick<Notification, "channel" | "type">,
  whatsappEnabled: boolean | undefined,
): string {
  if (action === "cancel") {
    return "Only a queued message can be withdrawn. This one has left the queue in the meantime: it was sent, or it ended another way.";
  }
  return (
    retryBlocked(message, whatsappEnabled) ??
    "Only a failed, skipped or cancelled message can be sent again. This one was sent or queued in the meantime."
  );
}

// --- The values a message was rendered from (14.2: `data`) -------------------

export type DataValue =
  | { kind: "text"; text: string }
  | { kind: "money"; cents: number }
  | { kind: "moment"; iso: string }
  | { kind: "day"; day: string }
  | { kind: "link"; url: string }
  | { kind: "empty" };

export interface DataRow {
  /** The path in `data`: `message.en`. */
  key: string;
  /** `Message (English)` */
  label: string;
  value: DataValue;
}

const WORDS: Record<string, string> = {
  url: "URL",
  id: "ID",
  vat: "VAT",
  pdf: "PDF",
  sku: "SKU",
};

/** `amountDue` reads as `Amount due`, `payUrl` as `Pay URL`. */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => WORDS[word.toLowerCase()] ?? word.toLowerCase());
  const text = words.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const LANGUAGE: Record<string, string> = { en: "English", de: "German" };
const ISO_MOMENT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
// Amounts of the API are integer cents (0.7); these names carry one.
const MONEY_KEY =
  /(^amount|^total|amount$|total$|price$|fee$|due$|paid$|refunded$)/i;

function valueOf(key: string, value: unknown): DataValue {
  if (value === null || value === undefined || value === "")
    return { kind: "empty" };
  if (typeof value === "boolean")
    return { kind: "text", text: value ? "Yes" : "No" };
  if (typeof value === "number") {
    return Number.isInteger(value) && MONEY_KEY.test(key)
      ? { kind: "money", cents: value }
      : { kind: "text", text: value.toLocaleString("en") };
  }
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value)) return { kind: "link", url: value };
    if (ISO_MOMENT.test(value)) return { kind: "moment", iso: value };
    if (CALENDAR_DAY.test(value)) return { kind: "day", day: value };
    return { kind: "text", text: value };
  }
  return { kind: "text", text: JSON.stringify(value) };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `data` as rows a person can read. Nested values become one row each
 * (`message.en` is "Message (English)"), a list of plain values one row.
 */
export function dataRows(
  data: Record<string, unknown> | null | undefined,
): DataRow[] {
  const rows: DataRow[] = [];
  const walk = (value: unknown, path: string[], label: string) => {
    const key = path[path.length - 1] ?? "";
    if (isPlainObject(value)) {
      const entries = Object.entries(value);
      if (entries.length === 0) {
        rows.push({ key: path.join("."), label, value: { kind: "empty" } });
        return;
      }
      for (const [child, inner] of entries) {
        const language = LANGUAGE[child];
        walk(
          inner,
          [...path, child],
          language
            ? `${label} (${language})`
            : `${label}: ${humanizeKey(child)}`,
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      if (
        value.every((entry) => !isPlainObject(entry) && !Array.isArray(entry))
      ) {
        const text = value
          .filter(
            (entry) => entry !== null && entry !== undefined && entry !== "",
          )
          .map((entry) => String(entry))
          .join(", ");
        rows.push({
          key: path.join("."),
          label,
          value: text ? { kind: "text", text } : { kind: "empty" },
        });
        return;
      }
      value.forEach((entry, index) =>
        walk(entry, [...path, String(index)], `${label} ${index + 1}`),
      );
      return;
    }
    rows.push({ key: path.join("."), label, value: valueOf(key, value) });
  };
  for (const [key, value] of Object.entries(data ?? {})) {
    walk(value, [key], humanizeKey(key));
  }
  return rows;
}

/** `{ sent: 3, retried: 1, … }` as a sentence: "3 sent, 1 retried". */
export function runResultText(result: {
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  recovered: number;
}): string {
  const parts = (
    [
      ["sent", result.sent],
      ["retried", result.retried],
      ["failed", result.failed],
      ["skipped", result.skipped],
      ["recovered", result.recovered],
    ] as const
  ).map(([word, count]) => `${count.toLocaleString("en")} ${word}`);
  return parts.join(", ");
}

/** Whether a run of the queue found anything to do. */
export function runDidSomething(result: {
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  recovered: number;
}): boolean {
  return (
    result.sent +
      result.retried +
      result.failed +
      result.skipped +
      result.recovered >
    0
  );
}
