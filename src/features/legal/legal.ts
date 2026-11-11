import { z } from "zod";
import { env } from "@/config/env";
import type {
  LegalDocument,
  LegalDocumentSummary,
  LegalPage,
  LegalPageInput,
  LegalType,
  Locale,
  Translated,
  TranslatedOptional,
} from "@/lib/api/types";

// The legal pages of the shop (documentation, 6; doc/LEGAL_PAGES.md): six
// types, each in versions. A version is a draft until it is published, and
// never changes afterwards. Only the terms and the privacy policy are
// accepted at checkout: both must be published before anyone can check out.
// The other four inform, and never stand between a customer and an order.

/** The order the API answers the types in (`types`). */
export const LEGAL_TYPES: readonly LegalType[] = [
  "imprint",
  "shipping",
  "refund",
  "terms",
  "privacy",
  "withdrawal",
];

export const LEGAL_TYPE: Record<
  LegalType,
  { label: string; short: string; description: string; defaultTitle: string }
> = {
  imprint: {
    label: "Imprint",
    short: "imprint",
    description: "Who runs the shop (Impressum).",
    defaultTitle: "Imprint",
  },
  shipping: {
    label: "Shipping information",
    short: "shipping information",
    description: "How and where the shop delivers.",
    defaultTitle: "Shipping Information",
  },
  refund: {
    label: "Refund policy",
    short: "refund policy",
    description: "How money is given back.",
    defaultTitle: "Refund Policy",
  },
  terms: {
    label: "Terms and conditions",
    short: "terms",
    description: "What customers agree to at checkout.",
    defaultTitle: "Terms and Conditions",
  },
  privacy: {
    label: "Privacy policy",
    short: "privacy policy",
    description: "How the data of customers is handled.",
    defaultTitle: "Privacy Policy",
  },
  withdrawal: {
    label: "Right of withdrawal",
    short: "right of withdrawal",
    description: "How a customer withdraws from a contract.",
    defaultTitle: "Right of Withdrawal",
  },
};

export const TITLE_MAX = 160;
export const CONTENT_MAX = 300_000;
export const NOTE_MAX = 1000;

/** The versions of each type, newest first. */
export function groupByType(
  items: readonly LegalDocumentSummary[],
): Record<LegalType, LegalDocumentSummary[]> {
  const groups = Object.fromEntries(
    LEGAL_TYPES.map((type) => [type, [] as LegalDocumentSummary[]]),
  ) as Record<LegalType, LegalDocumentSummary[]>;
  for (const item of items) groups[item.type]?.push(item);
  for (const type of LEGAL_TYPES)
    groups[type].sort((a, b) => b.version - a.version);
  return groups;
}

/**
 * The types accepted at checkout that have no published version: checkout
 * is refused meanwhile. The four pages that only inform are never among
 * them.
 */
export function unpublishedRequiredTypes(
  pages: readonly Pick<LegalPage, "type" | "current">[],
  requiredTypes: readonly LegalType[],
): LegalType[] {
  return requiredTypes.filter(
    (type) => !pages.some((page) => page.type === type && page.current),
  );
}

/** The version before this one, of the same type: what it is compared with. */
export function previousVersion(
  items: readonly LegalDocumentSummary[],
  document: Pick<LegalDocument, "id" | "type" | "version">,
): LegalDocumentSummary | null {
  const earlier = items
    .filter(
      (item) =>
        item.type === document.type &&
        item.id !== document.id &&
        item.version < document.version,
    )
    .sort((a, b) => b.version - a.version);
  return earlier[0] ?? null;
}

/** `Terms and conditions, version 3` */
export function versionName(
  document: Pick<LegalDocument, "type" | "version">,
): string {
  return `${LEGAL_TYPE[document.type]?.label ?? document.type}, version ${document.version}`;
}

function filled(text: string | null | undefined): string | undefined {
  return text && text.trim() !== "" ? text : undefined;
}

/** A title as the API takes it: English always, German only when there is one. */
export function toTitle(value: { en: string; de?: string | null }): Translated {
  const de = filled(value.de)?.trim();
  return de ? { en: value.en.trim(), de } : { en: value.en.trim() };
}

/** A content as the API takes it: a language without text is left out. */
export function toContent(value: {
  en?: string | null;
  de?: string | null;
}): TranslatedOptional {
  const content: TranslatedOptional = {};
  const en = filled(value.en);
  const de = filled(value.de);
  if (en) content.en = en;
  if (de) content.de = de;
  return content;
}

export function hasText(value: string | null | undefined): boolean {
  return Boolean(value && value.trim() !== "");
}

/**
 * The language a text is written in when it is written in one only: the
 * shop then shows that text to readers of the other language. `null` when
 * both languages have a text, or neither has.
 */
export function onlyLanguage(content: {
  en?: string | null;
  de?: string | null;
}): Locale | null {
  const en = hasText(content.en);
  const de = hasText(content.de);
  if (en === de) return null;
  return en ? "en" : "de";
}

// --- The page of a type: its address and its texts for search engines --------

/**
 * Where the website keeps its legal pages, per language: `/en/legal/terms`,
 * `/de/rechtliches/agb` (`src/i18n/routing.ts` of the website; the language
 * is always part of the address there).
 */
const LEGAL_SECTION: Record<Locale, string> = {
  en: "legal",
  de: "rechtliches",
};

/** The full address of a legal page in the shop, in one language. */
export function legalPageUrl(locale: Locale, slug: string): string {
  return `${env.shopUrl}/${locale}/${LEGAL_SECTION[locale]}/${slug}`;
}

export const PAGE_RULES = {
  slugMaxLength: 120,
  seoMaxLength: 300,
} as const;

/** Lower-case letters, digits and single hyphens (the API's rule). */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const atMost = (max: number) => `At most ${max} characters.`;

const zAddress = z
  .string()
  .trim()
  .max(PAGE_RULES.slugMaxLength, atMost(PAGE_RULES.slugMaxLength))
  .refine(
    (value) => value === "" || SLUG.test(value),
    "Lower-case letters, digits and single hyphens only: shipping-information",
  );
const zSeoLine = z
  .string()
  .trim()
  .max(PAGE_RULES.seoMaxLength, atMost(PAGE_RULES.seoMaxLength));

/** The form of a page. An empty field means the default. */
export const pageSchema = z.object({
  slug: z.object({ en: zAddress, de: zAddress }),
  seoTitle: z.object({ en: zSeoLine, de: zSeoLine }),
  seoDescription: z.object({ en: zSeoLine, de: zSeoLine }),
});

export type PageFormValues = z.input<typeof pageSchema>;

export const EMPTY_PAGE: PageFormValues = {
  slug: { en: "", de: "" },
  seoTitle: { en: "", de: "" },
  seoDescription: { en: "", de: "" },
};

/**
 * The page as its form holds it. The API answers the address that applies;
 * one that equals the default is shown as an empty field, which means the
 * same.
 */
export function pageDefaults(
  page: Pick<LegalPage, "slug" | "defaultSlug" | "seo">,
): PageFormValues {
  const own = (locale: Locale) =>
    page.slug[locale] === page.defaultSlug[locale] ? "" : page.slug[locale];
  return {
    slug: { en: own("en"), de: own("de") },
    seoTitle: {
      en: page.seo.title?.en ?? "",
      de: page.seo.title?.de ?? "",
    },
    seoDescription: {
      en: page.seo.description?.en ?? "",
      de: page.seo.description?.de ?? "",
    },
  };
}

function pair(value: { en: string; de: string }): TranslatedOptional | null {
  const en = value.en.trim();
  const de = value.de.trim();
  if (!en && !de) return null;
  return { ...(en && { en }), ...(de && { de }) };
}

/**
 * The page as `PUT …/pages/{type}` takes it: everything the page keeps,
 * since the call replaces the whole page. What is empty is left out and
 * goes back to the default.
 */
export function toPageInput(values: PageFormValues): LegalPageInput {
  const input: LegalPageInput = {};
  const slug = pair(values.slug);
  if (slug) input.slug = slug;
  const title = pair(values.seoTitle);
  const description = pair(values.seoDescription);
  if (title || description) {
    input.seo = {
      ...(title && { title }),
      ...(description && { description }),
    };
  }
  return input;
}

export function samePage(a: PageFormValues, b: PageFormValues): boolean {
  return JSON.stringify(toPageInput(a)) === JSON.stringify(toPageInput(b));
}
