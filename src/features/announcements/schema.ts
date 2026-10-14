import { z } from "zod";
import type {
  AnnouncementInput,
  AnnouncementPreview,
  NotificationChannel,
} from "@/lib/api/types";

// The rules of the API for an announcement (documentation, 15.2).

export const SUBJECT_MAX = 160;
export const MESSAGE_MAX = 2000;
export const LINK_MAX = 500;

/** An absolute web address: `https://…` or `http://…`. */
export function isAbsoluteUrl(value: string): boolean {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    return new URL(value).hostname !== "";
  } catch {
    return false;
  }
}

const atMost = (max: number) =>
  `At most ${max.toLocaleString("en")} characters.`;

export const announcementSchema = z
  .object({
    subject: z.object({
      en: z
        .string()
        .trim()
        .min(1, "The English subject is required.")
        .max(SUBJECT_MAX, atMost(SUBJECT_MAX)),
      de: z.string().trim().max(SUBJECT_MAX, atMost(SUBJECT_MAX)),
    }),
    message: z.object({
      en: z
        .string()
        .trim()
        .min(1, "The English message is required.")
        .max(MESSAGE_MAX, atMost(MESSAGE_MAX)),
      de: z.string().trim().max(MESSAGE_MAX, atMost(MESSAGE_MAX)),
    }),
    link: z
      .string()
      .trim()
      .max(LINK_MAX, atMost(LINK_MAX))
      .refine(
        (value) => value === "" || isAbsoluteUrl(value),
        "Enter the full address, beginning with https://",
      ),
    linkLabel: z.object({
      en: z.string().trim().max(160, "At most 160 characters."),
      de: z.string().trim().max(160, "At most 160 characters."),
    }),
    /** The id of the chosen product, or empty. */
    productId: z.string(),
    /** The id of the chosen cargo, or empty. */
    cargoId: z.string(),
    email: z.boolean(),
    whatsapp: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.linkLabel.de !== "" && value.linkLabel.en === "") {
      context.addIssue({
        code: "custom",
        path: ["linkLabel", "en"],
        message: "Give the English label too.",
      });
    }
    if (!value.email && !value.whatsapp) {
      context.addIssue({
        code: "custom",
        path: ["email"],
        message: "Choose at least one channel.",
      });
    }
  });

export type AnnouncementFormValues = z.input<typeof announcementSchema>;
export type AnnouncementValues = z.output<typeof announcementSchema>;

export const announcementDefaults: AnnouncementFormValues = {
  subject: { en: "", de: "" },
  message: { en: "", de: "" },
  link: "",
  linkLabel: { en: "", de: "" },
  productId: "",
  cargoId: "",
  email: true,
  whatsapp: false,
};

/** English always; German only when it was written. */
function translated(value: { en: string; de: string }): {
  en: string;
  de?: string;
} {
  return value.de === "" ? { en: value.en } : { en: value.en, de: value.de };
}

/**
 * What `POST /announcements/preview` and `POST /announcements` get. Empty
 * optional fields are left out: the API refuses unknown and empty values.
 */
export function toAnnouncementInput(
  values: AnnouncementValues,
): AnnouncementInput {
  const channels: NotificationChannel[] = [
    ...(values.email ? (["email"] as const) : []),
    ...(values.whatsapp ? (["whatsapp"] as const) : []),
  ];
  return {
    subject: translated(values.subject),
    message: translated(values.message),
    ...(values.link !== "" ? { link: values.link } : {}),
    ...(values.linkLabel.en !== ""
      ? { linkLabel: translated(values.linkLabel) }
      : {}),
    ...(values.productId !== "" ? { productId: values.productId } : {}),
    ...(values.cargoId !== "" ? { cargoId: values.cargoId } : {}),
    channels,
  };
}

/**
 * The rendered email for the preview frame, with the targets of its links
 * taken out. The frame is sandboxed and may not load another site: a click
 * on the button would only leave an empty frame behind.
 */
export function withoutLinkTargets(html: string): string {
  return html.replace(
    /(<a\b[^>]*?)\s+href\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,
    "$1",
  );
}

/**
 * How many customers an announcement reaches, from the preview's numbers:
 * everyone who opted in to news gets the email, and the WhatsApp recipients
 * are among them. With WhatsApp alone it is the WhatsApp number.
 */
export function customersReached(
  recipients: AnnouncementPreview["recipients"],
): number {
  return Math.max(recipients.email, recipients.whatsapp);
}

/** How many messages the announcement queues: one per customer and channel. */
export function messagesQueued(
  recipients: AnnouncementPreview["recipients"],
): number {
  return recipients.email + recipients.whatsapp;
}
