// Section 31: the price rule of the shop and the pricing of a product
// (doc/SUPPLIER_IMPORT.md). The upload of the supplier's file and the
// review list are not part of the mock yet.

import { z } from "zod";
import type {
  ProductPricing,
  VariantPricing,
} from "../../src/lib/api/types/index.ts";
import type { Db, ProductRecord } from "../db.ts";
import { sortedVariants } from "../domain.ts";
import { fail, json } from "../http.ts";
import { priceFromCost, profitOf, ruleOf } from "../pricing.ts";
import type { Router } from "../router.ts";
import { repriceProducts } from "./catalog.ts";

const twoDecimals = (value: number) =>
  Math.abs(value * 100 - Math.round(value * 100)) < 1e-9;
const percent = z.number().min(0).max(1000).refine(twoDecimals, {
  message: "must have at most 2 decimal places",
});

/** `safetyUnits` and `pricing` every time; `brands` and `publishCheck` left out stay as they are. */
const settingsBody = z.strictObject({
  safetyUnits: z.number().int().min(0).max(1000),
  pricing: z.strictObject({
    fulfilmentPercent: percent,
    extraPercent: percent,
    extraAmount: z.number().int().min(0).max(100_000),
    markupPercent: percent,
  }),
  brands: z
    .array(
      z.strictObject({
        prefix: z.string().trim().min(1).max(60),
        // An empty name says "not a brand". The mock drops empty strings
        // from every body (0.2), so a name that is not there is that.
        name: z.string().trim().max(80).default(""),
      }),
    )
    .max(2000)
    .optional(),
  publishCheck: z.boolean().optional(),
});

/** A prefix as the import compares it: case and punctuation do not matter. */
const prefixKey = (prefix: string) =>
  prefix
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** How the price of each pack size of a product comes about. */
export function pricingOf(db: Db, product: ProductRecord): ProductPricing {
  const { rule, sources } = ruleOf(db, product);
  const variants: VariantPricing[] = sortedVariants(product).map((variant) => {
    const cost = variant.cost && variant.cost > 0 ? variant.cost : null;
    const price = variant.salePrice ?? variant.regularPrice;
    return {
      variantId: variant.id,
      sku: variant.sku,
      packSize: {
        value: variant.packSize.value,
        unit: variant.packSize.unit,
      },
      priceMode: variant.priceMode,
      cost,
      // What the rule gives, whatever the price mode.
      calculated:
        cost === null ? null : priceFromCost(cost, rule, product.vatRate),
      regularPrice: variant.regularPrice,
      salePrice: variant.salePrice,
      price,
      profit:
        cost === null ? null : profitOf(price, product.vatRate, cost, rule),
      stock: variant.stock.quantity,
      // The mock has no supplier's file yet: no pack size follows a line.
      supplier: null,
    };
  });
  return {
    productId: product.id,
    vatRate: product.vatRate,
    vatPercent: product.vatRate / 100,
    rule,
    sources,
    override: product.pricing,
    variants,
  };
}

export function registerSupply(router: Router): void {
  const base = "/v1/admin/supply";

  router.get(`${base}/settings`, { permission: "catalog.read" }, (ctx) =>
    json({ settings: ctx.db.supplySettings }),
  );

  router.put(
    `${base}/settings`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(settingsBody);
      const current = ctx.db.supplySettings;
      // Two rows for one prefix are one row: the last one wins.
      const brands = input.brands
        ? [
            ...new Map(
              input.brands.map((row) => [prefixKey(row.prefix), row]),
            ).values(),
          ]
        : current.brands;
      ctx.db.supplySettings = {
        safetyUnits: input.safetyUnits,
        pricing: input.pricing,
        brands,
        publishCheck: input.publishCheck ?? current.publishCheck,
      };
      // Every calculated price is calculated again at once.
      const repriced = repriceProducts(
        ctx.db,
        ctx.db.products,
        ctx.admin.id,
        ctx.now,
      );
      return json({ settings: ctx.db.supplySettings, repriced });
    },
  );

  router.get(
    `${base}/products/:id/pricing`,
    { permission: "catalog.read" },
    (ctx) => {
      const product = ctx.db.products.find(
        (entry) => entry.id === ctx.params.id,
      );
      if (!product) {
        throw fail(404, "PRODUCT_NOT_FOUND", "The product was not found.");
      }
      return json(pricingOf(ctx.db, product));
    },
  );
}
