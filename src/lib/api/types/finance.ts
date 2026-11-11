// Section 32: costs and profit of an order (doc/ORDER_PROFIT.md).
//
// Amounts are cents. Everything is without VAT unless a field says
// otherwise. Buying prices and what follows from them have up to four
// decimals of a cent; what the customer pays is whole cents. Nothing is
// added up in the panel: every total comes from the API.

import type { Cents, Id, IsoDateTime, Translated, VatRate } from "./common";
import type { PackUnit } from "./catalog";
import type { OrderStatus } from "./orders";
import type { PaymentStatus } from "./payments";

/** An amount of cents that may have up to four decimals. */
export type FineCents = number;

// --- Settings: what one order costs --------------------------------------------

/** The estimate of the payment fee, used until Stripe reports the real one. */
export interface PaymentFeeEstimate {
  /** Percent of what the customer pays: 0 to 100, two decimals. */
  percent: number;
  /** Whole cents per payment: 0 to 10,000. */
  fixed: Cents;
}

/**
 * What one order costs the shop besides its goods (`GET` / `PUT
 * /finance/settings`): whole cents without VAT, 0 to 1,000,000 each. A
 * change counts for orders placed from then on; every order keeps the
 * costs that were valid when it was placed. The `PUT` takes the whole
 * document.
 */
export interface OrderCostSettings {
  deliveryCost: Cents;
  packagingCost: Cents;
  otherCost: Cents;
  paymentFee: PaymentFeeEstimate;
}

export const ORDER_COST_LIMITS = {
  cost: 1_000_000,
  feePercent: 100,
  feeFixed: 10_000,
} as const;

// --- The breakdown of an order --------------------------------------------------

/** The price rule of a product (31), as it was when the order was placed. */
export interface PriceRule {
  fulfilmentPercent: number;
  extraPercent: number;
  /** Cents per pack. */
  extraAmount: number;
  markupPercent: number;
}

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

/** A line, once as ordered and once as it ended. */
export interface ProfitLineFigures {
  /** Units the figures are about: ordered, or kept in the end. */
  units: number;
  /** What the customer pays for them, VAT included, after discounts. */
  gross: Cents;
  /** What the discount code and the coins took off them. */
  discount: Cents;
  vat: Cents;
  /** The revenue: `gross` without its VAT. */
  netRevenue: Cents;
  /** Units whose buying price is spent: not back on the shelf. */
  costUnits: number;
  /** Units that were picked and packed. */
  handledUnits: number;
  /** `null` (as the four below): the buying price was not known. */
  buyingCost: FineCents | null;
  fulfilmentCost: FineCents | null;
  extraCost: FineCents | null;
  profit: FineCents | null;
  /** The profit in percent of the revenue. */
  marginPercent: number | null;
  /** The profit in percent of the costs. */
  markupPercent: number | null;
}

export interface ProfitLine {
  productId: Id;
  variantId: Id;
  sku: string;
  name: Translated;
  /** Without a label. */
  packSize: { value: number; unit: PackUnit };
  vatRate: VatRate;
  vatPercent: number;
  /** One pack: what it cost, how its price came about, what was charged. */
  unit: {
    /** The buying price when the order was placed. `null`: not known. */
    cost: FineCents | null;
    rule: PriceRule | null;
    /** `auto`: the price followed the rule. `manual`: the admin set it. */
    priceMode: PriceMode | null;
    /** `null` without a buying price. */
    calculation: PriceCalculation | null;
    /** What the customer was charged for one pack, VAT included. */
    price: Cents;
    /** The crossed-out price, when the pack was reduced. */
    regularPrice: Cents | null;
  };
  quantity: {
    ordered: number;
    /** After corrections. */
    delivered: number;
    returned: number;
    /** Of the returned units, those put back on the shelf. */
    restocked: number;
    kept: number;
  };
  /** The line as the customer ordered it. */
  ordered: ProfitLineFigures;
  /** The line as it ended after corrections, returns and a cancellation. */
  final: ProfitLineFigures;
}

/** An order as a whole, once as agreed and once as it ended. */
export interface OrderFigures {
  revenue: {
    products: Cents;
    delivery: Cents;
    /** The cent or two between VAT rounded per rate and per line. */
    vatRounding: Cents;
    total: Cents;
  };
  costs: {
    buying: FineCents;
    fulfilment: FineCents;
    extra: FineCents;
    delivery: Cents;
    packaging: Cents;
    paymentFee: FineCents;
    other: Cents;
    /** Money given back beyond the bill. Only in `final`. */
    goodwill: Cents;
    total: FineCents;
  };
  netProfit: FineCents;
  /** `null` without revenue. */
  marginPercent: number | null;
}

/** The rows of the summary table. `profitAsOrdered + refundAdjustment = netProfit`. */
export interface ProfitSummary {
  productRevenue: Cents;
  buyingCosts: FineCents;
  fulfilmentCosts: FineCents;
  extraCosts: FineCents;
  deliveryRevenue: Cents;
  deliveryCost: Cents;
  packagingCost: Cents;
  paymentFee: FineCents;
  otherCosts: Cents;
  profitAsOrdered: FineCents;
  /** What corrections, returns, a cancellation and goodwill changed. */
  refundAdjustment: FineCents;
  netProfit: FineCents;
  marginPercent: number | null;
}

export type PaymentFeeSource = "actual" | "estimate" | "none";
export type ProfitState = "paid" | "not_paid" | "cancelled";

/** `GET /finance/orders/{id}/profit`: what an order cost and what it earned. */
export interface OrderProfit {
  orderId: Id;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  placedAt: IsoDateTime;
  currency: "EUR";
  /** `not_paid`: the figures are what is expected. */
  state: ProfitState;
  /** `false`: a line has no buying price, and the profit shown is too high. */
  complete: boolean;
  linesWithoutCost: number;
  /** The costs of an order as they were when it was placed; `null` on orders from before they were kept. */
  costs: {
    delivery: Cents;
    packaging: Cents;
    other: Cents;
    paymentFeePercent: number;
    paymentFeeFixed: Cents;
  } | null;
  lines: ProfitLine[];
  ordered: OrderFigures;
  final: OrderFigures;
  summary: ProfitSummary;
  /** How the refunds changed the result: `profit` is the sum of the others. */
  refunds: {
    /** Revenue that went back to the customer: 0 or negative. */
    revenue: FineCents;
    /** Costs that were not spent after all: 0 or positive. */
    costsRecovered: FineCents;
    goodwill: FineCents;
    profit: FineCents;
  };
  paymentFee: {
    /** The fee the figures use. */
    amount: FineCents;
    /** `actual` once Stripe reported it, `estimate` until then, `none` without a payment. */
    source: PaymentFeeSource;
    estimate: FineCents;
    actual: Cents | null;
    percent: number | null;
    fixed: Cents | null;
    reportedAt: IsoDateTime | null;
  };
  /** What the customer agreed to, paid and got back, VAT included. */
  customer: {
    agreed: Cents;
    paid: Cents;
    refunded: Cents;
    /** Paid and not refunded. */
    kept: Cents;
    /** What the final bill comes to. */
    bill: Cents;
    /** The VAT in the final bill. */
    vat: Cents;
    /** Credited or cancelled, and not paid back yet. */
    pendingRefund: Cents;
  };
}
