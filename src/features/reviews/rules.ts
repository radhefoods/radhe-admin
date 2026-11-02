import type { Review, ReviewStatus } from "@/lib/api/types";

/** The API's limits for what the admin writes (28). */
export const REVIEW_NOTE_MAX = 1000;
export const REVIEW_REPLY_MAX = 2000;

/**
 * What the admin can do with a review by its status (28): publish what is
 * not published, take off or refuse what is not rejected. The API decides
 * in the end; answering and deleting are always possible.
 */
export function reviewActions(status: ReviewStatus): {
  approve: boolean;
  reject: boolean;
} {
  return { approve: status !== "published", reject: status !== "rejected" };
}

/** "Priya S. on RF-1084", the title of a review's page. */
export function reviewTitle(review: Review): string {
  return `${review.authorName} on ${review.orderNumber}`;
}
