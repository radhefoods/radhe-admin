// Section 29: problem reports after a delivery. doc/CUSTOMER_ACCOUNTS.md
// section 9 has the rules and the customer's side.

import type {
  AdminRef,
  Cents,
  CursorQuery,
  CustomerRef,
  Id,
  IsoDateTime,
  SortParam,
  Translated,
  VatRate,
} from "./common";
import type { ImageSizes, PackSize } from "./catalog";
import type { Actor } from "./orders";

/**
 * `open` → `in_review` → `resolved` | `rejected`; `cancelled` when the
 * customer takes the report back while it is open.
 */
export type IssueStatus =
  "open" | "in_review" | "resolved" | "rejected" | "cancelled";
export const ISSUE_STATUSES: readonly IssueStatus[] = [
  "open",
  "in_review",
  "resolved",
  "rejected",
  "cancelled",
];

export type IssueProblem =
  "damaged" | "missing" | "wrong_item" | "not_fresh" | "late" | "other";
export const ISSUE_PROBLEMS: readonly IssueProblem[] = [
  "damaged",
  "missing",
  "wrong_item",
  "not_fresh",
  "late",
  "other",
];

/** What the customer would like, and what the admin decides. */
export type IssueResolution = "refund" | "replacement" | "none";
export const ISSUE_RESOLUTIONS: readonly IssueResolution[] = [
  "refund",
  "replacement",
  "none",
];

/** A pack size of the order the report is about; `variantId` is the key of the refund. */
export interface IssueItem {
  productId: Id;
  variantId: Id;
  sku: string;
  name: Translated;
  packSize: PackSize;
  /** Units affected, as reported. */
  quantity: number;
  /** Units taken off the delivered quantity by a refund resolution. */
  refundedQuantity: number;
  unitPrice: Cents;
  vatRate: VatRate;
}

/** A photo of the customer, in the sizes of a product image. */
export interface IssueImage {
  id: Id;
  url: string;
  sizes: ImageSizes;
}

export interface IssueResolutionRecord {
  type: IssueResolution;
  /** Cents credited by a refund; `null` otherwise. */
  amount: Cents | null;
  /** The note to the customer. */
  note: string | null;
  adminId: Id | null;
  admin?: AdminRef | null;
  at: IsoDateTime;
}

export interface IssueHistoryEntry {
  from: IssueStatus | null;
  to: IssueStatus;
  at: IsoDateTime;
  by: Actor;
  adminId: Id | null;
  admin?: AdminRef | null;
  note: string | null;
}

export interface Issue {
  id: Id;
  /** `RF-1084-P1` */
  issueNumber: string;
  orderId: Id;
  orderNumber: string;
  customerId: Id;
  customer?: CustomerRef | null;
  status: IssueStatus;
  reportedAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
  /** Empty for a problem with the delivery as a whole. */
  items: IssueItem[];
  /** Cents of the reported units. */
  reportedAmount: Cents;
  problems: IssueProblem[];
  description: string;
  images: IssueImage[];
  preferredResolution: IssueResolution;
  resolution: IssueResolutionRecord | null;
  /** Never shown to the customer. */
  internalNote: string | null;
  statusHistory: IssueHistoryEntry[];
  updatedAt: IsoDateTime;
}

export const ISSUE_SORT_FIELDS = ["createdAt", "status"] as const;
export type IssueSortField = (typeof ISSUE_SORT_FIELDS)[number];

export interface IssueQuery extends CursorQuery {
  status?: IssueStatus;
  orderNumber?: string;
  customerId?: Id;
  /** Default `createdAt:desc`. */
  sort?: SortParam<IssueSortField>;
}

/** `POST /issues/{id}/review`: the admin takes the report on; no email. */
export interface IssueReviewInput {
  note?: string;
  internalNote?: string;
}

/**
 * `POST /issues/{id}/resolve`. `refund`: the units in `items` (default: as
 * reported) come off the delivered quantity of the order, which issues the
 * credit note and queues the refund.
 */
export interface IssueResolveInput {
  resolution: IssueResolution;
  items?: { variantId: Id; quantity: number }[];
  note?: string;
  internalNote?: string;
}

/** `POST /issues/{id}/reject`: the note is what the customer reads. */
export interface IssueRejectInput {
  note: string;
  internalNote?: string;
}
