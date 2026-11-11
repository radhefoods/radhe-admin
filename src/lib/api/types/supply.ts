// Section 31: the supplier's file, stock and calculated prices
// (doc/SUPPLIER_IMPORT.md). Admin only: no customer endpoint answers a
// buying price, a markup or a supplier's line.
//
// Money is cents; buying prices and the steps of a calculation may have up
// to four decimals. Percentages of the price rule are plain numbers with up
// to two decimals (35 is 35 %); VAT is hundredths of a percent (700 is 7 %).

import type { Cents, Id, IsoDateTime, VatRate } from "./common";
import type { PackUnit } from "./catalog";

/** An amount of cents that may have up to four decimals. */
export type FineCents = number;

// --- The price rule ----------------------------------------------------------------

/**
 * How a selling price comes from a buying price: the buying price, plus
 * `fulfilmentPercent` of it, plus `extraPercent` of it and `extraAmount`,
 * then `markupPercent` of all that, then the VAT of the product. Rounded to
 * the cent at the end only.
 */
export interface PriceRule {
  /** What handling an order costs, in percent of the buying price. */
  fulfilmentPercent: number;
  /** Further costs in percent of the buying price. */
  extraPercent: number;
  /** A fixed amount per pack, whole cents. */
  extraAmount: Cents;
  /** The profit added on the buying price and all charges. A markup, not a margin. */
  markupPercent: number;
}

export const PRICE_RULE_FIELDS = [
  "fulfilmentPercent",
  "extraPercent",
  "extraAmount",
  "markupPercent",
] as const;
export type PriceRuleField = (typeof PRICE_RULE_FIELDS)[number];

/** The limits of the API: percentages 0 to 1000 with two decimals, the amount 0 to 100,000 cents. */
export const PRICE_RULE_LIMITS = {
  percent: 1000,
  extraAmount: 100_000,
  safetyUnits: 1000,
  brands: 2000,
  brandPrefix: 60,
  brandName: 80,
  /** A buying price: 0 to 10,000,000 cents, four decimals. */
  cost: 10_000_000,
} as const;

/**
 * The values of the rule a category or a product sets differently. As the
 * API answers it, only the values that are set are there; `null` in a
 * request removes one. The whole object is replaced on every write, and
 * `null` (or nothing set) removes the override.
 */
export type PricingOverride = Partial<Record<PriceRuleField, number | null>>;

/** Where a value of the rule of a product is set. */
export type RuleSource = "shop" | "category" | "product";

/** `auto`: the regular price follows the calculation. `manual`: only the admin changes it. */
export type PriceMode = "auto" | "manual";

/** From the buying price to the price the rule gives, step by step. */
export interface PriceCalculation {
  cost: FineCents;
  fulfilment: FineCents;
  extra: FineCents;
  markup: FineCents;
  /** The price before VAT. */
  net: FineCents;
  vat: FineCents;
  /** What the rule gives: whole cents, VAT included. */
  price: Cents;
}

// --- Settings ------------------------------------------------------------------------

/** A prefix of the supplier's names and the brand it stands for; an empty name says "not a brand". */
export interface SupplierBrand {
  /** The text before the colon in the supplier's names: 1 to 60 characters. */
  prefix: string;
  /** At most 80 characters; empty: the prefix is not a brand. */
  name: string;
}

/**
 * `GET` / `PUT /supply/settings`. The `PUT` needs `safetyUnits` and
 * `pricing`; `brands` and `publishCheck` left out stay as they are. Every
 * calculated price is calculated again at once.
 */
export interface SupplySettings {
  /** Units of the supplier's stock that are never offered: 0 to 1000. Applies from the next upload. */
  safetyUnits: number;
  pricing: PriceRule;
  /** Up to 2000 rows. */
  brands: SupplierBrand[];
  /** Whether a product must be complete before it can be activated. */
  publishCheck: boolean;
}

export interface SupplySettingsInput {
  safetyUnits: number;
  pricing: PriceRule;
  brands?: SupplierBrand[];
  publishCheck?: boolean;
}

export interface SupplySettingsResult {
  settings: SupplySettings;
  /** How many calculated prices changed. */
  repriced: number;
}

// --- The pricing of a product ------------------------------------------------------------

/** What a selling price earns, whoever set it. */
export interface PriceProfit {
  /** The selling price without its VAT. */
  net: Cents;
  /** Buying price plus the fulfilment charge and the further expenses. */
  costs: FineCents;
  /** What is left of the net price after the costs. Negative for a loss. */
  profit: FineCents;
  /** The profit in percent of the costs. */
  markupPercent: number | null;
  /** The profit in percent of the net price. */
  marginPercent: number | null;
}

/** The line of the supplier's file a pack size follows. */
export interface PricingSupplierLine {
  itemId: Id;
  /** The supplier's name of the line: "AB: 100g Black Pepper Powder". */
  name: string;
  quantity: number;
  cost: FineCents | null;
  vatRate: VatRate | null;
  hints: string[];
  lastSeenAt: IsoDateTime;
  /** Set while the line is not in the supplier's file any more. */
  missingSince: IsoDateTime | null;
}

export interface VariantPricing {
  variantId: Id;
  sku: string;
  /** Without a label. */
  packSize: { value: number; unit: PackUnit };
  priceMode: PriceMode;
  /** `null`: no buying price. */
  cost: FineCents | null;
  /** What the rule gives, whatever the price mode; `null` without a buying price. */
  calculated: PriceCalculation | null;
  regularPrice: Cents;
  salePrice: Cents | null;
  /** What customers pay now. */
  price: Cents;
  /** What `price` earns; `null` without a buying price. */
  profit: PriceProfit | null;
  stock: number;
  supplier: PricingSupplierLine | null;
}

/** `GET /supply/products/{id}/pricing`: how the price of each pack size comes about. */
export interface ProductPricing {
  productId: Id;
  vatRate: VatRate;
  vatPercent: number;
  /** The rule of the product, every value resolved. */
  rule: PriceRule;
  /** Where each value of `rule` is set. */
  sources: Record<PriceRuleField, RuleSource>;
  /** The values the product itself sets; `null` when it sets none. */
  override: PricingOverride | null;
  variants: VariantPricing[];
}
