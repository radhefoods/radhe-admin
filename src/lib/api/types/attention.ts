// Section 15: the attention overview of the start page.

import type { ProductSummary } from "./catalog";
import type { Notification } from "./notifications";
import type { OrderSummary } from "./orders";
import type { Refund } from "./payments";
import type { QuotationSummary } from "./quotations";
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
  /**
   * Products with a pack size at or below its threshold, the five most
   * recently updated; `variants[].stock.isLow` names the pack sizes.
   */
  stock: { low: number; items: ProductSummary[] };
  notifications: { failed: number; queued: number; items: Notification[] };
  /** Wholesale quotation requests nobody has priced yet (24), the newest five. */
  quotations: { new: number; items: QuotationSummary[] };
}
