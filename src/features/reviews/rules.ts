import type { Review, ReviewProduct, ReviewStatus } from "@/lib/api/types";
import { translated } from "@/lib/format/names";

/** The API's limits for what the admin writes (28). */
export const REVIEW_NOTE_MAX = 1000;
export const REVIEW_REPLY_MAX = 2000;

/** The product's name, whichever way the API gives it next to a review. */
export function reviewProductName(product: ReviewProduct): string {
  return typeof product.name === "string"
    ? product.name
    : translated(product.name);
}

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

/** "Priya S. on Chakki Atta", the title of a review's page. */
export function reviewTitle(review: Review): string {
  return `${review.authorName} on ${reviewProductName(review.product)}`;
}
