import { describe, expect, it } from "vitest";
import type { PriceRule } from "@/lib/api/types";
import {
  categoryOverrides,
  costToInput,
  overrideDefaults,
  overrideFields,
  parseCost,
  parseRulePercent,
  percentToInput,
  priceFromCost,
  priceRuleDefaults,
  resolveRule,
  ruleValueText,
  sameOverride,
  sameRule,
  toOverride,
  typedRule,
} from "./pricing";

const SHOP: PriceRule = {
  fulfilmentPercent: 10,
  extraPercent: 0,
  extraAmount: 0,
  markupPercent: 35,
};

describe("the price of a buying price", () => {
  it("follows the rule step by step and rounds at the end only", () => {
    // The example of the documentation: 1.38 → 1.518 → 2.0493 → 2.192751 → 2.19.
    expect(priceFromCost(138, SHOP, 700)).toEqual({
      cost: 138,
      fulfilment: 13.8,
      extra: 0,
      markup: 53.13,
      net: 204.93,
      vat: 14.3451,
      price: 219,
    });
  });

  it("adds the other expenses before the markup", () => {
    const steps = priceFromCost(
      200,
      {
        fulfilmentPercent: 10,
        extraPercent: 5,
        extraAmount: 20,
        markupPercent: 50,
      },
      1900,
    );
    // 200 + 20 + (10 + 20) = 250; markup 125; net 375; VAT 71.25.
    expect(steps).toEqual({
      cost: 200,
      fulfilment: 20,
      extra: 30,
      markup: 125,
      net: 375,
      vat: 71.25,
      price: 446,
    });
  });

  it("keeps the decimals of a buying price", () => {
    const steps = priceFromCost(66.2258, SHOP, 700);
    expect(steps.cost).toBe(66.2258);
    expect(steps.net).toBe(98.3453);
    expect(steps.price).toBe(105);
  });
});

describe("who sets a value of the rule", () => {
  it("takes the nearest level that says anything, value by value", () => {
    expect(resolveRule(SHOP, [], null)).toEqual({
      rule: SHOP,
      sources: {
        fulfilmentPercent: "shop",
        extraPercent: "shop",
        extraAmount: "shop",
        markupPercent: "shop",
      },
    });
    const resolved = resolveRule(
      SHOP,
      [{ markupPercent: 30, extraAmount: 5 }, { markupPercent: 25 }, null],
      { fulfilmentPercent: 12 },
    );
    expect(resolved.rule).toEqual({
      fulfilmentPercent: 12,
      extraPercent: 0,
      extraAmount: 5,
      markupPercent: 25,
    });
    expect(resolved.sources).toEqual({
      fulfilmentPercent: "product",
      extraPercent: "shop",
      extraAmount: "category",
      markupPercent: "category",
    });
  });

  it("lets a pack size set values of its own, below its product", () => {
    // The example of the documentation: a 10 kg bag with 12 % and 40 %.
    const resolved = resolveRule(
      SHOP,
      [{ extraAmount: 5 }],
      { markupPercent: 30 },
      {
        fulfilmentPercent: 12,
        markupPercent: 40,
      },
    );
    expect(resolved.rule).toEqual({
      fulfilmentPercent: 12,
      extraPercent: 0,
      extraAmount: 5,
      markupPercent: 40,
    });
    expect(resolved.sources).toEqual({
      fulfilmentPercent: "variant",
      extraPercent: "shop",
      extraAmount: "category",
      markupPercent: "variant",
    });
    // 15.00 → 16.80 → 23.52 → 25.17 at 7 % VAT; by the rule of the shop 23.83.
    const own = resolveRule(SHOP, [], null, {
      fulfilmentPercent: 12,
      markupPercent: 40,
    });
    expect(priceFromCost(1500, own.rule, 700).price).toBe(2517);
    expect(priceFromCost(1500, SHOP, 700).price).toBe(2383);
    expect(
      priceFromCost(800, resolveRule(SHOP, [], null, null).rule, 700).price,
    ).toBe(1271);
    // A pack size that sets nothing follows its product, value by value.
    expect(resolveRule(SHOP, [], { markupPercent: 30 }, null).sources).toEqual(
      resolveRule(SHOP, [], { markupPercent: 30 }).sources,
    );
    expect(
      resolveRule(SHOP, [], { markupPercent: 30 }, { markupPercent: null })
        .sources.markupPercent,
    ).toBe("product");
  });

  it("counts a zero as a value and a null as none", () => {
    const resolved = resolveRule(SHOP, [{ markupPercent: 0 }], {
      markupPercent: null,
      fulfilmentPercent: 0,
    });
    expect(resolved.rule.markupPercent).toBe(0);
    expect(resolved.sources.markupPercent).toBe("category");
    expect(resolved.rule.fulfilmentPercent).toBe(0);
    expect(resolved.sources.fulfilmentPercent).toBe("product");
  });

  it("collects the overrides of a category and of the ones above it, top first", () => {
    const categories = [
      { id: "a", parentId: null, pricing: { markupPercent: 30 } },
      { id: "b", parentId: "a", pricing: null },
      { id: "c", parentId: "b", pricing: { fulfilmentPercent: 8 } },
      { id: "d", parentId: null, pricing: null },
    ];
    expect(categoryOverrides(categories, "c")).toEqual([
      { markupPercent: 30 },
      null,
      { fulfilmentPercent: 8 },
    ]);
    expect(categoryOverrides(categories, "d")).toEqual([null]);
    expect(categoryOverrides(categories, "")).toEqual([]);
    expect(categoryOverrides(categories, "missing")).toEqual([]);
  });
});

describe("typing the values of the rule", () => {
  it("reads a percentage of 0 to 1000 with two decimals", () => {
    expect(parseRulePercent("35")).toBe(35);
    expect(parseRulePercent("12,5")).toBe(12.5);
    expect(parseRulePercent("7.25 %")).toBe(7.25);
    expect(parseRulePercent("0")).toBe(0);
    expect(parseRulePercent("1000")).toBe(1000);
    expect(parseRulePercent("1000.01")).toBeNull();
    expect(parseRulePercent("1.234")).toBeNull();
    expect(parseRulePercent("-5")).toBeNull();
    expect(parseRulePercent("")).toBeNull();
    expect(parseRulePercent("abc")).toBeNull();
    expect(percentToInput(35)).toBe("35");
    expect(percentToInput(12.5)).toBe("12.5");
    expect(percentToInput(7.25)).toBe("7.25");
    expect(percentToInput(null)).toBe("");
  });

  it("reads a buying price in euros with up to six decimals, as cents", () => {
    expect(parseCost("1.38")).toBe(138);
    expect(parseCost("1,38")).toBe(138);
    expect(parseCost("€ 0.662258")).toBe(66.2258);
    expect(parseCost("12")).toBe(1200);
    expect(parseCost("0")).toBe(0);
    expect(parseCost("100000")).toBe(10_000_000);
    expect(parseCost("100000.01")).toBeNull();
    expect(parseCost("1.2345678")).toBeNull();
    expect(parseCost("")).toBeNull();
    expect(parseCost("-1")).toBeNull();
    expect(costToInput(138)).toBe("1.38");
    expect(costToInput(66.2258)).toBe("0.662258");
    expect(costToInput(1200)).toBe("12.00");
    expect(costToInput(0)).toBe("0.00");
    expect(costToInput(13.8)).toBe("0.138");
    expect(costToInput(null)).toBe("");
    // What is shown reads back as the same buying price.
    for (const cents of [138, 66.2258, 0.0001, 9_999_999.9999, 1200]) {
      expect(parseCost(costToInput(cents))).toBe(cents);
    }
  });

  it("makes a rule of the four fields of the shop", () => {
    expect(priceRuleDefaults(SHOP)).toEqual({
      fulfilmentPercent: "10",
      extraPercent: "0",
      extraAmount: "0.00",
      markupPercent: "35",
    });
    expect(typedRule(priceRuleDefaults(SHOP))).toEqual(SHOP);
    expect(
      typedRule({
        fulfilmentPercent: "12,5",
        extraPercent: "1",
        extraAmount: "0.10",
        markupPercent: "40",
      }),
    ).toEqual({
      fulfilmentPercent: 12.5,
      extraPercent: 1,
      extraAmount: 10,
      markupPercent: 40,
    });
    expect(
      typedRule({ ...priceRuleDefaults(SHOP), markupPercent: "" }),
    ).toBeNull();
    expect(
      typedRule({ ...priceRuleDefaults(SHOP), extraAmount: "1000.01" }),
    ).toBeNull();
    expect(sameRule(SHOP, { ...SHOP })).toBe(true);
    expect(sameRule(SHOP, { ...SHOP, markupPercent: 36 })).toBe(false);
  });

  it("names a value of the rule", () => {
    expect(ruleValueText("markupPercent", 35)).toBe("35 %");
    expect(ruleValueText("fulfilmentPercent", 12.5)).toBe("12.5 %");
    expect(ruleValueText("extraAmount", 10)).toBe("€0.10");
  });
});

describe("the values a category or a product sets itself", () => {
  it("sends only what is set, and null when nothing is", () => {
    expect(overrideDefaults(null)).toEqual({
      fulfilmentPercent: "",
      extraPercent: "",
      extraAmount: "",
      markupPercent: "",
    });
    expect(toOverride(overrideDefaults(null))).toBeNull();
    expect(
      toOverride({ ...overrideDefaults(null), markupPercent: "50" }),
    ).toEqual({ markupPercent: 50 });
    expect(
      toOverride({
        fulfilmentPercent: "0",
        extraPercent: "",
        extraAmount: "0.25",
        markupPercent: "27,5",
      }),
    ).toEqual({ fulfilmentPercent: 0, extraAmount: 25, markupPercent: 27.5 });
    // What the API answers reads back as the same override.
    const override = { markupPercent: 50, extraAmount: 25 };
    expect(toOverride(overrideDefaults(override))).toEqual(override);
  });

  it("compares two overrides by what they set", () => {
    expect(sameOverride(null, {})).toBe(true);
    expect(sameOverride(null, { markupPercent: null })).toBe(true);
    expect(sameOverride({ markupPercent: 50 }, { markupPercent: 50 })).toBe(
      true,
    );
    expect(sameOverride({ markupPercent: 50 }, null)).toBe(false);
    expect(sameOverride({ markupPercent: 0 }, null)).toBe(false);
  });

  it("refuses a value the API would refuse, and takes an empty field", () => {
    const problems = (changed: Record<string, string>) => {
      const result = overrideFields.safeParse({
        ...overrideDefaults(null),
        ...changed,
      });
      return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
    };
    expect(problems({})).toEqual([]);
    expect(problems({ markupPercent: "1000" })).toEqual([]);
    expect(problems({ markupPercent: "1001" })).toEqual(["markupPercent"]);
    expect(problems({ fulfilmentPercent: "1.234" })).toEqual([
      "fulfilmentPercent",
    ]);
    expect(problems({ extraAmount: "1000.00" })).toEqual([]);
    expect(problems({ extraAmount: "1000.01" })).toEqual(["extraAmount"]);
    expect(problems({ extraAmount: "abc" })).toEqual(["extraAmount"]);
  });
});
