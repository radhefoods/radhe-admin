// The price rule (section 31, doc/SUPPLIER_IMPORT.md), as `cost-pricing.ts`
// of the API works it out: from a buying price to a selling price, value by
// value from the shop, the categories and the product.

import type {
  PriceCalculation,
  PriceProfit,
  PriceRule,
  PriceRuleField,
  PricingOverride,
  RuleSource,
} from "../src/lib/api/types/index.ts";
import type { Db, ProductRecord, VariantRecord } from "./db.ts";
import { vatOf } from "./domain.ts";

export const RULE_FIELDS: readonly PriceRuleField[] = [
  "fulfilmentPercent",
  "extraPercent",
  "extraAmount",
  "markupPercent",
];

/** Four decimals of a cent. */
export function fineCents(amount: number): number {
  const fine = Number(amount.toFixed(4));
  return fine === 0 ? 0 : fine;
}

/** To the nearest cent, halves up. */
export function roundCents(amount: number): number {
  return Math.round(Number(amount.toFixed(6)));
}

const isSet = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** The values of an override that are set, or `null` when none is. */
export function cleanOverride(
  input: PricingOverride | null | undefined,
): PricingOverride | null {
  const override: PricingOverride = {};
  for (const field of RULE_FIELDS) {
    const value = input?.[field];
    if (isSet(value)) override[field] = value;
  }
  return Object.keys(override).length > 0 ? override : null;
}

export function sameOverride(
  a: PricingOverride | null | undefined,
  b: PricingOverride | null | undefined,
): boolean {
  return RULE_FIELDS.every(
    (field) => (a?.[field] ?? null) === (b?.[field] ?? null),
  );
}

/**
 * The rule of a pack size: its own values, then those of its product, then
 * its categories (nearest first), then the shop. Without `variant` it is
 * the rule of the product.
 */
export function resolveRule(
  shop: PriceRule,
  /** Top first. */
  categories: (PricingOverride | null | undefined)[],
  product: PricingOverride | null | undefined,
  variant?: PricingOverride | null,
): { rule: PriceRule; sources: Record<PriceRuleField, RuleSource> } {
  const rule = { ...shop };
  const sources = Object.fromEntries(
    RULE_FIELDS.map((field) => [field, "shop"]),
  ) as Record<PriceRuleField, RuleSource>;
  const take = (
    override: PricingOverride | null | undefined,
    source: RuleSource,
  ) => {
    for (const field of RULE_FIELDS) {
      const value = override?.[field];
      if (isSet(value)) {
        rule[field] = value;
        sources[field] = source;
      }
    }
  };
  for (const category of categories) take(category, "category");
  take(product, "product");
  take(variant, "variant");
  return { rule, sources };
}

/**
 * The rule a pack size is priced by, as the shop, the categories, the
 * product and the pack size itself set it now. Without a pack size: the
 * rule of the product.
 */
export function ruleOf(
  db: Db,
  product: ProductRecord,
  variant?: Pick<VariantRecord, "priceRule">,
) {
  const chain: (PricingOverride | null)[] = [];
  let category = db.categories.find((entry) => entry.id === product.categoryId);
  for (let level = 0; category && level < 10; level += 1) {
    chain.unshift(category.pricing);
    const parentId: string | null = category.parentId;
    category = parentId
      ? db.categories.find((entry) => entry.id === parentId)
      : undefined;
  }
  return resolveRule(
    db.supplySettings.pricing,
    chain,
    product.pricing,
    variant?.priceRule,
  );
}

/** With 10 % fulfilment and 35 % markup at 7 % VAT, 138 gives 219. */
export function priceFromCost(
  cost: number,
  rule: PriceRule,
  vatRate: number,
): PriceCalculation {
  const fulfilment = (cost * rule.fulfilmentPercent) / 100;
  const extra = (cost * rule.extraPercent) / 100 + rule.extraAmount;
  const markup = ((cost + fulfilment + extra) * rule.markupPercent) / 100;
  const net = cost + fulfilment + extra + markup;
  const vat = (net * vatRate) / 10_000;
  return {
    cost: fineCents(cost),
    fulfilment: fineCents(fulfilment),
    extra: fineCents(extra),
    markup: fineCents(markup),
    net: fineCents(net),
    vat: fineCents(vat),
    price: roundCents(net + vat),
  };
}

/** What a selling price earns, whoever set it. */
export function profitOf(
  price: number,
  vatRate: number,
  cost: number,
  rule: PriceRule,
): PriceProfit {
  const net = price - vatOf(price, vatRate);
  const costs =
    cost +
    (cost * rule.fulfilmentPercent) / 100 +
    (cost * rule.extraPercent) / 100 +
    rule.extraAmount;
  const profit = net - costs;
  const percent = (part: number, whole: number) =>
    whole > 0 ? Number(((part * 100) / whole).toFixed(2)) : null;
  return {
    net,
    costs: fineCents(costs),
    profit: fineCents(profit),
    markupPercent: percent(profit, costs),
    marginPercent: percent(profit, net),
  };
}
