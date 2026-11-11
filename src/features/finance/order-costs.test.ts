import { describe, expect, it } from "vitest";
import type { OrderCostSettings } from "@/lib/api/types";
import {
  feeExample,
  feeExampleText,
  orderCostsDefaults,
  orderCostsSchema,
} from "./order-costs";

const SAVED: OrderCostSettings = {
  deliveryCost: 450,
  packagingCost: 80,
  otherCost: 20,
  paymentFee: { percent: 1.5, fixed: 25 },
};

describe("the form of the order costs", () => {
  it("shows the settings in euros and percent", () => {
    expect(orderCostsDefaults(SAVED)).toEqual({
      deliveryCost: "4.50",
      packagingCost: "0.80",
      otherCost: "0.20",
      paymentFee: { percent: "1.5", fixed: "0.25" },
    });
    expect(
      orderCostsDefaults({ ...SAVED, paymentFee: { percent: 2.85, fixed: 0 } })
        .paymentFee,
    ).toEqual({ percent: "2.85", fixed: "0.00" });
  });

  it("makes the whole document of it: whole cents and a percentage", () => {
    expect(orderCostsSchema.parse(orderCostsDefaults(SAVED))).toEqual(SAVED);
    expect(
      orderCostsSchema.parse({
        deliveryCost: "4,5",
        packagingCost: "0",
        otherCost: "1.234,56",
        paymentFee: { percent: "2,8", fixed: "0.3" },
      }),
    ).toEqual({
      deliveryCost: 450,
      packagingCost: 0,
      otherCost: 123456,
      paymentFee: { percent: 2.8, fixed: 30 },
    });
  });

  it("keeps to the limits of the API", () => {
    const values = orderCostsDefaults(SAVED);
    const problems = (changed: Record<string, unknown>) => {
      const result = orderCostsSchema.safeParse({ ...values, ...changed });
      return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
    };
    // A cost: 0 to 10,000.00 euros.
    expect(problems({ deliveryCost: "10000.00" })).toEqual([]);
    expect(problems({ deliveryCost: "10000.01" })).toEqual(["deliveryCost"]);
    expect(problems({ packagingCost: "" })).toEqual(["packagingCost"]);
    expect(problems({ otherCost: "-1" })).toEqual(["otherCost"]);
    // The percentage: 0 to 100 with at most two decimals.
    expect(problems({ paymentFee: { percent: "100", fixed: "0.25" } })).toEqual(
      [],
    );
    expect(
      problems({ paymentFee: { percent: "100.01", fixed: "0.25" } }),
    ).toEqual(["paymentFee.percent"]);
    expect(
      problems({ paymentFee: { percent: "1.555", fixed: "0.25" } }),
    ).toEqual(["paymentFee.percent"]);
    expect(problems({ paymentFee: { percent: "", fixed: "0.25" } })).toEqual([
      "paymentFee.percent",
    ]);
    // The amount per payment: up to 100.00 euros.
    expect(problems({ paymentFee: { percent: "1.5", fixed: "100" } })).toEqual(
      [],
    );
    expect(
      problems({ paymentFee: { percent: "1.5", fixed: "100.01" } }),
    ).toEqual(["paymentFee.fixed"]);
  });
});

describe("the example of the payment fee", () => {
  it("follows what is typed, for an order of 50 euros", () => {
    const example = feeExample({ percent: "1.5", fixed: "0.25" });
    expect(example).toEqual({ order: 5000, share: 75, fixed: 25, total: 100 });
    expect(feeExampleText(example!)).toBe(
      "An order of €50.00 would cost €0.75 + €0.25 = €1.00 in payment fees.",
    );
    expect(feeExample({ percent: "2,8", fixed: "0,25" })?.total).toBe(165);
    expect(feeExample({ percent: "0", fixed: "0" })?.total).toBe(0);
  });

  it("waits while a field is not a value the API takes", () => {
    expect(feeExample({ percent: "", fixed: "0.25" })).toBeNull();
    expect(feeExample({ percent: "1.5", fixed: "abc" })).toBeNull();
    expect(feeExample({ percent: "101", fixed: "0.25" })).toBeNull();
    expect(feeExample({ percent: "1.5", fixed: "100.01" })).toBeNull();
    expect(feeExample({})).toBeNull();
  });
});
