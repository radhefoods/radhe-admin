import { z } from "zod";
import {
  PRICE_RULE_FIELDS,
  PRICE_RULE_LIMITS,
  type Category,
  type Cents,
  type FineCents,
  type Id,
  type PriceCalculation,
  type PriceRule,
  type PriceRuleField,
  type PricingOverride,
  type RuleSource,
  type VatRate,
} from "@/lib/api/types";
import { centsToInput, parseEuros } from "@/lib/format/money";

// The price rule (documentation, 31; doc/SUPPLIER_IMPORT.md): how a selling
// price comes from a buying price, who sets each value of the rule, and
// how its values are typed. The API calculates every price that counts;
// what is calculated here is shown before a save ("about €2.19") and sent
// as the price of a new pack size, which the API then calculates over.

// --- The calculation -----------------------------------------------------------

/** Four decimals of a cent: enough for every step to add up on a screen. */
export function fineCents(amount: number): FineCents {
  const fine = Number(amount.toFixed(4));
  return fine === 0 ? 0 : fine;
}

/** To the nearest cent, halves up, free of the noise of binary fractions. */
function roundCents(amount: number): Cents {
  return Math.round(Number(amount.toFixed(6)));
}

/**
 * The selling price of a buying price: the buying price, plus the
 * fulfilment charge on it, plus the other expenses, plus the markup on all
 * of that, plus the VAT of the product. Rounded to the cent at the end only.
 * With 10 % fulfilment and 35 % markup at 7 % VAT, 138 gives 219.
 */
export function priceFromCost(
  cost: FineCents,
  rule: PriceRule,
  vatRate: VatRate,
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

// --- Who sets a value ------------------------------------------------------------

export interface ResolvedRule {
  rule: PriceRule;
  sources: Record<PriceRuleField, RuleSource>;
}

const isSet = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The rule of a pack size: its own values first, then those of its
 * product, then those of the category (the nearest one that says
 * anything), then those of the shop. Value by value, so a pack size can
 * set its markup and still follow the shop's fulfilment charge. Without
 * `variant` it is the rule of the product: what its pack sizes follow
 * where they set nothing themselves.
 * @param categories the overrides of the categories of the product, top first
 */
export function resolveRule(
  shop: PriceRule,
  categories: readonly (PricingOverride | null | undefined)[],
  product?: PricingOverride | null,
  variant?: PricingOverride | null,
): ResolvedRule {
  const rule = { ...shop };
  const sources = Object.fromEntries(
    PRICE_RULE_FIELDS.map((field) => [field, "shop"]),
  ) as Record<PriceRuleField, RuleSource>;
  const take = (
    override: PricingOverride | null | undefined,
    source: RuleSource,
  ) => {
    for (const field of PRICE_RULE_FIELDS) {
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
 * The overrides of a category and of the categories above it, top first:
 * what `resolveRule` takes. Empty for a category that is not in the list.
 */
export function categoryOverrides(
  categories: readonly Pick<Category, "id" | "parentId" | "pricing">[],
  categoryId: Id | null | undefined,
): (PricingOverride | null)[] {
  const byId = new Map(categories.map((entry) => [entry.id, entry]));
  const chain: (PricingOverride | null)[] = [];
  let current = categoryId ? byId.get(categoryId) : undefined;
  // A tree has three levels; the guard keeps a broken list from looping.
  for (let level = 0; current && level < 10; level += 1) {
    chain.unshift(current.pricing);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

// --- Typing the values -------------------------------------------------------------

/**
 * A percentage of the rule as typed, or `null` when it is not one: 0 to
 * 1000 with at most two decimals. `35`, `12,5`, `7.25 %`.
 */
export function parseRulePercent(input: string): number | null {
  const text = input.replace(/[\s%]/g, "").replace(",", ".");
  const match = /^(\d{1,4})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const hundredths = Number(`${match[1]}${(match[2] ?? "").padEnd(2, "0")}`);
  return hundredths <= PRICE_RULE_LIMITS.percent * 100
    ? hundredths / 100
    : null;
}

/** The value of a percent field: `35` becomes `35`, `12.5` becomes `12.5`. */
export function percentToInput(value: number | null | undefined): string {
  if (!isSet(value)) return "";
  return value.toFixed(2).replace(/\.?0+$/, "");
}

/**
 * A buying price as typed in euros, as cents with up to four decimals, or
 * `null` when it is not one. The supplier's price is an average such as
 * 0.662258 euros: up to six decimals of a euro are taken as they are.
 */
export function parseCost(input: string): FineCents | null {
  const text = input.replace(/[\s€]/g, "").replace(",", ".");
  const match = /^(\d{1,6})(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) return null;
  // Millionths of a euro, as an integer: nothing goes through a float.
  const millionths = Number(`${match[1]}${(match[2] ?? "").padEnd(6, "0")}`);
  const cents = millionths / 10_000;
  return cents <= PRICE_RULE_LIMITS.cost ? cents : null;
}

/** The value of a buying-price field: `138` becomes `1.38`, `66.2258` becomes `0.662258`. */
export function costToInput(cents: FineCents | null | undefined): string {
  if (!isSet(cents) || cents < 0) return "";
  const millionths = Math.round(cents * 10_000);
  const digits = millionths.toString().padStart(7, "0");
  const fraction = digits.slice(-6).replace(/0{1,4}$/, "");
  return `${digits.slice(0, -6)}.${fraction}`;
}

const percentField = (label: string) =>
  z.string().superRefine((value, context) => {
    if (parseRulePercent(value) === null) {
      context.addIssue({
        code: "custom",
        message:
          value.trim() === ""
            ? `Enter the ${label}.`
            : "A percentage from 0 to 1000 with at most two decimals. Example: 35",
      });
    }
  });

const amountField = z.string().superRefine((value, context) => {
  const cents = parseEuros(value);
  if (cents === null) {
    context.addIssue({
      code: "custom",
      message:
        value.trim() === ""
          ? "Enter an amount; 0 for none."
          : "This is not an amount. Example: 0.10",
    });
  } else if (cents > PRICE_RULE_LIMITS.extraAmount) {
    context.addIssue({ code: "custom", message: "At most €1,000.00." });
  }
});

/** The four values of the rule of the shop: every one is required. */
export const priceRuleFields = {
  fulfilmentPercent: percentField("fulfilment cost"),
  extraPercent: percentField("percentage; 0 for none"),
  extraAmount: amountField,
  markupPercent: percentField("markup"),
};

export type PriceRuleValues = Record<PriceRuleField, string>;

export function priceRuleDefaults(rule: PriceRule): PriceRuleValues {
  return {
    fulfilmentPercent: percentToInput(rule.fulfilmentPercent),
    extraPercent: percentToInput(rule.extraPercent),
    extraAmount: centsToInput(rule.extraAmount),
    markupPercent: percentToInput(rule.markupPercent),
  };
}

/** The rule as typed, or `null` while a field is not a value the API takes. */
export function typedRule(values: Partial<PriceRuleValues>): PriceRule | null {
  const fulfilmentPercent = parseRulePercent(values.fulfilmentPercent ?? "");
  const extraPercent = parseRulePercent(values.extraPercent ?? "");
  const markupPercent = parseRulePercent(values.markupPercent ?? "");
  const extraAmount = parseEuros(values.extraAmount ?? "");
  if (
    fulfilmentPercent === null ||
    extraPercent === null ||
    markupPercent === null ||
    extraAmount === null ||
    extraAmount > PRICE_RULE_LIMITS.extraAmount
  ) {
    return null;
  }
  return { fulfilmentPercent, extraPercent, extraAmount, markupPercent };
}

/** Whether two rules say the same. */
export function sameRule(a: PriceRule, b: PriceRule): boolean {
  return PRICE_RULE_FIELDS.every((field) => a[field] === b[field]);
}

// --- An override: the values a category, a product or a pack size sets itself ------

const optionalPercent = z.string().superRefine((value, context) => {
  if (value.trim() !== "" && parseRulePercent(value) === null) {
    context.addIssue({
      code: "custom",
      message:
        "A percentage from 0 to 1000 with at most two decimals, or empty. Example: 35",
    });
  }
});

const optionalAmount = z.string().superRefine((value, context) => {
  if (value.trim() === "") return;
  const cents = parseEuros(value);
  if (cents === null) {
    context.addIssue({
      code: "custom",
      message: "This is not an amount. Example: 0.10",
    });
  } else if (cents > PRICE_RULE_LIMITS.extraAmount) {
    context.addIssue({ code: "custom", message: "At most €1,000.00." });
  }
});

/** The four values of an override: each may be left empty. */
export const overrideFields = z.object({
  fulfilmentPercent: optionalPercent,
  extraPercent: optionalPercent,
  extraAmount: optionalAmount,
  markupPercent: optionalPercent,
});

export function overrideDefaults(
  override: PricingOverride | null | undefined,
): PriceRuleValues {
  return {
    fulfilmentPercent: percentToInput(override?.fulfilmentPercent),
    extraPercent: percentToInput(override?.extraPercent),
    extraAmount: isSet(override?.extraAmount)
      ? centsToInput(override.extraAmount)
      : "",
    markupPercent: percentToInput(override?.markupPercent),
  };
}

/**
 * What the API gets for an override as typed: the values that are set, or
 * `null` when none is, which removes the override. The API replaces the
 * whole object on every write.
 */
export function toOverride(values: PriceRuleValues): PricingOverride | null {
  const override: PricingOverride = {};
  for (const field of PRICE_RULE_FIELDS) {
    const text = values[field].trim();
    if (text === "") continue;
    const value =
      field === "extraAmount" ? parseEuros(text) : parseRulePercent(text);
    if (value !== null) override[field] = value;
  }
  return Object.keys(override).length > 0 ? override : null;
}

/** Whether two overrides set the same values. */
export function sameOverride(
  a: PricingOverride | null | undefined,
  b: PricingOverride | null | undefined,
): boolean {
  return PRICE_RULE_FIELDS.every(
    (field) => (a?.[field] ?? null) === (b?.[field] ?? null),
  );
}

// --- Words ------------------------------------------------------------------------

export const RULE_FIELD_LABEL: Record<PriceRuleField, string> = {
  fulfilmentPercent: "Fulfilment cost",
  extraPercent: "Other expenses",
  extraAmount: "Other expenses per pack",
  markupPercent: "Markup",
};

export const RULE_SOURCE_LABEL: Record<RuleSource, string> = {
  shop: "the shop",
  category: "the category",
  product: "this product",
  variant: "this pack size",
};

/** A value of the rule in words: "35 %", "€0.10". */
export function ruleValueText(field: PriceRuleField, value: number): string {
  return field === "extraAmount"
    ? `€${centsToInput(value)}`
    : `${percentToInput(value)} %`;
}
