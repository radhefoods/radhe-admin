// Section 8: the stock of a pack size and its history. The orders, returns
// and import modules take and give back units through these helpers, so
// every change is one line of the ledger of the pack size it belongs to.

import { z } from "zod";
import type {
  StockMovement,
  StockMovementReason,
} from "../../src/lib/api/types/index.ts";
import type { Db, OrderRecord, ProductRecord, VariantRecord } from "../db.ts";
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

/** Changes the count of a pack size by `delta` and writes the line of the ledger. */
export function recordMovement(
  db: Db,
  product: ProductRecord,
  variant: VariantRecord,
  reason: StockMovementReason,
  delta: number,
  context: MovementContext,
  now: number,
): StockMovement {
  variant.stock.quantity += delta;
  product.updatedAt = iso(now);
  const movement: StockMovement = {
    id: newId(now),
    variantId: variant.id,
    sku: variant.sku,
    reason,
    delta,
    quantityAfter: variant.stock.quantity,
    orderId: context.orderId ?? null,
    orderNumber: context.orderNumber ?? null,
    adminId: context.adminId ?? null,
    note: context.note ?? null,
    createdAt: iso(now),
  };
  db.stockMovements.push({ ...movement, productId: product.id });
  return movement;
}

/** The product and the pack size an order line points at. */
export function variantOf(
  db: Db,
  variantId: string,
): { product: ProductRecord; variant: VariantRecord } | undefined {
  for (const product of db.products) {
    const variant = product.variants.find((entry) => entry.id === variantId);
    if (variant) return { product, variant };
  }
  return undefined;
}

/**
 * Takes the units of an order off the shelf (reason `order`), one item
 * after the other. When a pack size sold out meanwhile, what was taken goes
 * back (`release`) and the order cannot be settled.
 */
export function takeStock(db: Db, order: OrderRecord, now: number): boolean {
  const taken: {
    product: ProductRecord;
    variant: VariantRecord;
    quantity: number;
  }[] = [];
  for (const item of order.items) {
    const found = variantOf(db, item.variantId);
    if (!found || found.variant.stock.quantity < item.quantity) {
      for (const entry of taken) {
        recordMovement(
          db,
          entry.product,
          entry.variant,
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
      found.product,
      found.variant,
      "order",
      -item.quantity,
      { orderId: order.id, orderNumber: order.orderNumber },
      now,
    );
    taken.push({ ...found, quantity: item.quantity });
  }
  order.stockTakenAt = iso(now);
  return true;
}

/** Gives the units of a cancelled order back (reason `cancel`). */
export function giveBackStock(db: Db, order: OrderRecord, now: number): void {
  if (!order.stockTakenAt) return;
  for (const item of order.items) {
    const found = variantOf(db, item.variantId);
    if (!found) continue;
    recordMovement(
      db,
      found.product,
      found.variant,
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
  variantId: string,
  units: number,
  now: number,
): void {
  const found = variantOf(db, variantId);
  if (!found || units <= 0) return;
  recordMovement(
    db,
    found.product,
    found.variant,
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
  items: { variantId: string; quantity: number }[],
  now: number,
): void {
  for (const item of items) {
    const found = variantOf(db, item.variantId);
    if (!found || item.quantity <= 0) continue;
    recordMovement(
      db,
      found.product,
      found.variant,
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

function lookUp(
  db: Db,
  productId: string,
  variantId: string,
): { product: ProductRecord; variant: VariantRecord } {
  const product = db.products.find((entry) => entry.id === productId);
  if (!product)
    throw fail(404, "PRODUCT_NOT_FOUND", "The product was not found.");
  const variant = product.variants.find((entry) => entry.id === variantId);
  if (!variant)
    throw fail(
      404,
      "PRODUCT_VARIANT_NOT_FOUND",
      "The pack size was not found.",
    );
  return { product, variant };
}

export function registerStock(router: Router): void {
  const variants = "/v1/admin/products/:id/variants/:variantId";

  router.post(
    `${variants}/stock`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(stockBody);
      const { product, variant } = lookUp(
        ctx.db,
        ctx.params.id ?? "",
        ctx.params.variantId ?? "",
      );
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
        ? (input.quantity as number) - variant.stock.quantity
        : (input.delta as number);
      if (variant.stock.quantity + delta < 0) {
        throw fail(
          409,
          "STOCK_INSUFFICIENT",
          "More units would be removed than are in stock.",
          {
            productId: product.id,
            variantId: variant.id,
            sku: variant.sku,
            available: variant.stock.quantity,
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
              variant,
              delta > 0 && hasDelta ? "restock" : "adjustment",
              delta,
              { adminId: ctx.admin.id, note: input.note ?? null },
              ctx.now,
            );
      return json({ product: productDetail(ctx.db, product), movement });
    },
  );

  router.get(
    `${variants}/stock/movements`,
    { permission: "catalog.read" },
    (ctx) => {
      const { variant } = lookUp(
        ctx.db,
        ctx.params.id ?? "",
        ctx.params.variantId ?? "",
      );
      const rows = ctx.db.stockMovements
        .filter((entry) => entry.variantId === variant.id)
        .map(({ productId: _productId, ...movement }) => movement);
      return json(
        sortedCursorPage(rows, ctx.query, {
          createdAt: (entry) => entry.createdAt,
        }),
      );
    },
  );
}
