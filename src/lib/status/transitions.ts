import type {
  OrderStatus,
  RefundMethod,
  RefundStatus,
  ReturnStatus,
} from "@/lib/api/types";

// The state machines of the API (documentation, 9.1, 10.1, 11.2).
//
// The panel never decides by these tables what is allowed: `allowedStatuses`
// of an order is authoritative, and the buttons follow it. The tables say
// what the documentation says, give the order of the steps, and sort what
// the API allows into "the next step", "a step back" and "something else".

/** The way of an order, in order. Cancellation and return stand beside it. */
export const ORDER_PATH = [
  "pending_payment",
  "confirmed",
  "processing",
  "dispatched",
  "delivered",
] as const satisfies readonly OrderStatus[];

/**
 * What the admin can set from each status (9.1). A pending order is
 * confirmed by its payment, never by hand; `cancelled` has its own
 * endpoint; `returned` is set by a completed return.
 */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: [],
  confirmed: ["processing", "dispatched"],
  processing: ["confirmed", "dispatched"],
  dispatched: ["processing", "delivered"],
  delivered: ["dispatched"],
  returned: [],
  cancelled: [],
};

/** The admin can cancel until the goods are delivered (9.1). */
export const ORDER_CANCELLABLE_IN: readonly OrderStatus[] = [
  "pending_payment",
  "confirmed",
  "processing",
  "dispatched",
];

/** Delivery method, tracking and quantity corrections (9.1). */
export const ORDER_CHANGEABLE_IN: readonly OrderStatus[] = [
  "confirmed",
  "processing",
  "dispatched",
  "delivered",
];

/** `cancelled` from `requested` is the customer's own step. */
export const RETURN_TRANSITIONS: Record<ReturnStatus, readonly ReturnStatus[]> =
  {
    requested: ["approved", "rejected"],
    approved: ["completed", "rejected"],
    rejected: [],
    completed: [],
    cancelled: [],
  };

/** What the admin can do with a refund (11.2): Stripe refunds complete through Stripe. */
export function refundActions(refund: {
  status: RefundStatus;
  method: RefundMethod;
}): { complete: boolean; cancel: boolean; sync: boolean } {
  return {
    complete: refund.method === "manual" && refund.status === "pending",
    cancel: refund.status === "pending" || refund.status === "failed",
    sync: refund.method === "stripe" && refund.status === "processing",
  };
}

export interface SortedTransitions<S extends string> {
  /** Further along the way, nearest first. The first one is the next step. */
  forward: S[];
  /** A step back, to correct a mistake. */
  back: S[];
  /** Beside the way: a cancellation. */
  aside: S[];
}

/**
 * Sorts the statuses the API allows from `current` by their place on the
 * way. A status that is not on the way lands in `aside`; from a status
 * beside the way everything on it counts as forward.
 */
export function sortTransitions<S extends string>(
  path: readonly S[],
  current: S,
  allowed: readonly S[],
): SortedTransitions<S> {
  const position = path.indexOf(current);
  const result: SortedTransitions<S> = { forward: [], back: [], aside: [] };
  for (const status of allowed) {
    const index = path.indexOf(status);
    if (index === -1) result.aside.push(status);
    else if (position === -1 || index > position) result.forward.push(status);
    else result.back.push(status);
  }
  result.forward.sort((a, b) => path.indexOf(a) - path.indexOf(b));
  result.back.sort((a, b) => path.indexOf(b) - path.indexOf(a));
  return result;
}

/** What a button that leads to an order status says. */
export const ORDER_ACTION_LABEL: Record<OrderStatus, string> = {
  pending_payment: "Waiting for the payment",
  confirmed: "Back to confirmed",
  processing: "Mark processing",
  dispatched: "Mark dispatched",
  delivered: "Mark delivered",
  cancelled: "Cancel order",
  returned: "Returned",
};

/**
 * The label of a transition, knowing where it starts: a step back reads as
 * one ("Back to processing").
 */
export function orderActionLabel(from: OrderStatus, to: OrderStatus): string {
  const fromIndex = ORDER_PATH.indexOf(from as (typeof ORDER_PATH)[number]);
  const toIndex = ORDER_PATH.indexOf(to as (typeof ORDER_PATH)[number]);
  if (toIndex !== -1 && fromIndex !== -1 && toIndex < fromIndex) {
    return `Back to ${to.replace(/_/g, " ")}`;
  }
  return ORDER_ACTION_LABEL[to];
}
