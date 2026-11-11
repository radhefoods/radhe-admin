// Section 32: costs and profit of an order (doc/ORDER_PROFIT.md).

import { z } from "zod";
import type {
  OrderFigures,
  OrderProfit,
  PriceCalculation,
  PriceMode,
  PriceRule,
  ProfitLine,
  ProfitLineFigures,
} from "../../src/lib/api/types/index.ts";
import type { Db, OrderRecord } from "../db.ts";
import { vatOf } from "../domain.ts";
import { fail, json } from "../http.ts";
import type { Router } from "../router.ts";

/** Percent with at most two decimals. */
const twoDecimals = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;

const cost = z.number().int().min(0).max(1_000_000);

/** The whole document, every time; unknown keys are refused as the API refuses them. */
const orderCostsBody = z.strictObject({
  deliveryCost: cost,
  packagingCost: cost,
  otherCost: cost,
  paymentFee: z.strictObject({
    percent: z.number().min(0).max(100).refine(twoDecimals, {
      message: "percent must have at most 2 decimal places",
    }),
    fixed: z.number().int().min(0).max(10_000),
  }),
});

// --- What the real API copies into an order when it is placed ---------------------
//
// The buying price of every pack, the price rule of its product and the
// costs of an order. The demo orders do not carry them, so they are worked
// out here, the same way for the same order every time.

/** Cents with four decimals, as the API keeps them. */
const fine = (value: number) => {
  const rounded = Math.round(value * 10_000) / 10_000;
  return rounded === 0 ? 0 : rounded;
};

/** The owner's rule: 10 % fulfilment and 35 % markup on the buying price. */
const RULE: PriceRule = {
  fulfilmentPercent: 10,
  extraPercent: 0,
  extraAmount: 0,
  markupPercent: 35,
};

/** The digits of an article or order number: "RF-00042" is 42. */
const digitsOf = (text: string) => Number(text.replace(/\D/g, "")) || 0;

type Item = OrderRecord["items"][number];

/**
 * What one pack cost and how its price was set. Most prices follow the
 * rule; every fifth article has a price set by hand, above what the rule
 * gives; every ninth has no buying price, so that the panel can be seen
 * saying so.
 */
function costingOf(item: Item): {
  cost: number | null;
  priceMode: PriceMode;
} {
  const number = digitsOf(item.sku);
  if (number % 9 === 0) return { cost: null, priceMode: "auto" };
  const listed = item.regularUnitPrice ?? item.unitPrice;
  const net = listed / (1 + item.vatRate / 10_000);
  const manual = number % 5 === 0;
  // Rule: cost × 1.10 × 1.35 is the net price. By hand: sold dearer.
  return {
    cost: fine(net / (manual ? 1.75 : 1.485)),
    priceMode: manual ? "manual" : "auto",
  };
}

/** Model A: from the buying price to the price the rule gives. */
function priceFromCost(
  unitCost: number,
  rule: PriceRule,
  vatRate: number,
): PriceCalculation {
  const fulfilment = fine((unitCost * rule.fulfilmentPercent) / 100);
  const extra = fine((unitCost * rule.extraPercent) / 100 + rule.extraAmount);
  const markup = fine(
    ((unitCost + fulfilment + extra) * rule.markupPercent) / 100,
  );
  const net = fine(unitCost + fulfilment + extra + markup);
  const vat = fine((net * vatRate) / 10_000);
  return {
    cost: unitCost,
    fulfilment,
    extra,
    markup,
    net,
    vat,
    price: Math.round(net + vat),
  };
}

/**
 * The costs of an order as they were when it was placed. Every sixth demo
 * order is "from before they were kept" and has none.
 */
function snapshotOf(order: OrderRecord): OrderProfit["costs"] {
  if (digitsOf(order.orderNumber) % 6 === 0) return null;
  return {
    delivery: 450,
    packaging: 80,
    other: 20,
    paymentFeePercent: 1.5,
    paymentFeeFixed: 25,
  };
}

/** Units per pack size that came back through a return and went on the shelf again. */
function restockedOf(db: Db, order: OrderRecord): Map<string, number> {
  const restocked = new Map<string, number>();
  for (const record of db.returns) {
    if (record.orderId !== order.id) continue;
    if (record.status !== "completed" || !record.restockedAt) continue;
    for (const item of record.items) {
      const units = item.approvedQuantity ?? item.quantity;
      restocked.set(
        item.variantId,
        (restocked.get(item.variantId) ?? 0) + units,
      );
    }
  }
  return restocked;
}

// --- The breakdown, as `order-profit.ts` of the API works it out -----------------

const percent = (part: number, whole: number): number | null =>
  whole > 0 ? Number(((part * 100) / whole).toFixed(2)) : null;

const sum = (values: (number | null)[]): number =>
  fine(values.reduce<number>((total, value) => total + (value ?? 0), 0));

/** The net delivery fee of the agreed bill: its share of each VAT rate, without that VAT. */
function deliveryNetOf(order: OrderRecord): number {
  if (order.totals.deliveryFee === 0) return 0;
  const goods = new Map<number, number>();
  for (const item of order.items) {
    goods.set(item.vatRate, (goods.get(item.vatRate) ?? 0) + item.lineTotal);
  }
  let net = 0;
  for (const part of order.totals.vat) {
    const share = Math.max(0, part.gross - (goods.get(part.vatRate) ?? 0));
    net += share - vatOf(share, part.vatRate);
  }
  return net;
}

function figuresOf(
  unitCost: number | null,
  state: Pick<
    ProfitLineFigures,
    "units" | "gross" | "discount" | "vat" | "costUnits" | "handledUnits"
  >,
): ProfitLineFigures {
  const netRevenue = state.gross - state.vat;
  const buyingCost =
    unitCost === null ? null : fine(unitCost * state.costUnits);
  const fulfilmentCost =
    unitCost === null
      ? null
      : fine(((unitCost * RULE.fulfilmentPercent) / 100) * state.handledUnits);
  const extraCost =
    unitCost === null
      ? null
      : fine(
          ((unitCost * RULE.extraPercent) / 100 + RULE.extraAmount) *
            state.handledUnits,
        );
  const costs =
    unitCost === null
      ? null
      : (buyingCost as number) +
        (fulfilmentCost as number) +
        (extraCost as number);
  const profit = costs === null ? null : fine(netRevenue - costs);
  return {
    ...state,
    netRevenue,
    buyingCost,
    fulfilmentCost,
    extraCost,
    profit,
    marginPercent: profit === null ? null : percent(profit, netRevenue),
    markupPercent:
      profit === null || costs === null ? null : percent(profit, costs),
  };
}

export function orderProfitOf(db: Db, order: OrderRecord): OrderProfit {
  const cancelled = order.status === "cancelled";
  const paid = order.payment.paidAmount > 0;
  const dispatched =
    Boolean(order.delivery.dispatchedAt) ||
    ["dispatched", "delivered", "returned"].includes(order.status);
  const snapshot = snapshotOf(order);
  const restocked = restockedOf(db, order);

  const lines: ProfitLine[] = order.items.map((item) => {
    const kept = cancelled
      ? 0
      : Math.max(0, item.deliveredQuantity - item.returnedQuantity);
    const back = Math.min(
      item.returnedQuantity,
      restocked.get(item.variantId) ?? 0,
    );
    const { cost: unitCost, priceMode } = costingOf(item);
    return {
      productId: item.productId,
      variantId: item.variantId,
      sku: item.sku,
      name: item.name,
      packSize: { value: item.packSize.value, unit: item.packSize.unit },
      vatRate: item.vatRate,
      vatPercent: item.vatRate / 100,
      unit: {
        cost: unitCost,
        rule: RULE,
        priceMode,
        calculation:
          unitCost === null
            ? null
            : priceFromCost(unitCost, RULE, item.vatRate),
        price: item.unitPrice,
        regularPrice: item.regularUnitPrice,
      },
      quantity: {
        ordered: item.quantity,
        delivered: item.deliveredQuantity,
        returned: item.returnedQuantity,
        restocked: back,
        kept,
      },
      ordered: figuresOf(unitCost, {
        units: item.quantity,
        gross: item.lineTotal,
        discount: item.quantity * item.unitPrice - item.lineTotal,
        vat: vatOf(item.lineTotal, item.vatRate),
        costUnits: item.quantity,
        handledUnits: item.quantity,
      }),
      final: figuresOf(unitCost, {
        units: kept,
        gross: cancelled ? 0 : item.finalLineTotal,
        discount: cancelled ? 0 : kept * item.unitPrice - item.finalLineTotal,
        vat: cancelled ? 0 : vatOf(item.finalLineTotal, item.vatRate),
        // Kept by the customer, or come back and not put on the shelf.
        costUnits: cancelled ? 0 : kept + (item.returnedQuantity - back),
        // A cancelled order that never left was not packed.
        handledUnits: cancelled && !dispatched ? 0 : item.deliveredQuantity,
      }),
    };
  });

  // The fee of the payment: what Stripe reported, else the estimate that
  // was valid when the order was placed. In the demo, Stripe has reported
  // the fee of every second paid order.
  const estimate =
    snapshot && order.payment.amount > 0
      ? fine(
          (order.payment.amount * snapshot.paymentFeePercent) / 100 +
            snapshot.paymentFeeFixed,
        )
      : 0;
  const reported = paid && digitsOf(order.orderNumber) % 2 === 0;
  const actual = reported
    ? Math.round((order.payment.amount * 1.5) / 100) + 25
    : null;
  const known = actual ?? estimate;
  // Stripe keeps its fee when a payment is refunded. Without a payment,
  // there is none: expected while the order waits, never for one given up.
  const finalFee = paid ? known : cancelled ? 0 : estimate;

  const deliveryNet = deliveryNetOf(order);
  const figures = (
    which: "ordered" | "final",
    netTotal: number,
    delivery: number,
    perOrder: boolean,
    paymentFee: number,
    goodwill: number,
  ): OrderFigures => {
    const products = sum(lines.map((line) => line[which].netRevenue));
    const costs = {
      buying: sum(lines.map((line) => line[which].buyingCost)),
      fulfilment: sum(lines.map((line) => line[which].fulfilmentCost)),
      extra: sum(lines.map((line) => line[which].extraCost)),
      delivery: perOrder ? (snapshot?.delivery ?? 0) : 0,
      packaging: perOrder ? (snapshot?.packaging ?? 0) : 0,
      paymentFee,
      other: perOrder ? (snapshot?.other ?? 0) : 0,
      goodwill,
    };
    const total = sum(Object.values(costs));
    const netProfit = fine(netTotal - total);
    return {
      revenue: {
        products,
        delivery,
        vatRounding: fine(netTotal - products - delivery),
        total: netTotal,
      },
      costs: { ...costs, total },
      netProfit,
      marginPercent: percent(netProfit, netTotal),
    };
  };

  const bill = cancelled ? 0 : order.finalTotals.total;
  const kept = order.payment.paidAmount - order.payment.refundedAmount;
  // Money given back that no credit note called for: a gift to the
  // customer, VAT and all.
  const goodwill = paid ? Math.max(0, bill - kept) : 0;

  const ordered = figures(
    "ordered",
    order.totals.netTotal,
    deliveryNet,
    true,
    known,
    0,
  );
  const final = figures(
    "final",
    cancelled ? 0 : order.finalTotals.netTotal,
    cancelled || order.finalTotals.deliveryFee === 0 ? 0 : deliveryNet,
    // An order that was cancelled before it left was not packed or driven.
    !cancelled || dispatched,
    finalFee,
    goodwill,
  );

  const linesWithoutCost = lines.filter(
    (line) => line.unit.cost === null,
  ).length;
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    placedAt: order.placedAt,
    currency: "EUR",
    state: cancelled ? "cancelled" : paid ? "paid" : "not_paid",
    complete: linesWithoutCost === 0,
    linesWithoutCost,
    costs: snapshot,
    lines,
    ordered,
    final,
    summary: {
      productRevenue: ordered.revenue.products,
      buyingCosts: ordered.costs.buying,
      fulfilmentCosts: ordered.costs.fulfilment,
      extraCosts: ordered.costs.extra,
      deliveryRevenue: ordered.revenue.delivery,
      deliveryCost: ordered.costs.delivery,
      packagingCost: ordered.costs.packaging,
      paymentFee: ordered.costs.paymentFee,
      otherCosts: ordered.costs.other,
      profitAsOrdered: ordered.netProfit,
      refundAdjustment: fine(final.netProfit - ordered.netProfit),
      netProfit: final.netProfit,
      marginPercent: final.marginPercent,
    },
    refunds: {
      revenue: fine(final.revenue.total - ordered.revenue.total),
      costsRecovered: fine(
        ordered.costs.total - (final.costs.total - final.costs.goodwill),
      ),
      goodwill,
      profit: fine(final.netProfit - ordered.netProfit),
    },
    paymentFee: {
      amount: finalFee,
      source: actual !== null ? "actual" : finalFee > 0 ? "estimate" : "none",
      estimate,
      actual,
      percent: snapshot?.paymentFeePercent ?? null,
      fixed: snapshot?.paymentFeeFixed ?? null,
      reportedAt: actual !== null ? order.payment.paidAt : null,
    },
    customer: {
      agreed: order.totals.total,
      paid: order.payment.paidAmount,
      refunded: order.payment.refundedAmount,
      kept,
      bill,
      vat: cancelled ? 0 : order.finalTotals.vatTotal,
      pendingRefund: paid ? Math.max(0, kept - bill) : 0,
    },
  };
}

export function registerFinance(router: Router): void {
  const base = "/v1/admin/finance";

  router.get(`${base}/settings`, { permission: "finance.read" }, (ctx) =>
    json({ settings: ctx.db.orderCosts }),
  );
  // A change counts for orders placed from then on: the orders that exist
  // keep the costs they were placed with.
  router.put(
    `${base}/settings`,
    { permission: "finance.manage" },
    async (ctx) => {
      ctx.db.orderCosts = await ctx.body(orderCostsBody);
      return json({ settings: ctx.db.orderCosts });
    },
  );

  router.get(
    `${base}/orders/:id/profit`,
    { permission: "finance.read" },
    (ctx) => {
      const order = ctx.db.orders.find((entry) => entry.id === ctx.params.id);
      if (!order) {
        throw fail(404, "ORDER_NOT_FOUND", "The order was not found.");
      }
      return json(orderProfitOf(ctx.db, order));
    },
  );
}
