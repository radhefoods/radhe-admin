import type {
  CargoStatus,
  OrderStatus,
  RefundMethod,
  RefundStatus,
  ReturnStatus,
} from "@/lib/api/types";

// The state machines of the API (documentation, 9.1, 10.1, 11.1, 12.9).
//
// The panel never decides by these tables what is allowed: `allowedStatuses`
// of a cargo and of an order is authoritative, and the buttons follow it.
// The tables say what the documentation says, give the order of the steps,
// and sort what the API allows into "the next step", "a step back" and
// "something else".

/** The way of a cargo, in order. `cancelled` stands beside it. */
export const CARGO_PATH = [
  "draft",
  "scheduled",
  "taking_orders",
  "orders_closed",
  "in_transit",
  "arrived",
  "delivering",
  "delivered",
] as const satisfies readonly CargoStatus[];

export const CARGO_TRANSITIONS: Record<CargoStatus, readonly CargoStatus[]> = {
  draft: ["scheduled", "taking_orders", "cancelled"],
  scheduled: ["draft", "taking_orders", "cancelled"],
  taking_orders: ["orders_closed", "cancelled"],
  orders_closed: ["taking_orders", "in_transit", "cancelled"],
  in_transit: ["orders_closed", "arrived", "cancelled"],
  arrived: ["in_transit", "delivering"],
  delivering: ["arrived", "delivered"],
  delivered: ["delivering"],
  cancelled: [],
};

/** The way of an order, in order. Failure, cancellation and return stand beside it. */
export const ORDER_PATH = [
  "confirmed",
  "preparing",
  "dispatched",
  "delivered",
] as const satisfies readonly OrderStatus[];

/** `cancelled` has its own endpoint; `returned` is set by a completed return. */
export const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  confirmed: ["preparing", "dispatched"],
  preparing: ["confirmed", "dispatched"],
  dispatched: ["preparing", "delivered", "delivery_failed"],
  delivery_failed: ["dispatched", "delivered"],
  delivered: ["dispatched"],
  returned: [],
  cancelled: [],
};

export const ORDER_CANCELLABLE_IN: readonly OrderStatus[] = [
  "confirmed",
  "preparing",
  "dispatched",
  "delivery_failed",
];
export const ORDER_MOVABLE_IN: readonly OrderStatus[] = [
  "confirmed",
  "preparing",
  "delivery_failed",
];
/** Delivery method, tracking and quantity corrections. */
export const ORDER_CHANGEABLE_IN: readonly OrderStatus[] = [
  "confirmed",
  "preparing",
  "dispatched",
  "delivery_failed",
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

/** What the admin can do with a refund (12.9): Stripe refunds complete through Stripe. */
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
  /** Beside the way: a failure, a cancellation. */
  aside: S[];
}

/**
 * Sorts the statuses the API allows from `current` by their place on the
 * way. A status that is not on the way (`cancelled`, `delivery_failed`)
 * lands in `aside`; from a status beside the way everything on it counts
 * as forward.
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

/** What a button that leads to a cargo status says. */
export const CARGO_ACTION_LABEL: Record<CargoStatus, string> = {
  draft: "Back to draft",
  scheduled: "Schedule",
  taking_orders: "Open ordering",
  orders_closed: "Close ordering",
  in_transit: "Mark in transit",
  arrived: "Mark arrived",
  delivering: "Start delivering",
  delivered: "Mark delivered",
  cancelled: "Cancel cargo",
};

/** What a button that leads to an order status says. */
export const ORDER_ACTION_LABEL: Record<OrderStatus, string> = {
  confirmed: "Back to confirmed",
  preparing: "Mark preparing",
  dispatched: "Mark dispatched",
  delivered: "Mark delivered",
  delivery_failed: "Delivery failed",
  cancelled: "Cancel order",
  returned: "Returned",
};

/**
 * The label of a transition, knowing where it starts: a step back reads as
 * one ("Back to in transit"), a repeated dispatch as "Dispatch again".
 */
export function cargoActionLabel(from: CargoStatus, to: CargoStatus): string {
  const fromIndex = CARGO_PATH.indexOf(from as (typeof CARGO_PATH)[number]);
  const toIndex = CARGO_PATH.indexOf(to as (typeof CARGO_PATH)[number]);
  if (to === "taking_orders" && from === "orders_closed") {
    return "Open ordering again";
  }
  if (toIndex !== -1 && fromIndex !== -1 && toIndex < fromIndex) {
    return `Back to ${to.replace(/_/g, " ")}`;
  }
  return CARGO_ACTION_LABEL[to];
}

export function orderActionLabel(from: OrderStatus, to: OrderStatus): string {
  if (from === "delivery_failed" && to === "dispatched")
    return "Dispatch again";
  const fromIndex = ORDER_PATH.indexOf(from as (typeof ORDER_PATH)[number]);
  const toIndex = ORDER_PATH.indexOf(to as (typeof ORDER_PATH)[number]);
  if (toIndex !== -1 && fromIndex !== -1 && toIndex < fromIndex) {
    return `Back to ${to.replace(/_/g, " ")}`;
  }
  return ORDER_ACTION_LABEL[to];
}
