// Section 32: costs and profit of an order (doc/ORDER_PROFIT.md).

import { z } from "zod";
import { json } from "../http.ts";
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
}
