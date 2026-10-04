// Sections 10 (orders) and 11 (returns).

import { z } from "zod";
import type {
  OrderReturn,
  OrderStatus,
} from "../../src/lib/api/types/index.ts";
import type { CargoRecord, Db, OrderRecord } from "../db.ts";
import {
  CANCELLABLE,
  CHANGEABLE,
  MOVABLE,
  ORDER_ALLOWED,
  customerOf,
  issueCreditNote,
  orderDetail,
  orderSummary,
  pushHistory,
  queueMessage,
  recomputeFinal,
  reserve,
} from "../domain.ts";
import {
  cursorPage,
  enumParam,
  fail,
  idParam,
  json,
  validationFailed,
  zId,
  zNote,
} from "../http.ts";
import {
  assertCanTakeOrders,
  moveOrder,
  setDeliveryMethod,
  setOrderStatus,
} from "../order-ops.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";

const ORDER_STATUSES = [
  "confirmed",
  "preparing",
  "dispatched",
  "delivered",
  "delivery_failed",
  "cancelled",
  "returned",
] as const;
const PAYMENT_STATUSES = [
  "not_enabled",
  "due",
  "overdue",
  "paid",
  "waived",
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

  router.get(base, { permission: "orders.read" }, (ctx) => {
    const cargoId = idParam(ctx.query, "cargoId");
    const customerId = idParam(ctx.query, "customerId");
    const status = enumParam(ctx.query, "status", ORDER_STATUSES);
    const paymentStatus = enumParam(
      ctx.query,
      "paymentStatus",
      PAYMENT_STATUSES,
    );
    const deliveryMethod = enumParam(ctx.query, "deliveryMethod", METHODS);
    const orderNumber = ctx.query.get("orderNumber")?.trim().toUpperCase();
    const email = ctx.query.get("email")?.trim().toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw validationFailed([
        { field: "email", problems: ["email must be an email"] },
      ]);
    }
    const rows = ctx.db.orders.filter(
      (order) =>
        (!cargoId || order.cargo.id === cargoId) &&
        (!customerId || order.customer.id === customerId) &&
        (!status || order.status === status) &&
        (!paymentStatus || order.paymentStatus === paymentStatus) &&
        (!deliveryMethod || order.delivery.method === deliveryMethod) &&
        (!orderNumber || order.orderNumber === orderNumber) &&
        (!email || order.customer.email === email),
    );
    const result = cursorPage(rows, ctx.query);
    return json({ ...result, items: result.items.map(orderSummary) });
  });

  router.get(`${base}/summary`, { permission: "orders.read" }, (ctx) => {
    const cargoId = idParam(ctx.query, "cargoId");
    if (!cargoId) {
      throw validationFailed([
        { field: "cargoId", problems: ["cargoId must be a mongodb id"] },
      ]);
    }
    const all = ctx.db.orders.filter((order) => order.cargo.id === cargoId);
    const live = all.filter((order) => order.status !== "cancelled");
    const byStatus = new Map<OrderStatus, { orders: number; value: number }>();
    for (const order of all) {
      const entry = byStatus.get(order.status) ?? { orders: 0, value: 0 };
      entry.orders += 1;
      entry.value += order.totals.total;
      byStatus.set(order.status, entry);
    }
    return json({
      cargoId,
      summary: {
        orders: live.length,
        cancelledOrders: all.length - live.length,
        customers: new Set(live.map((order) => order.customer.id)).size,
        units: live.reduce(
          (sum, order) =>
            sum + order.items.reduce((units, item) => units + item.quantity, 0),
          0,
        ),
        bookedValue: live.reduce((sum, order) => sum + order.totals.total, 0),
        byStatus: ORDER_STATUSES.filter((status) => byStatus.has(status)).map(
          (status) => ({
            status,
            ...(byStatus.get(status) as { orders: number; value: number }),
          }),
        ),
      },
    });
  });

  router.get(`${base}/:id`, { permission: "orders.read" }, (ctx) =>
    json({
      order: orderDetail(ctx.db, orderById(ctx.db, ctx.params.id ?? "")),
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
            "preparing",
            "dispatched",
            "delivered",
            "delivery_failed",
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
      return json({ order: orderDetail(ctx.db, order) });
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
        const from = order.delivery.trackingNumber;
        order.delivery.trackingNumber = input.trackingNumber;
        pushHistory(
          order,
          {
            field: "delivery",
            from: from ? `tracking ${from}` : null,
            to: input.trackingNumber
              ? `tracking ${input.trackingNumber}`
              : "tracking removed",
            adminId: ctx.admin.id,
            note: input.note,
          },
          ctx.now,
        );
      }
      return json({ order: orderDetail(ctx.db, order) });
    },
  );

  router.post(
    `${base}/:id/move`,
    { permission: "orders.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({ cargoId: zId, note: zNote(500) }),
      );
      const order = orderById(ctx.db, ctx.params.id ?? "");
      if (!MOVABLE.includes(order.status)) {
        throw fail(
          409,
          "ORDER_CANNOT_BE_MOVED",
          "The order cannot be moved in its status.",
          {
            status: order.status,
            allowedIn: MOVABLE,
          },
        );
      }
      const target = ctx.db.cargos.find(
        (entry) => entry.id === input.cargoId,
      ) as CargoRecord | undefined;
      if (!target)
        throw fail(404, "CARGO_NOT_FOUND", "The cargo was not found.");
      assertCanTakeOrders(target);
      if (target.id !== order.cargo.id) {
        moveOrder(
          ctx.db,
          order,
          target,
          { adminId: ctx.admin.id, note: input.note },
          ctx.now,
        );
      }
      return json({ order: orderDetail(ctx.db, order) });
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
        order.adjustments.push({
          productId: item.productId,
          sku: item.sku,
          from: item.deliveredQuantity,
          to: input.deliveredQuantity,
          reason: input.reason,
          note: input.note ?? null,
          adminId: ctx.admin.id,
          at: iso(ctx.now),
        });
        item.deliveredQuantity = input.deliveredQuantity;
        recomputeFinal(order);
        order.updatedAt = iso(ctx.now);
        // An invoice exists already: the difference becomes a credit note.
        if (order.payment && before > order.finalTotals.total) {
          issueCreditNote(
            ctx.db,
            order,
            before - order.finalTotals.total,
            "adjustment",
            ctx.now,
          );
        }
      }
      return json({ order: orderDetail(ctx.db, order) });
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
            "cargo_cancelled",
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
        const from = order.status;
        order.status = "cancelled";
        order.cancellation = {
          reason: input.reason,
          text: input.text ?? null,
          by: "admin",
          adminId: ctx.admin.id,
          at: iso(ctx.now),
        };
        reserve(ctx.db, order, order.cargo.id, -1);
        pushHistory(
          order,
          {
            field: "order",
            from,
            to: "cancelled",
            adminId: ctx.admin.id,
            note: input.text,
          },
          ctx.now,
        );
        const customer = customerOf(ctx.db, order);
        if (customer)
          queueMessage(
            ctx.db,
            { type: "order_cancelled", customer, order },
            ctx.now,
          );
      }
      return json({ order: orderDetail(ctx.db, order) });
    },
  );

  // --- Returns (11) ---------------------------------------------------------
  const returns = "/v1/admin/returns";

  router.get(returns, { permission: "orders.read" }, (ctx) => {
    const status = enumParam(ctx.query, "status", RETURN_STATUSES);
    const customerId = idParam(ctx.query, "customerId");
    const orderNumber = ctx.query.get("orderNumber")?.trim().toUpperCase();
    const rows = ctx.db.returns.filter(
      (entry) =>
        (!status || entry.status === status) &&
        (!customerId || entry.customerId === customerId) &&
        (!orderNumber || entry.orderNumber === orderNumber),
    );
    return json(cursorPage(rows, ctx.query));
  });

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
            );
          }
          quantities.set(item.productId, item.quantity);
        }
        if ([...quantities.values()].every((quantity) => quantity === 0)) {
          throw fail(
            400,
            "RETURN_QUANTITY_INVALID",
            "Reject the return instead.",
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
      const input = await ctx.body(decisionBody);
      const record = returnById(ctx.db, ctx.params.id ?? "");
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
      if (order.payment) {
        issueCreditNote(
          ctx.db,
          order,
          credit,
          "return",
          ctx.now,
          record.returnNumber,
        );
      }
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
