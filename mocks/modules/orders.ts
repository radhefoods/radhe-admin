// Sections 9 (orders) and 10 (returns).

import { z } from "zod";
import type { OrderReturn } from "../../src/lib/api/types/index.ts";
import type { Db, OrderRecord } from "../db.ts";
import {
  CANCELLABLE,
  CHANGEABLE,
  ORDER_ALLOWED,
  customerOf,
  issueCreditNote,
  orderDetail,
  orderNeedsRefund,
  orderSummary,
  pushHistory,
  queueMessage,
  recomputeFinal,
} from "../domain.ts";
import {
  boolParam,
  enumParam,
  fail,
  idParam,
  json,
  searchParam,
  sortedCursorPage,
  validationFailed,
  wordsMatch,
  zId,
  zNote,
} from "../http.ts";
import {
  cancelOrder,
  setDeliveryMethod,
  setOrderStatus,
} from "../order-ops.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";
import { releaseUnits, restockReturn } from "./stock.ts";

const ORDER_STATUSES = [
  "pending_payment",
  "confirmed",
  "processing",
  "dispatched",
  "delivered",
  "cancelled",
  "returned",
] as const;
const PAYMENT_STATUSES = [
  "pending",
  "authorized",
  "paid",
  "failed",
  "refunded",
] as const;
const METHODS = ["radhe_delivery", "dhl", "hermes"] as const;
const RETURN_STATUSES = [
  "requested",
  "approved",
  "rejected",
  "completed",
  "cancelled",
] as const;

const zTracking = z
  .string()
  .regex(
    /^[A-Za-z0-9-]{4,60}$/,
    "trackingNumber must be 4 to 60 letters, digits or hyphens",
  );

export function orderById(db: Db, id: string): OrderRecord {
  const order = db.orders.find((entry) => entry.id === id);
  if (!order) throw fail(404, "ORDER_NOT_FOUND", "The order was not found.");
  return order;
}

function assertChangeable(order: OrderRecord): void {
  if (!CHANGEABLE.includes(order.status)) {
    throw fail(
      409,
      "ORDER_CANNOT_BE_CHANGED",
      "The order can no longer be changed.",
      {
        status: order.status,
        allowedIn: CHANGEABLE,
      },
    );
  }
}

function returnById(db: Db, id: string): OrderReturn {
  const found = db.returns.find((entry) => entry.id === id);
  if (!found) throw fail(404, "RETURN_NOT_FOUND", "The return was not found.");
  return found;
}

function moveReturn(
  record: OrderReturn,
  to: OrderReturn["status"],
  allowedFrom: OrderReturn["status"][],
  adminId: string,
  note: string | undefined,
  now: number,
): void {
  if (!allowedFrom.includes(record.status)) {
    throw fail(
      409,
      "RETURN_TRANSITION_NOT_ALLOWED",
      "This change of status is not allowed.",
      {
        from: record.status,
        to,
      },
    );
  }
  record.statusHistory.push({
    from: record.status,
    to,
    at: iso(now),
    by: "admin",
    adminId,
    note: note ?? null,
  });
  record.status = to;
  record.updatedAt = iso(now);
}

const decisionBody = z.strictObject({
  note: z.string().max(1000).optional(),
  internalNote: z.string().max(2000).optional(),
});

export function registerOrders(router: Router): void {
  const base = "/v1/admin/orders";

  /** The filters of the list and of `/count` (9). */
  const filteredOrders = (ctx: { db: Db; query: URLSearchParams }) => {
    const customerId = idParam(ctx.query, "customerId");
    const status = enumParam(ctx.query, "status", ORDER_STATUSES);
    const paymentStatus = enumParam(
      ctx.query,
      "paymentStatus",
      PAYMENT_STATUSES,
    );
    const deliveryMethod = enumParam(ctx.query, "deliveryMethod", METHODS);
    const needsRefund = boolParam(ctx.query, "needsRefund");
    const orderNumber = ctx.query.get("orderNumber")?.trim().toUpperCase();
    const email = ctx.query.get("email")?.trim().toLowerCase();
    const q = searchParam(ctx.query);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw validationFailed([
        { field: "email", problems: ["email must be an email"] },
      ]);
    }
    return ctx.db.orders.filter(
      (order) =>
        (!customerId || order.customer.id === customerId) &&
        (!status || order.status === status) &&
        (!paymentStatus || order.paymentStatus === paymentStatus) &&
        (!deliveryMethod || order.delivery.method === deliveryMethod) &&
        (needsRefund === undefined ||
          orderNeedsRefund(order) === needsRefund) &&
        (!orderNumber || order.orderNumber === orderNumber) &&
        (!email || order.customer.email === email) &&
        wordsMatch(q, [
          order.orderNumber,
          `${order.customer.firstName ?? ""} ${order.customer.lastName ?? ""}`,
          order.customer.email,
          order.customer.phone,
        ]),
    );
  };

  router.get(`${base}/count`, { permission: "orders.read" }, (ctx) =>
    json({ total: filteredOrders(ctx).length }),
  );

  // --- Chosen orders at once (9) --------------------------------------------

  const chosen = z.array(zId).min(1).max(500);
  const BULK_FROM: Record<"processing" | "dispatched" | "delivered", string[]> =
    {
      processing: ["confirmed"],
      dispatched: ["confirmed", "processing"],
      delivered: ["dispatched"],
    };

  router.post(
    `${base}/bulk/status`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          orderIds: chosen,
          status: z.enum(["processing", "dispatched", "delivered"]),
          note: zNote(500),
        }),
      );
      const seen = new Set<string>();
      const results = input.orderIds
        .filter((orderId) => {
          if (seen.has(orderId)) return false;
          seen.add(orderId);
          return true;
        })
        .map((orderId) => {
          const order = ctx.db.orders.find((entry) => entry.id === orderId);
          if (!order) {
            return {
              orderId,
              orderNumber: null,
              changed: false,
              reason: "Order not found.",
            };
          }
          if (!BULK_FROM[input.status].includes(order.status)) {
            return {
              orderId,
              orderNumber: order.orderNumber,
              changed: false,
              reason: `An order that is "${order.status}" cannot be set to "${input.status}".`,
            };
          }
          setOrderStatus(
            ctx.db,
            order,
            input.status,
            { adminId: ctx.admin.id, note: input.note },
            ctx.now,
          );
          return {
            orderId,
            orderNumber: order.orderNumber,
            changed: true,
            reason: null,
          };
        });
      return json({
        status: input.status,
        changed: results.filter((entry) => entry.changed).length,
        results,
      });
    },
  );

  router.post(
    `${base}/bulk/delivery-method`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          orderIds: chosen,
          method: z.enum(METHODS),
          note: zNote(500),
        }),
      );
      const seen = new Set<string>();
      const results = input.orderIds
        .filter((orderId) => {
          if (seen.has(orderId)) return false;
          seen.add(orderId);
          return true;
        })
        .map((orderId) => {
          const order = ctx.db.orders.find((entry) => entry.id === orderId);
          if (!order) {
            return {
              orderId,
              orderNumber: null,
              changed: false,
              reason: "Order not found.",
            };
          }
          if (!CHANGEABLE.includes(order.status)) {
            return {
              orderId,
              orderNumber: order.orderNumber,
              changed: false,
              reason: `The delivery of an order that is "${order.status}" cannot be changed.`,
            };
          }
          if (order.delivery.method === input.method) {
            return {
              orderId,
              orderNumber: order.orderNumber,
              changed: false,
              reason: `The order is delivered by "${input.method}" already.`,
            };
          }
          setDeliveryMethod(
            order,
            input.method,
            { adminId: ctx.admin.id, note: input.note },
            ctx.now,
          );
          return {
            orderId,
            orderNumber: order.orderNumber,
            changed: true,
            reason: null,
          };
        });
      return json({
        method: input.method,
        changed: results.filter((entry) => entry.changed).length,
        results,
      });
    },
  );

  router.get(base, { permission: "orders.read" }, (ctx) => {
    const rows = filteredOrders(ctx);
    const result = sortedCursorPage(rows, ctx.query, {
      createdAt: (order) => order.placedAt,
      total: (order) => order.finalTotals.total,
      status: (order) => order.status,
      paymentStatus: (order) => order.paymentStatus,
    });
    return json({ ...result, items: result.items.map(orderSummary) });
  });

  router.get(`${base}/:id`, { permission: "orders.read" }, (ctx) =>
    json({
      order: orderDetail(
        ctx.db,
        orderById(ctx.db, ctx.params.id ?? ""),
        ctx.now,
      ),
    }),
  );

  router.post(
    `${base}/:id/status`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          status: z.enum([
            "confirmed",
            "processing",
            "dispatched",
            "delivered",
          ]),
          trackingNumber: zTracking.optional(),
          note: zNote(500),
        }),
      );
      const order = orderById(ctx.db, ctx.params.id ?? "");
      if (order.status !== input.status) {
        const allowed = ORDER_ALLOWED[order.status];
        if (!allowed.includes(input.status)) {
          throw fail(
            409,
            "ORDER_TRANSITION_NOT_ALLOWED",
            "This change of status is not allowed.",
            {
              from: order.status,
              to: input.status,
              allowed,
            },
          );
        }
        if (input.trackingNumber)
          order.delivery.trackingNumber = input.trackingNumber;
        setOrderStatus(
          ctx.db,
          order,
          input.status,
          { adminId: ctx.admin.id, note: input.note },
          ctx.now,
        );
      }
      return json({ order: orderDetail(ctx.db, order, ctx.now) });
    },
  );

  router.patch(
    `${base}/:id/delivery`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          method: z.enum(METHODS).optional(),
          trackingNumber: zTracking.nullish(),
          note: zNote(500),
        }),
      );
      const order = orderById(ctx.db, ctx.params.id ?? "");
      assertChangeable(order);
      if (input.method !== undefined) {
        setDeliveryMethod(
          order,
          input.method,
          { adminId: ctx.admin.id, note: input.note },
          ctx.now,
        );
      }
      if (
        input.trackingNumber !== undefined &&
        input.trackingNumber !== order.delivery.trackingNumber
      ) {
        // A tracking number alone is not recorded in the history (9).
        order.delivery.trackingNumber = input.trackingNumber;
        order.updatedAt = iso(ctx.now);
      }
      return json({ order: orderDetail(ctx.db, order, ctx.now) });
    },
  );

  router.patch(
    `${base}/:id/items/:productId`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          deliveredQuantity: z.number().int().min(0).max(10000),
          reason: z.enum([
            "missing",
            "damaged",
            "wrong_item",
            "customer_complaint",
            "other",
          ]),
          note: zNote(1000),
        }),
      );
      const order = orderById(ctx.db, ctx.params.id ?? "");
      const item = order.items.find(
        (entry) => entry.productId === ctx.params.productId,
      );
      if (!item)
        throw fail(
          404,
          "ORDER_ITEM_NOT_FOUND",
          "The order does not contain this product.",
        );
      assertChangeable(order);
      if (
        input.deliveredQuantity < item.returnedQuantity ||
        input.deliveredQuantity > item.quantity
      ) {
        throw fail(
          400,
          "ORDER_QUANTITY_INVALID",
          "The quantity is not possible.",
          {
            min: item.returnedQuantity,
            max: item.quantity,
          },
        );
      }
      if (input.deliveredQuantity !== item.deliveredQuantity) {
        const before = order.finalTotals.total;
        const from = item.deliveredQuantity;
        order.adjustments.push({
          productId: item.productId,
          sku: item.sku,
          from,
          to: input.deliveredQuantity,
          reason: input.reason,
          note: input.note ?? null,
          adminId: ctx.admin.id,
          at: iso(ctx.now),
        });
        item.deliveredQuantity = input.deliveredQuantity;
        recomputeFinal(order);
        order.updatedAt = iso(ctx.now);
        // Units that were not delivered go back to the stock (9).
        releaseUnits(
          ctx.db,
          order,
          item.productId,
          from - input.deliveredQuantity,
          ctx.now,
        );
        // Every confirmed order has an invoice: the difference is a credit note.
        if (before > order.finalTotals.total) {
          issueCreditNote(
            ctx.db,
            order,
            before - order.finalTotals.total,
            "adjustment",
            ctx.now,
            `${item.sku}: ${input.reason}`,
          );
        }
      }
      return json({ order: orderDetail(ctx.db, order, ctx.now) });
    },
  );

  router.post(
    `${base}/:id/cancel`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          reason: z.enum([
            "customer_request",
            "product_unavailable",
            "duplicate_order",
            "suspected_misuse",
            "other",
          ]),
          text: zNote(1000),
        }),
      );
      const order = orderById(ctx.db, ctx.params.id ?? "");
      if (order.status !== "cancelled") {
        if (!CANCELLABLE.includes(order.status)) {
          throw fail(
            409,
            "ORDER_CANNOT_BE_CANCELLED",
            "The order can no longer be cancelled.",
            {
              status: order.status,
            },
          );
        }
        cancelOrder(
          ctx.db,
          order,
          {
            reason: input.reason,
            text: input.text ?? null,
            by: "admin",
            adminId: ctx.admin.id,
          },
          ctx.now,
        );
      }
      return json({ order: orderDetail(ctx.db, order, ctx.now) });
    },
  );

  // --- Returns (10) ---------------------------------------------------------
  const returns = "/v1/admin/returns";

  const filteredReturns = (ctx: { db: Db; query: URLSearchParams }) => {
    const status = enumParam(ctx.query, "status", RETURN_STATUSES);
    const customerId = idParam(ctx.query, "customerId");
    const orderNumber = ctx.query.get("orderNumber")?.trim().toUpperCase();
    return ctx.db.returns.filter(
      (entry) =>
        (!status || entry.status === status) &&
        (!customerId || entry.customerId === customerId) &&
        (!orderNumber || entry.orderNumber === orderNumber),
    );
  };

  router.get(`${returns}/count`, { permission: "orders.read" }, (ctx) =>
    json({ total: filteredReturns(ctx).length }),
  );

  router.get(returns, { permission: "orders.read" }, (ctx) =>
    json(
      sortedCursorPage(filteredReturns(ctx), ctx.query, {
        createdAt: (entry) => entry.requestedAt,
        status: (entry) => entry.status,
      }),
    ),
  );

  router.get(`${returns}/:id`, { permission: "orders.read" }, (ctx) =>
    json({ return: returnById(ctx.db, ctx.params.id ?? "") }),
  );

  router.post(
    `${returns}/:id/approve`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          items: z
            .array(
              z.strictObject({
                productId: zId,
                quantity: z.number().int().min(0).max(10000),
              }),
            )
            .optional(),
          note: z.string().max(1000).optional(),
          internalNote: z.string().max(2000).optional(),
        }),
      );
      const record = returnById(ctx.db, ctx.params.id ?? "");
      if (record.status === "approved") return json({ return: record });
      if (record.status !== "requested") {
        throw fail(
          409,
          "RETURN_TRANSITION_NOT_ALLOWED",
          "This change of status is not allowed.",
          {
            from: record.status,
            to: "approved",
          },
        );
      }
      const quantities = new Map(
        record.items.map((item) => [item.productId, item.quantity]),
      );
      if (input.items) {
        const unknown = input.items
          .map((item) => item.productId)
          .filter((id) => !quantities.has(id));
        if (unknown.length > 0) {
          throw fail(
            400,
            "ORDER_ITEM_NOT_FOUND",
            "The return does not contain these products.",
            {
              productIds: unknown,
            },
          );
        }
        for (const item of input.items) {
          if (item.quantity > (quantities.get(item.productId) ?? 0)) {
            throw fail(
              400,
              "RETURN_QUANTITY_INVALID",
              "More than the customer asked to return.",
              {
                productId: item.productId,
                max: quantities.get(item.productId),
              },
            );
          }
          quantities.set(item.productId, item.quantity);
        }
        if ([...quantities.values()].every((quantity) => quantity === 0)) {
          throw fail(
            400,
            "RETURN_QUANTITY_INVALID",
            "Nothing is accepted. Reject the return instead.",
          );
        }
      }
      moveReturn(
        record,
        "approved",
        ["requested"],
        ctx.admin.id,
        input.note,
        ctx.now,
      );
      for (const item of record.items)
        item.approvedQuantity = quantities.get(item.productId) ?? 0;
      record.decidedAt = iso(ctx.now);
      record.decisionNote = input.note ?? null;
      if (input.internalNote !== undefined)
        record.internalNote = input.internalNote;
      const order = ctx.db.orders.find((entry) => entry.id === record.orderId);
      const customer = order ? customerOf(ctx.db, order) : undefined;
      if (order && customer) {
        queueMessage(
          ctx.db,
          { type: "return_approved", customer, order, returnId: record.id },
          ctx.now,
        );
      }
      return json({ return: record });
    },
  );

  router.post(
    `${returns}/:id/reject`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(decisionBody);
      const record = returnById(ctx.db, ctx.params.id ?? "");
      moveReturn(
        record,
        "rejected",
        ["requested", "approved"],
        ctx.admin.id,
        input.note,
        ctx.now,
      );
      record.decidedAt = iso(ctx.now);
      record.decisionNote = input.note ?? record.decisionNote;
      if (input.internalNote !== undefined)
        record.internalNote = input.internalNote;
      const order = ctx.db.orders.find((entry) => entry.id === record.orderId);
      const customer = order ? customerOf(ctx.db, order) : undefined;
      if (order && customer) {
        queueMessage(
          ctx.db,
          { type: "return_rejected", customer, order, returnId: record.id },
          ctx.now,
        );
      }
      return json({ return: record });
    },
  );

  router.post(
    `${returns}/:id/complete`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        decisionBody.extend({ restock: z.boolean().optional() }),
      );
      const record = returnById(ctx.db, ctx.params.id ?? "");
      if (record.status === "completed") return json({ return: record });
      if (record.status !== "approved") {
        throw fail(
          409,
          "RETURN_TRANSITION_NOT_ALLOWED",
          "Only an approved return can be completed.",
          {
            from: record.status,
            to: "completed",
          },
        );
      }
      const order = orderById(ctx.db, record.orderId);
      for (const item of record.items) {
        const line = order.items.find(
          (entry) => entry.productId === item.productId,
        );
        const approved = item.approvedQuantity ?? 0;
        if (
          !line ||
          approved > line.deliveredQuantity - line.returnedQuantity
        ) {
          throw fail(
            409,
            "RETURN_QUANTITY_INVALID",
            "More than was delivered.",
            {
              productId: item.productId,
              sku: item.sku,
            },
          );
        }
      }
      const before = order.finalTotals.total;
      for (const item of record.items) {
        const line = order.items.find(
          (entry) => entry.productId === item.productId,
        );
        if (line) line.returnedQuantity += item.approvedQuantity ?? 0;
      }
      recomputeFinal(order);
      const credit = before - order.finalTotals.total;
      moveReturn(
        record,
        "completed",
        ["approved"],
        ctx.admin.id,
        input.note,
        ctx.now,
      );
      record.completedAt = iso(ctx.now);
      record.creditAmount = credit;
      if (input.note !== undefined) record.decisionNote = input.note;
      if (input.internalNote !== undefined)
        record.internalNote = input.internalNote;
      if (input.restock) {
        restockReturn(
          ctx.db,
          order,
          record.items.map((item) => ({
            productId: item.productId,
            quantity: item.approvedQuantity ?? 0,
          })),
          ctx.now,
        );
        record.restockedAt = iso(ctx.now);
      }
      issueCreditNote(
        ctx.db,
        order,
        credit,
        "return",
        ctx.now,
        record.returnNumber,
      );
      // Nothing was kept: the order counts as returned.
      if (
        order.items.every(
          (item) => item.deliveredQuantity - item.returnedQuantity <= 0,
        )
      ) {
        pushHistory(
          order,
          { field: "order", from: order.status, to: "returned", by: "system" },
          ctx.now,
        );
        order.status = "returned";
      }
      order.updatedAt = iso(ctx.now);
      const customer = customerOf(ctx.db, order);
      if (customer) {
        queueMessage(
          ctx.db,
          {
            type: "return_completed",
            customer,
            order,
            returnId: record.id,
            data: { creditAmount: credit },
          },
          ctx.now,
        );
      }
      return json({ return: record });
    },
  );
}
