// What happens to an order, in one place: the bulk routes do the same
// things to many orders that the order routes do to one, and the seed
// walks orders through the same steps.

import { settleDiscountUse } from "./modules/discounts.ts";
import type {
  CancellationReason,
  DeliveryMethod,
  OrderStatus,
  SettableOrderStatus,
} from "../src/lib/api/types/index.ts";
import type { Db, OrderRecord } from "./db.ts";
import {
  customerOf,
  issueInvoice,
  pushHistory,
  queueMessage,
} from "./domain.ts";
import { giveBackStock, takeStock } from "./modules/stock.ts";
import { iso } from "./time.ts";

const NOTIFIED: Partial<
  Record<OrderStatus, "order_dispatched" | "order_delivered">
> = {
  dispatched: "order_dispatched",
  delivered: "order_delivered",
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
  if (to === "dispatched") {
    order.delivery.dispatchedAt = iso(now);
    order.delivery.deliveredAt = null;
  }
  if (to === "delivered") order.delivery.deliveredAt = iso(now);
  // A step back clears what no longer holds.
  if (to === "processing" || to === "confirmed") {
    order.delivery.dispatchedAt = null;
    order.delivery.deliveredAt = null;
  }
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
  if (type && customer) {
    queueMessage(
      db,
      {
        type,
        customer,
        order,
        data:
          type === "order_dispatched"
            ? {
                carrier: order.delivery.method,
                trackingNumber: order.delivery.trackingNumber,
                deliveryEstimate: db.settings.delivery.estimate[order.language],
              }
            : { returnWindowDays: db.settings.returnPolicy.windowDays },
      },
      now,
    );
  }
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

/**
 * The settlement of a paid order (architecture 7.2): the bank approved,
 * the stock is taken, the money is captured, the invoice is issued, the
 * order is confirmed and the customer gets the confirmation. When an item
 * sold out meanwhile, nothing is charged and the order is cancelled.
 */
export function settleOrder(
  db: Db,
  order: OrderRecord,
  paid: {
    paymentType: "card" | "paypal";
    paymentIntentId: string;
    chargeId: string;
    receiptUrl: string;
  },
  now: number,
): boolean {
  const payment = order.payment;
  pushHistory(
    order,
    {
      field: "payment",
      from: order.paymentStatus,
      to: "authorized",
      by: "system",
      note: `Stripe ${paid.paymentIntentId}`,
    },
    now,
  );
  order.paymentStatus = "authorized";
  payment.authorizedAt = iso(now);
  payment.paymentIntentId = paid.paymentIntentId;
  if (!takeStock(db, order, now)) {
    cancelOrder(
      db,
      order,
      { reason: "sold_out", text: null, by: "system", adminId: null },
      now + 1000,
    );
    pushHistory(
      order,
      {
        field: "payment",
        from: "authorized",
        to: "failed",
        by: "system",
        note: "An item sold out; the approval was let go of.",
      },
      now + 1000,
    );
    order.paymentStatus = "failed";
    payment.lastFailure = "An item sold out while the customer was paying.";
    return false;
  }
  payment.paidAmount = payment.amount;
  payment.chargeId = paid.chargeId;
  payment.paymentType = paid.paymentType;
  payment.receiptUrl = paid.receiptUrl;
  payment.paidAt = iso(now + 2000);
  payment.checkoutUrl = null;
  payment.checkoutExpiresAt = null;
  payment.lastFailure = null;
  order.pendingUntil = null;
  const invoice = issueInvoice(db, order, now + 2000);
  pushHistory(
    order,
    {
      field: "order",
      from: "pending_payment",
      to: "confirmed",
      by: "system",
      note: "Payment received",
    },
    now + 2000,
  );
  order.status = "confirmed";
  pushHistory(
    order,
    {
      field: "payment",
      from: "authorized",
      to: "paid",
      by: "system",
      note: `Stripe ${paid.paymentType} ${paid.paymentIntentId}`,
    },
    now + 2000,
  );
  order.paymentStatus = "paid";
  // The payment counts the use of a discount code (26).
  settleDiscountUse(db, order, "used", now + 2000);
  const customer = customerOf(db, order);
  if (customer) {
    queueMessage(
      db,
      {
        type: "order_confirmed",
        customer,
        order,
        attachInvoiceId: invoice.id,
        data: {
          total: order.totals.total,
          paymentMethod: paid.paymentType,
          invoiceNumber: invoice.number,
        },
      },
      now + 3000,
    );
  }
  return true;
}

/** A failed attempt: the customer can pay again (9.1, 13.1). */
export function failPayment(
  db: Db,
  order: OrderRecord,
  reason: string,
  now: number,
): void {
  pushHistory(
    order,
    {
      field: "payment",
      from: order.paymentStatus,
      to: "failed",
      by: "system",
      note: reason,
    },
    now,
  );
  order.paymentStatus = "failed";
  order.payment.lastFailure = reason;
  const customer = customerOf(db, order);
  if (customer) {
    queueMessage(
      db,
      {
        type: "payment_failed",
        customer,
        order,
        data: { reason, amount: order.payment.amount },
      },
      now + 1000,
    );
  }
}

/**
 * Cancels an order (9): the units go back when they were taken, an open
 * payment page is closed, the customer is told, and what was paid waits
 * for a refund the admin decides.
 */
export function cancelOrder(
  db: Db,
  order: OrderRecord,
  cancellation: {
    reason: CancellationReason;
    text: string | null;
    by: "customer" | "admin" | "system";
    adminId: string | null;
  },
  now: number,
  options: { email?: boolean } = {},
): void {
  if (order.status === "cancelled") return;
  const from = order.status;
  order.status = "cancelled";
  order.cancellation = { ...cancellation, at: iso(now) };
  giveBackStock(db, order, now);
  // An order given up unpaid gives its use of a discount code back (26).
  if (order.payment.paidAmount === 0)
    settleDiscountUse(db, order, "released", now);
  order.payment.checkoutUrl = null;
  order.payment.checkoutExpiresAt = null;
  order.pendingUntil = null;
  pushHistory(
    order,
    {
      field: "order",
      from,
      to: "cancelled",
      by: cancellation.by,
      adminId: cancellation.adminId,
      note: cancellation.text,
    },
    now,
  );
  const customer = customerOf(db, order);
  if (customer && options.email !== false) {
    queueMessage(
      db,
      {
        type: "order_cancelled",
        customer,
        order,
        data: {
          reason: cancellation.reason,
          paidAmount: order.payment.paidAmount,
        },
      },
      now + 1000,
    );
  }
}

/**
 * The checkout cleanup (architecture 7.3): orders that are pending past
 * `pendingUntil` are given up by the shop, without an email.
 */
export function runCheckoutCleanup(
  db: Db,
  now: number,
): { expired: number; settled: number } {
  let expired = 0;
  for (const order of db.orders) {
    if (
      order.status === "pending_payment" &&
      order.pendingUntil &&
      Date.parse(order.pendingUntil) <= now
    ) {
      cancelOrder(
        db,
        order,
        {
          reason: "payment_not_completed",
          text: null,
          by: "system",
          adminId: null,
        },
        now,
        { email: false },
      );
      expired += 1;
    }
  }
  return { expired, settled: 0 };
}
