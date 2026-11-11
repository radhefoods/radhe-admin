// Section 6: the legal pages of the shop.

import type {
  AdminRef,
  Id,
  IsoDateTime,
  Translated,
  TranslatedOptional,
} from "./common";

/** The six legal pages, in the order the API answers them (`types`). */
export type LegalType =
  "imprint" | "shipping" | "refund" | "terms" | "privacy" | "withdrawal";
export type LegalStatus = "draft" | "published";

export interface LegalDocumentSummary {
  id: Id;
  type: LegalType;
  version: number;
  status: LegalStatus;
  title: Translated;
  note: string | null;
  publishedAt: IsoDateTime | null;
  /** Who published the version; `null` on a draft, or when the admin no longer exists. */
  publishedByAdmin: AdminRef | null;
  /** Who started the version; `null` when the admin no longer exists. */
  createdByAdmin: AdminRef | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** The published version that applies now. */
  isCurrent: boolean;
}

export interface LegalDocument extends Omit<LegalDocumentSummary, "isCurrent"> {
  /** Plain text or Markdown. One language is enough to publish. */
  content: TranslatedOptional;
}

export interface LegalDocumentList {
  items: LegalDocumentSummary[];
  /** Every type there is, in the order to show them. */
  types: LegalType[];
  /** Accepted at checkout: both must be published before anyone can check out. */
  requiredTypes: LegalType[];
}

export interface LegalDocumentQuery {
  type?: LegalType;
  status?: LegalStatus;
}

export interface CreateLegalDocumentInput {
  type: LegalType;
  title: Translated;
  content: TranslatedOptional;
  /** `null` removes the note. */
  note?: string | null;
}

export interface UpdateLegalDocumentInput {
  title?: Translated;
  content?: TranslatedOptional;
  /** `null` removes the note. */
  note?: string | null;
}

/** A version as the page object carries it: without its text and without `isCurrent`. */
export type LegalPageVersion = Omit<LegalDocumentSummary, "isCurrent">;

/** The address of a page in both languages. */
export interface LegalSlugs {
  en: string;
  de: string;
}

/**
 * The page of one type in the shop: its address and its texts for search
 * engines belong to the page, not to a version.
 */
export interface LegalPage {
  type: LegalType;
  /** True for the texts a customer accepts at checkout (`terms`, `privacy`). */
  requiresConsent: boolean;
  /** The address that applies now: what the admin set, else the default. */
  slug: LegalSlugs;
  /** The address the page has when the admin sets none. */
  defaultSlug: LegalSlugs;
  seo: {
    /** `null`: the shop uses the title of the text. */
    title: TranslatedOptional | null;
    description: TranslatedOptional | null;
  };
  /** The published version that applies now; `null`: nothing is published. */
  current: LegalPageVersion | null;
  /** The newest draft; `null`: there is none. */
  draft: LegalPageVersion | null;
  /** How many versions the type has, drafts included. */
  versions: number;
  /** When address or search-engine texts were last changed; `null`: never. */
  updatedAt: IsoDateTime | null;
}

export interface LegalPageList {
  /** Always six, also for a type nobody has written yet. */
  items: LegalPage[];
  requiredTypes: LegalType[];
}

/**
 * `PUT …/pages/{type}`: the page as a whole. What is left out or `null`
 * goes back to the default.
 */
export interface LegalPageInput {
  slug?: TranslatedOptional | null;
  seo?: {
    title?: TranslatedOptional;
    description?: TranslatedOptional;
  } | null;
}
