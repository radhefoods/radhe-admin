// Section 6: legal texts.

import type { Id, IsoDateTime, Translated, TranslatedOptional } from "./common";

export type LegalType = "terms" | "privacy";
export type LegalStatus = "draft" | "published";

export interface LegalDocumentSummary {
  id: Id;
  type: LegalType;
  version: number;
  status: LegalStatus;
  title: Translated;
  note: string | null;
  publishedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** The published version customers accept now. */
  isCurrent: boolean;
}

export interface LegalDocument extends Omit<LegalDocumentSummary, "isCurrent"> {
  /** Markdown. English is required to publish. */
  content: TranslatedOptional;
}

export interface LegalDocumentList {
  items: LegalDocumentSummary[];
  /** Both must be published before anyone can check out. */
  requiredTypes: LegalType[];
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
