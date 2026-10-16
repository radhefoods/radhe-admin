// Section 10: returns.

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
import type { PackSize } from "./catalog";
import type { Actor } from "./orders";

export const RETURN_STATUSES = [
  "requested",
  "approved",
  "rejected",
  "completed",
  "cancelled",
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export type ReturnReason =
  | "damaged"
  | "wrong_item"
  | "quality"
  | "not_as_described"
  | "changed_mind"
  | "other";

/** Per pack size of the order: `variantId` is the key of the approve body. */
export interface ReturnItem {
  productId: Id;
  variantId: Id;
  sku: string;
  name: Translated;
  packSize: PackSize;
  /** Units the customer asked to send back. */
  quantity: number;
  /** Set by the decision; `0` declines the product. */
  approvedQuantity: number | null;
  unitPrice: Cents;
  vatRate: VatRate;
  reason: ReturnReason;
  comment: string | null;
}

export interface ReturnHistoryEntry {
  from: ReturnStatus | null;
  to: ReturnStatus;
  at: IsoDateTime;
  by: Actor;
  adminId: Id | null;
  admin?: AdminRef | null;
  note: string | null;
}

/** 10.2. */
export interface OrderReturn {
  id: Id;
  /** `RF-1084-R1` */
  returnNumber: string;
  orderId: Id;
  orderNumber: string;
  customerId: Id;
  customer?: CustomerRef | null;
  status: ReturnStatus;
  requestedAt: IsoDateTime;
  decidedAt: IsoDateTime | null;
  completedAt: IsoDateTime | null;
  items: ReturnItem[];
  requestedAmount: Cents;
  customerComment: string | null;
  /** What the customer reads. */
  decisionNote: string | null;
  /** Never shown to the customer. */
  internalNote: string | null;
  /** Set on completion: the cents the final bill went down by. */
  creditAmount: Cents | null;
  /** Set when the return was completed with `restock: true`. */
  restockedAt: IsoDateTime | null;
  statusHistory: ReturnHistoryEntry[];
  updatedAt: IsoDateTime;
}

export const RETURN_SORT_FIELDS = ["createdAt", "status"] as const;
export type ReturnSortField = (typeof RETURN_SORT_FIELDS)[number];

export interface ReturnQuery extends CursorQuery {
  status?: ReturnStatus;
  orderNumber?: string;
  customerId?: Id;
  /** Default `createdAt:desc`. */
  sort?: SortParam<ReturnSortField>;
}

export interface ReturnApproveInput {
  /** Leave out to accept the requested quantities; `0` declines a pack size. */
  items?: { variantId: Id; quantity: number }[];
  /** To the customer. */
  note?: string;
  internalNote?: string;
}

export interface ReturnDecisionInput {
  note?: string;
  internalNote?: string;
}

/** `POST /returns/{id}/complete`: `restock` puts the accepted units back on the shelf. */
export interface ReturnCompleteInput extends ReturnDecisionInput {
  restock?: boolean;
}
