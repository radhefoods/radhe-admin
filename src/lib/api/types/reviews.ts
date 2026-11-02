// Section 28: order reviews. doc/ORDER_REVIEWS.md has the rules: a customer
// reviews a delivered order as a whole, once, with stars and words.

import type {
  AdminRef,
  CursorQuery,
  CustomerRef,
  Id,
  IsoDateTime,
  Locale,
  SortParam,
} from "./common";

/** Every review waits (`pending`) until the admin publishes or rejects it. */
export type ReviewStatus = "pending" | "published" | "rejected";
export const REVIEW_STATUSES: readonly ReviewStatus[] = [
  "pending",
  "published",
  "rejected",
];

export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;

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
  /** The delivered order the review is about; one review per order. */
  orderId: Id;
  orderNumber: string;
  customerId: Id;
  customer?: CustomerRef | null;
  /** 1 to 5. */
  rating: number;
  /** 10 to 2000 characters; written once, never edited by the customer. */
  text: string;
  locale: Locale;
  /** The first name and the initial of the last name: "Priya S.". */
  authorName: string;
  status: ReviewStatus;
  publishedAt: IsoDateTime | null;
  moderation: ReviewModeration | null;
  reply: ReviewReply | null;
  writtenAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export const REVIEW_SORT_FIELDS = ["createdAt", "status", "rating"] as const;
export type ReviewSortField = (typeof REVIEW_SORT_FIELDS)[number];

export interface ReviewQuery extends CursorQuery {
  status?: ReviewStatus;
  customerId?: Id;
  /** The review of one order, for the box on the order page. */
  orderNumber?: string;
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
