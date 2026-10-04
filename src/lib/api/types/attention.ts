// Section 16: the attention overview of the start page.

import type { Notification } from "./notifications";
import type { OrderSummary } from "./orders";
import type { Refund } from "./payments";
import type { OrderReturn } from "./returns";

/** Each group has a count and the newest five; the lists give the rest. */
export interface Attention {
  returns: { requested: number; items: OrderReturn[] };
  payments: {
    overdue: number;
    items: OrderSummary[];
    /** Online payment failed in the last 7 days; the customer has a new link. */
    failedRecently: OrderSummary[];
  };
  deliveries: { failed: number; items: OrderSummary[] };
  refunds: { pending: number; failed: number; items: Refund[] };
  notifications: { failed: number; queued: number; items: Notification[] };
}
