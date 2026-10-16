// Section 15: the attention overview of the start page.

import type { ProductSummary } from "./catalog";
import type { Notification } from "./notifications";
import type { OrderSummary } from "./orders";
import type { Refund } from "./payments";
import type { OrderReturn } from "./returns";

/** Each group has a count and the newest five; the lists give the rest. */
export interface Attention {
  /** Orders in `confirmed`: paid, not yet in processing. */
  orders: { toProcess: number; items: OrderSummary[] };
  refunds: {
    /** Paid orders whose money waits for the admin (`needsRefund=true`). */
    needed: number;
    orders: OrderSummary[];
    pending: number;
    failed: number;
    /** The newest five pending refunds. */
    items: Refund[];
  };
  returns: { requested: number; items: OrderReturn[] };
  /** Products at or below their low-stock threshold, the five most recently updated. */
  stock: { low: number; items: ProductSummary[] };
  notifications: { failed: number; queued: number; items: Notification[] };
}
