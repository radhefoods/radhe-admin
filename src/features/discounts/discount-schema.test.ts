import { describe, expect, it } from "vitest";
import type { DiscountCode } from "@/lib/api/types";
import {
  discountDefaults,
  discountSchema,
  toDiscountInput,
  toDiscountPatch,
  type DiscountFormValues,
} from "./discount-schema";
import { inUse, periodText, usesText, valueText } from "./rules";

const values = (
  over: Partial<DiscountFormValues> = {},
): DiscountFormValues => ({
  code: "DIWALI10",
  generate: false,
  note: "",
  type: "percent",
  value: "10",
  appliesToSaleItems: true,
  minOrderValue: "",
  startsAt: "",
  expiresAt: "",
  maxUses: "",
  oncePerCustomer: false,
  isActive: true,
  ...over,
});

const issues = (over: Partial<DiscountFormValues>) => {
  const result = discountSchema.safeParse(values(over));
  return result.success
    ? []
    : result.error.issues.map(
        (issue) => `${issue.path.join(".")}: ${issue.message}`,
      );
};

const code: DiscountCode = {
  id: "c1",
  code: "DIWALI10",
  note: "Diwali newsletter",
  type: "percent",
  value: 10,
  appliesToSaleItems: true,
  minOrderValue: null,
  startsAt: null,
  expiresAt: "2026-11-15T23:00:00.000Z",
  maxUses: 100,
  oncePerCustomer: true,
  isActive: true,
  usedCount: 12,
  reservedCount: 1,
  remainingUses: 87,
  state: "active",
  createdBy: { id: "a1", name: "Vrushabh" },
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
};

describe("the rules of a discount code", () => {
  it("checks the text of the code the way the API will, unless it is generated", () => {
    expect(issues({ code: "ABC" })).toEqual(["code: 4 to 20 characters."]);
    expect(issues({ code: "-DIWALI" })).toEqual([
      expect.stringContaining("code: Letters, digits and hyphens"),
    ]);
    expect(issues({ code: "DIW ALI" })).toHaveLength(1);
    expect(issues({ code: "diwali-10" })).toEqual([]);
    expect(issues({ code: "" })).toEqual([
      "code: Enter the code, or let the API generate one.",
    ]);
    expect(issues({ code: "", generate: true })).toEqual([]);
  });

  it("takes a whole percent between 1 and 100, or an amount up to €10,000.00", () => {
    expect(issues({ value: "" })).toEqual(["value: Enter the percentage."]);
    expect(issues({ value: "10.5" })).toEqual([
      "value: Enter a whole percentage. Example: 10",
    ]);
    expect(issues({ value: "101" })).toEqual([
      "value: Between 1 and 100 percent.",
    ]);
    expect(issues({ type: "fixed", value: "" })).toEqual([
      "value: Enter the amount.",
    ]);
    expect(issues({ type: "fixed", value: "5,00" })).toEqual([]);
    expect(issues({ type: "fixed", value: "10000.01" })).toEqual([
      "value: At most €10,000.00.",
    ]);
  });

  it("checks the minimum, the limit and the period", () => {
    expect(issues({ minOrderValue: "abc" })).toEqual([
      "minOrderValue: This is not an amount. Example: 25.00",
    ]);
    expect(issues({ maxUses: "0" })).toEqual([
      "maxUses: Between 1 and 1,000,000.",
    ]);
    expect(issues({ maxUses: "1.5" })).toEqual([
      "maxUses: Enter a whole number, or leave it empty.",
    ]);
    expect(
      issues({ startsAt: "2026-11-20T10:00", expiresAt: "2026-11-20T09:00" }),
    ).toEqual(["expiresAt: The end must come after the start."]);
  });

  it("sends the API cents, a percent, instants and numbers, leaving out what is empty", () => {
    expect(
      toDiscountInput(
        values({
          code: "summer-5",
          note: " Summer ",
          type: "fixed",
          value: "5,00",
          minOrderValue: "25",
          maxUses: "50",
          expiresAt: "2026-08-31T23:59",
          oncePerCustomer: true,
        }),
      ),
    ).toEqual({
      code: "SUMMER-5",
      note: "Summer",
      type: "fixed",
      value: 500,
      appliesToSaleItems: true,
      minOrderValue: 2500,
      maxUses: 50,
      expiresAt: "2026-08-31T23:59:00+02:00",
      oncePerCustomer: true,
      isActive: true,
    });
    // Generated: no code at all.
    expect(
      toDiscountInput(values({ code: "", generate: true })),
    ).not.toHaveProperty("code");
  });

  it("patches only what changed and clears an emptied optional field with null", () => {
    const before = discountDefaults(code);
    expect(toDiscountPatch(before, code)).toEqual({});
    expect(
      toDiscountPatch(
        { ...before, note: "Diwali", maxUses: "", expiresAt: "" },
        code,
      ),
    ).toEqual({ note: "Diwali", maxUses: null, expiresAt: null });
    // The kind and the value go together: cents mean nothing without the kind.
    expect(
      toDiscountPatch({ ...before, type: "fixed", value: "5" }, code),
    ).toEqual({
      type: "fixed",
      value: 500,
    });
    expect(toDiscountPatch({ ...before, isActive: false }, code)).toEqual({
      isActive: false,
    });
  });

  it("says what a code is worth, how often it was used, and when it runs", () => {
    expect(valueText(code)).toBe("10 %");
    expect(valueText({ type: "fixed", value: 500 })).toBe("€5.00");
    expect(usesText(code)).toBe("12 of 100 · 1 pending");
    expect(usesText({ usedCount: 12, maxUses: 100, reservedCount: 0 })).toBe(
      "12 of 100",
    );
    expect(usesText({ usedCount: 3, maxUses: null, reservedCount: 0 })).toBe(
      "3 · unlimited",
    );
    const format = (value: string) => value.slice(0, 10);
    expect(periodText(code, format)).toBe("Until 2026-11-15");
    expect(
      periodText({ startsAt: "2026-11-01", expiresAt: null }, format),
    ).toBe("From 2026-11-01");
    expect(periodText({ startsAt: null, expiresAt: null }, format)).toBe(
      "Always",
    );
    expect(inUse(code)).toBe(true);
    expect(inUse({ usedCount: 0, reservedCount: 0 })).toBe(false);
  });
});
