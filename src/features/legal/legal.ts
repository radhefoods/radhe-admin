import type {
  LegalDocument,
  LegalDocumentSummary,
  LegalType,
  Translated,
  TranslatedOptional,
} from "@/lib/api/types";

// The legal texts of the shop (documentation, 6): three types, each in
// versions. A version is a draft until it is published, and never changes
// afterwards.

export const LEGAL_TYPES: readonly LegalType[] = [
  "terms",
  "preorder_terms",
  "privacy",
];

export const LEGAL_TYPE: Record<
  LegalType,
  { label: string; short: string; description: string; defaultTitle: string }
> = {
  terms: {
    label: "Terms and conditions",
    short: "terms",
    description: "What customers agree to with every order.",
    defaultTitle: "Terms and Conditions",
  },
  preorder_terms: {
    label: "Pre-order terms",
    short: "pre-order terms",
    description: "The rules of ordering ahead and paying after delivery.",
    defaultTitle: "Pre-Order and Payment Terms",
  },
  privacy: {
    label: "Privacy policy",
    short: "privacy policy",
    description: "How the data of customers is handled.",
    defaultTitle: "Privacy Policy",
  },
};

export const TITLE_MAX = 160;
export const CONTENT_MAX = 300_000;
export const NOTE_MAX = 1000;

/** The versions of each type, newest first. */
export function groupByType(
  items: readonly LegalDocumentSummary[],
): Record<LegalType, LegalDocumentSummary[]> {
  const groups: Record<LegalType, LegalDocumentSummary[]> = {
    terms: [],
    preorder_terms: [],
    privacy: [],
  };
  for (const item of items) groups[item.type]?.push(item);
  for (const type of LEGAL_TYPES)
    groups[type].sort((a, b) => b.version - a.version);
  return groups;
}

/** The required types that have no published version: orders are refused meanwhile. */
export function unpublishedRequiredTypes(
  items: readonly LegalDocumentSummary[],
  requiredTypes: readonly LegalType[],
): LegalType[] {
  return requiredTypes.filter(
    (type) =>
      !items.some((item) => item.type === type && item.status === "published"),
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
