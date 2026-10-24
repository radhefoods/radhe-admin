// Section 22: the FAQ. doc/FAQ.md has the model, the rules and the panel
// workflow.

import type { Id, IsoDateTime, Translated, TranslatedOptional } from "./common";

/** A heading the questions stand under: "Orders", "Delivery", "Returns". */
export interface FaqGroup {
  id: Id;
  name: Translated;
  /** A hidden group hides its questions in the shop. */
  isVisible: boolean;
  /** 0 first. */
  sortOrder: number;
  /** With the list only. */
  faqCount?: number;
  publishedCount?: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface FaqGroupList {
  /** In display order. */
  items: FaqGroup[];
  /** The questions without a group. */
  ungrouped: { total: number; published: number };
}

export interface FaqGroupInput {
  name: Translated;
  isVisible?: boolean;
}

export interface FaqGroupPatch {
  name?: Translated;
  isVisible?: boolean;
}

/** `PUT /faq-groups/order`: every group exactly once. */
export interface FaqGroupOrderInput {
  orderedIds: Id[];
}

/** One question with its answer, in English and German. */
export interface Faq {
  id: Id;
  /** At most 300 characters each. */
  question: Translated;
  /** Plain text or Markdown, at most 20 000 characters each. */
  answer: Translated;
  groupId: Id | null;
  group: { id: Id; name: Translated } | null;
  /** The position within its group, 0 first. */
  sortOrder: number;
  isPublished: boolean;
  /** When it was first published. */
  publishedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface FaqQuery {
  groupId?: Id;
  ungrouped?: boolean;
  isPublished?: boolean;
}

export interface FaqInput {
  question: Translated;
  answer: Translated;
  /** `null`: no group. */
  groupId?: Id | null;
  isPublished?: boolean;
}

/** Any field of the creation; `groupId: null` takes the question out of its group. */
export interface FaqPatch {
  question?: Translated;
  answer?: Translated;
  groupId?: Id | null;
  isPublished?: boolean;
}

/**
 * `PUT /faqs/order`: the questions of one group (`groupId` absent or `null`
 * for the ones without a group). Partial allowed: the named ones come
 * first, the rest keeps its order.
 */
export interface FaqOrderInput {
  groupId?: Id | null;
  orderedIds: Id[];
}

export const FAQ_RULES = {
  groupNameMaxLength: 120,
  questionMaxLength: 300,
  answerMaxLength: 20_000,
  /** At most this many ids in one order request. */
  maxOrderIds: 500,
} as const;

export type { TranslatedOptional as FaqTranslatedOptional };
