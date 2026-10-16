// Section 8: the stock of a product and its history. The orders, returns
// and import modules take and give back units through these helpers, so
// every change is one line of the ledger.

import { z } from "zod";
import type {
  StockMovement,
  StockMovementReason,
} from "../../src/lib/api/types/index.ts";
import type { Db, OrderRecord, ProductRecord } from "../db.ts";
import { productDetail } from "../domain.ts";
import { fail, json, newId, sortedCursorPage } from "../http.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";

export interface MovementContext {
  orderId?: string | null;
  orderNumber?: string | null;
  adminId?: string | null;
  note?: string | null;
}

/** Changes the count by `delta` and writes the line of the ledger. */
export function recordMovement(
  db: Db,
  product: ProductRecord,
  reason: StockMovementReason,
  delta: number,
  context: MovementContext,
  now: number,
): StockMovement {
  product.stock.quantity += delta;
  product.updatedAt = iso(now);
  const movement: StockMovement = {
    id: newId(now),
    reason,
    delta,
    quantityAfter: product.stock.quantity,
    orderId: context.orderId ?? null,
    orderNumber: context.orderNumber ?? null,
    adminId: context.adminId ?? null,
    note: context.note ?? null,
    createdAt: iso(now),
  };
  db.stockMovements.push({ ...movement, productId: product.id });
  return movement;
}

function productOf(db: Db, id: string): ProductRecord | undefined {
  return db.products.find((entry) => entry.id === id);
}

/**
 * Takes the units of an order off the shelf (reason `order`), one item
 * after the other. When an item sold out meanwhile, what was taken goes
 * back (`release`) and the order cannot be settled.
 */
export function takeStock(db: Db, order: OrderRecord, now: number): boolean {
  const taken: { product: ProductRecord; quantity: number }[] = [];
  for (const item of order.items) {
    const product = productOf(db, item.productId);
    if (!product || product.stock.quantity < item.quantity) {
      for (const entry of taken) {
        recordMovement(
          db,
          entry.product,
          "release",
          entry.quantity,
          { orderId: order.id, orderNumber: order.orderNumber },
          now,
        );
      }
      return false;
    }
    recordMovement(
      db,
      product,
      "order",
      -item.quantity,
      { orderId: order.id, orderNumber: order.orderNumber },
      now,
    );
    taken.push({ product, quantity: item.quantity });
  }
  order.stockTakenAt = iso(now);
  return true;
}

/** Gives the units of a cancelled order back (reason `cancel`). */
export function giveBackStock(db: Db, order: OrderRecord, now: number): void {
  if (!order.stockTakenAt) return;
  for (const item of order.items) {
    const product = productOf(db, item.productId);
    if (!product) continue;
    recordMovement(
      db,
      product,
      "cancel",
      item.quantity,
      { orderId: order.id, orderNumber: order.orderNumber },
      now,
    );
  }
  order.stockTakenAt = null;
}

/** Units that were not delivered after a correction go back (reason `release`). */
export function releaseUnits(
  db: Db,
  order: OrderRecord,
  productId: string,
  units: number,
  now: number,
): void {
  const product = productOf(db, productId);
  if (!product || units <= 0) return;
  recordMovement(
    db,
    product,
    "release",
    units,
    { orderId: order.id, orderNumber: order.orderNumber },
    now,
  );
}

/** The accepted units of a completed return go back on the shelf (reason `return`). */
export function restockReturn(
  db: Db,
  order: OrderRecord,
  items: { productId: string; quantity: number }[],
  now: number,
): void {
  for (const item of items) {
    const product = productOf(db, item.productId);
    if (!product || item.quantity <= 0) continue;
    recordMovement(
      db,
      product,
      "return",
      item.quantity,
      { orderId: order.id, orderNumber: order.orderNumber },
      now,
    );
  }
}

const stockBody = z.strictObject({
  quantity: z.number().int().min(0).max(1_000_000).optional(),
  delta: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  note: z.string().max(500).optional(),
});

export function registerStock(router: Router): void {
  const products = "/v1/admin/products";

  router.post(
    `${products}/:id/stock`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(stockBody);
      const product = productOf(ctx.db, ctx.params.id ?? "");
      if (!product)
        throw fail(404, "PRODUCT_NOT_FOUND", "The product was not found.");
      const hasQuantity = input.quantity !== undefined;
      const hasDelta = input.delta !== undefined;
      if (hasQuantity === hasDelta) {
        throw fail(
          400,
          "STOCK_CHANGE_INVALID",
          "Send either quantity or delta, not both.",
        );
      }
      const delta = hasQuantity
        ? (input.quantity as number) - product.stock.quantity
        : (input.delta as number);
      if (product.stock.quantity + delta < 0) {
        throw fail(
          409,
          "STOCK_INSUFFICIENT",
          "More units would be removed than are in stock.",
          {
            productId: product.id,
            sku: product.sku,
            available: product.stock.quantity,
            wanted: -delta,
          },
        );
      }
      const movement =
        delta === 0
          ? null
          : recordMovement(
              ctx.db,
              product,
              delta > 0 && hasDelta ? "restock" : "adjustment",
              delta,
              { adminId: ctx.admin.id, note: input.note ?? null },
              ctx.now,
            );
      return json({ product: productDetail(ctx.db, product), movement });
    },
  );

  router.get(
    `${products}/:id/stock/movements`,
    { permission: "catalog.read" },
    (ctx) => {
      const product = productOf(ctx.db, ctx.params.id ?? "");
      if (!product)
        throw fail(404, "PRODUCT_NOT_FOUND", "The product was not found.");
      const rows = ctx.db.stockMovements
        .filter((entry) => entry.productId === product.id)
        .map(({ productId: _productId, ...movement }) => movement);
      return json(
        sortedCursorPage(rows, ctx.query, {
          createdAt: (entry) => entry.createdAt,
        }),
      );
    },
  );
}
