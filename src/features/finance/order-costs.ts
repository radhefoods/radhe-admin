import { z } from "zod";
import {
  ORDER_COST_LIMITS,
  type Cents,
  type OrderCostSettings,
} from "@/lib/api/types";
import {
  centsToInput,
  formatMoney,
  parseEuros,
  parseVatRate,
  rateToInput,
} from "@/lib/format/money";
import { zEuros } from "@/lib/validation";

// What one order costs the shop besides its goods (documentation, 32:
// `PUT /finance/settings`). Typed in euros and percent, sent as whole cents
// and a percentage with at most two decimals. The limits are the API's.

const cost = zEuros({ min: 0, max: ORDER_COST_LIMITS.cost });

/**
 * A percentage typed by a person, as hundredths of a percent, or `null`
 * when it is not one: 0 to 100 with at most two decimals. `1,5` is 150.
 */
export function parseFeePercent(input: string): number | null {
  return parseVatRate(input);
}

const percent = z.string().transform((value, context) => {
  const hundredths = parseFeePercent(value);
  if (hundredths === null) {
    context.addIssue({
      code: "custom",
      message:
        value.trim() === ""
          ? "Enter a percentage."
          : "A percentage from 0 to 100 with at most two decimals. Example: 1.5",
    });
    return z.NEVER;
  }
  return hundredths / 100;
});

export const orderCostsSchema = z.object({
  deliveryCost: cost,
  packagingCost: cost,
  otherCost: cost,
  paymentFee: z.object({
    percent,
    fixed: zEuros({ min: 0, max: ORDER_COST_LIMITS.feeFixed }),
  }),
});

export type OrderCostsFormValues = z.input<typeof orderCostsSchema>;

/** The form for the settings as the API has them. */
export function orderCostsDefaults(
  settings: OrderCostSettings,
): OrderCostsFormValues {
  return {
    deliveryCost: centsToInput(settings.deliveryCost),
    packagingCost: centsToInput(settings.packagingCost),
    otherCost: centsToInput(settings.otherCost),
    paymentFee: {
      percent: rateToInput(Math.round(settings.paymentFee.percent * 100)),
      fixed: centsToInput(settings.paymentFee.fixed),
    },
  };
}

/** The value of the order the example of the page is about: €50.00. */
export const FEE_EXAMPLE_ORDER: Cents = 5000;

export interface FeeExample {
  order: Cents;
  /** The percentage of the order. */
  share: Cents;
  fixed: Cents;
  total: Cents;
}

/**
 * What the estimate comes to for an order of €50.00, as it is typed right
 * now; `null` while one of the two fields is not a value the API takes. An
 * illustration of the two inputs, not a figure of an order: those come from
 * the API.
 */
export function feeExample(typed: {
  percent?: string;
  fixed?: string;
}): FeeExample | null {
  const hundredths = parseFeePercent(typed.percent ?? "");
  const fixed = parseEuros(typed.fixed ?? "");
  if (hundredths === null || fixed === null) return null;
  if (fixed > ORDER_COST_LIMITS.feeFixed) return null;
  const share = Math.round((FEE_EXAMPLE_ORDER * hundredths) / 10_000);
  return { order: FEE_EXAMPLE_ORDER, share, fixed, total: share + fixed };
}

/** "An order of €50.00 would cost €0.75 + €0.25 = €1.00 in payment fees." */
export function feeExampleText(example: FeeExample): string {
  return `An order of ${formatMoney(example.order)} would cost ${formatMoney(example.share)} + ${formatMoney(example.fixed)} = ${formatMoney(example.total)} in payment fees.`;
}
