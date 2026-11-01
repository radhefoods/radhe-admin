// Section 28: product reviews. doc/CUSTOMER_ACCOUNTS.md section 8 has the rules.

import type {
  AdminRef,
  CursorQuery,
  CustomerRef,
  Id,
  IsoDateTime,
  Locale,
  SortParam,
  Translated,
} from "./common";

/** Every review waits (`pending`) until the admin publishes or rejects it. */
export type ReviewStatus = "pending" | "published" | "rejected";
export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  "pending",
  "published",
  "rejected",
];

export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;

/** The product next to the review, as the catalogue names it today. */
export interface ReviewProduct {
  id: Id;
  slug: string;
  name: Translated | string;
  imageUrl: string | null;
}

export interface ReviewModeration {
  adminId: Id | null;
  admin?: AdminRef | null;
  at: IsoDateTime;
  /** The note to the customer of a rejection. */
  note: string | null;
}

/** The public answer of Radhe Foods under the review. */
export interface ReviewReply {
  text: string;
  adminId: Id | null;
  admin?: AdminRef | null;
  at: IsoDateTime;
}

export interface Review {
  id: Id;
  productId: Id;
  product: ReviewProduct;
  customerId: Id;
  customer?: CustomerRef | null;
  /** The delivered order the review is written for, when the customer named one. */
  orderId: Id | null;
  orderNumber: string | null;
  /** 1 to 5. */
  rating: number;
  title: string | null;
  text: string;
  locale: Locale;
  /** The first name and the initial of the last name: "Priya S.". */
  authorName: string;
  status: ReviewStatus;
  publishedAt: IsoDateTime | null;
  moderation: ReviewModeration | null;
  reply: ReviewReply | null;
  writtenAt: IsoDateTime;
  /** A rewritten review waits again. */
  editedAt: IsoDateTime | null;
  updatedAt: IsoDateTime;
}

export const REVIEW_SORT_FIELDS = ["createdAt", "status", "rating"] as const;
export type ReviewSortField = (typeof REVIEW_SORT_FIELDS)[number];

export interface ReviewQuery extends CursorQuery {
  status?: ReviewStatus;
  productId?: Id;
  customerId?: Id;
  rating?: number;
  /** Default `createdAt:desc`. */
  sort?: SortParam<ReviewSortField>;
}

/** `POST /reviews/{id}/reject`: the note is shown to the customer. */
export interface ReviewRejectInput {
  note: string;
}

/** `POST /reviews/{id}/reply`: answering again replaces the answer. */
export interface ReviewReplyInput {
  text: string;
}
