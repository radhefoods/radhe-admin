// What happens to an order, in one place: the cargo routes do the same
// things to many orders that the order routes do to one.

import type {
  DeliveryMethod,
  OrderStatus,
  SettableOrderStatus,
} from "../src/lib/api/types/index.ts";
import type { CargoRecord, Db, OrderRecord } from "./db.ts";
import {
  CAN_TAKE_ORDERS,
  customerOf,
  pushHistory,
  queueMessage,
  reserve,
} from "./domain.ts";
import { fail } from "./http.ts";
import { iso } from "./time.ts";

const NOTIFIED: Partial<
  Record<
    OrderStatus,
    "order_dispatched" | "order_delivered" | "delivery_failed"
  >
> = {
  dispatched: "order_dispatched",
  delivered: "order_delivered",
  delivery_failed: "delivery_failed",
};

export interface Actor {
  adminId: string | null;
  by?: "admin" | "system";
  note?: string | null;
}

/** Gives an order another status, with the times and the message that follow. */
export function setOrderStatus(
  db: Db,
  order: OrderRecord,
  to: SettableOrderStatus,
  actor: Actor,
  now: number,
): void {
  const from = order.status;
  if (from === to) return;
  order.status = to;
  if (to === "dispatched") order.delivery.dispatchedAt = iso(now);
  if (to === "delivered") order.delivery.deliveredAt = iso(now);
  // One step back: the time of the step that was taken back is cleared.
  if (to === "preparing" || to === "confirmed")
    order.delivery.dispatchedAt = null;
  if (to !== "delivered") order.delivery.deliveredAt = null;
  pushHistory(
    order,
    {
      field: "order",
      from,
      to,
      by: actor.by ?? "admin",
      adminId: actor.adminId,
      note: actor.note,
    },
    now,
  );
  const type = NOTIFIED[to];
  const customer = customerOf(db, order);
  if (type && customer) queueMessage(db, { type, customer, order }, now);
}

export function setDeliveryMethod(
  order: OrderRecord,
  method: DeliveryMethod,
  actor: Actor,
  now: number,
): boolean {
  if (order.delivery.method === method) return false;
  const from = order.delivery.method;
  order.delivery.method = method;
  // A tracking number belongs to its carrier.
  order.delivery.trackingNumber = null;
  pushHistory(
    order,
    {
      field: "delivery",
      from,
      to: method,
      adminId: actor.adminId,
      note: actor.note,
    },
    now,
  );
  return true;
}

export function assertCanTakeOrders(cargo: CargoRecord): void {
  if (!CAN_TAKE_ORDERS.includes(cargo.status)) {
    throw fail(
      409,
      "CARGO_CANNOT_TAKE_ORDERS",
      "The cargo cannot take orders in its status.",
      {
        cargo: cargo.code,
        status: cargo.status,
        allowedIn: CAN_TAKE_ORDERS,
      },
    );
  }
}

/**
 * Gives an order to another cargo: number, items and bill stay; the units
 * move with it; a failed delivery starts again as confirmed.
 */
export function moveOrder(
  db: Db,
  order: OrderRecord,
  target: CargoRecord,
  actor: Actor,
  now: number,
): void {
  const fromCode = order.cargo.code;
  reserve(db, order, order.cargo.id, -1);
  reserve(db, order, target.id, 1);
  order.cargo = { id: target.id, code: target.code };
  order.delivery.cargo = target.code;
  order.delivery.promisedStart = target.delivery.start;
  order.delivery.promisedEnd = target.delivery.end;
  pushHistory(
    order,
    {
      field: "cargo",
      from: fromCode,
      to: target.code,
      adminId: actor.adminId,
      note: actor.note,
    },
    now,
  );
  if (order.status === "delivery_failed") {
    order.status = "confirmed";
    order.delivery.dispatchedAt = null;
    order.delivery.trackingNumber = null;
    pushHistory(
      order,
      {
        field: "order",
        from: "delivery_failed",
        to: "confirmed",
        by: "system",
      },
      now,
    );
  }
  const customer = customerOf(db, order);
  if (customer) {
    queueMessage(
      db,
      {
        type: "order_moved",
        customer,
        order,
        data: {
          deliveryStart: target.delivery.start,
          deliveryEnd: target.delivery.end,
        },
      },
      now,
    );
  }
}

export function ordersOf(db: Db, cargoId: string): OrderRecord[] {
  return db.orders.filter((order) => order.cargo.id === cargoId);
}
