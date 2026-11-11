import { describe, expect, it } from "vitest";
import type { ProductVariant } from "@/lib/api/types";
import {
  emptyVariantRow,
  productSchema,
  productDefaults,
  toVariantInput,
  toVariantPatch,
  variantRow,
} from "./product-schema";

// The buying price and the price mode of a pack size (documentation, 31):
// what the form sends, and what it leaves to the API.

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: "66f200000000000000000042",
    sku: "RF-00042",
    gtin: null,
    packSize: { value: 100, unit: "g", label: "100 g" },
    slug: { en: "black-pepper-100g", de: null },
    displayName: { en: "Black Pepper (100 g)", de: null },
    pricing: {
      currency: "EUR",
      price: 219,
      regularPrice: 219,
      salePrice: null,
      onSale: false,
      discountPercent: null,
      discountAmount: null,
      vatIncluded: true,
      vatRate: 700,
      vatPercent: 7,
      vatAmount: 14,
      basePrice: { amount: 2190, per: "kg" },
    },
    cost: 138,
    priceMode: "auto",
    isEnabled: true,
    isDefault: true,
    stock: { quantity: 8, lowStockThreshold: null, isLow: false },
    images: [],
    createdAt: "2026-11-10T08:00:00.000Z",
    ...overrides,
  };
}

describe("the row of a pack size", () => {
  it("shows the buying price in euros and whether the price follows it", () => {
    const row = variantRow(variant());
    expect(row.cost).toBe("1.38");
    expect(row.auto).toBe(true);
    const byHand = variantRow(variant({ cost: 66.2258, priceMode: "manual" }));
    expect(byHand.cost).toBe("0.662258");
    expect(byHand.auto).toBe(false);
    expect(variantRow(variant({ cost: null })).cost).toBe("");
    // A new row: no buying price, and the price is the admin's.
    expect(emptyVariantRow().cost).toBe("");
    expect(emptyVariantRow().auto).toBe(false);
  });

  it("refuses a buying price the API would refuse", () => {
    const schema = productSchema({ creating: true });
    const problems = (cost: string) => {
      const values = productDefaults();
      values.name.en = "Black Pepper";
      values.categoryId = "66f000000000000000000001";
      values.vatRate = "7";
      values.variants = [
        {
          ...emptyVariantRow(),
          packSize: { value: "100", unit: "g" },
          regularPrice: "2.19",
          cost,
        },
      ];
      const result = schema.safeParse(values);
      return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
    };
    expect(problems("")).toEqual([]);
    expect(problems("1.38")).toEqual([]);
    expect(problems("0,662258")).toEqual([]);
    expect(problems("abc")).toEqual(["variants.0.cost"]);
    expect(problems("1.2345678")).toEqual(["variants.0.cost"]);
    expect(problems("100000.01")).toEqual(["variants.0.cost"]);
  });
});

describe("a new pack size", () => {
  const typed = {
    ...emptyVariantRow(),
    packSize: { value: "100", unit: "g" as const },
    regularPrice: "2.19",
  };

  it("sends the buying price and the mode along with the price", () => {
    expect(toVariantInput({ ...typed, cost: "1.38", auto: true })).toEqual({
      packSize: { value: 100, unit: "g" },
      regularPrice: 219,
      cost: 138,
      priceMode: "auto",
    });
  });

  it("leaves out what is not set: the API takes the price as the admin's", () => {
    expect(toVariantInput(typed)).toEqual({
      packSize: { value: 100, unit: "g" },
      regularPrice: 219,
    });
    expect(toVariantInput({ ...typed, cost: "1.38" })).toEqual({
      packSize: { value: 100, unit: "g" },
      regularPrice: 219,
      cost: 138,
    });
  });
});

describe("a change of a pack size", () => {
  it("sends nothing when nothing was changed", () => {
    expect(toVariantPatch(variantRow(variant()), variant())).toEqual({});
    const byHand = variant({ priceMode: "manual", cost: null });
    expect(toVariantPatch(variantRow(byHand), byHand)).toEqual({});
  });

  it("sends a new buying price alone: the price is the API's to calculate", () => {
    const row = { ...variantRow(variant()), cost: "1.50" };
    expect(toVariantPatch(row, variant())).toEqual({ cost: 150 });
    // Whatever the price field shows meanwhile is not sent for a price in auto.
    expect(toVariantPatch({ ...row, regularPrice: "2.38" }, variant())).toEqual(
      { cost: 150 },
    );
  });

  it("removes a buying price with null", () => {
    expect(
      toVariantPatch({ ...variantRow(variant()), cost: "" }, variant()),
    ).toEqual({ cost: null });
  });

  it("hands the price to the calculation without sending one", () => {
    const byHand = variant({ priceMode: "manual" });
    expect(
      toVariantPatch({ ...variantRow(byHand), auto: true }, byHand),
    ).toEqual({ priceMode: "auto" });
  });

  it("takes the price back with the mode, and the price when it was typed", () => {
    expect(
      toVariantPatch({ ...variantRow(variant()), auto: false }, variant()),
    ).toEqual({ priceMode: "manual" });
    expect(
      toVariantPatch(
        { ...variantRow(variant()), auto: false, regularPrice: "2.49" },
        variant(),
      ),
    ).toEqual({ priceMode: "manual", regularPrice: 249 });
  });

  it("sends a price typed for a pack size that was the admin's already", () => {
    const byHand = variant({ priceMode: "manual" });
    expect(
      toVariantPatch({ ...variantRow(byHand), regularPrice: "2.49" }, byHand),
    ).toEqual({ regularPrice: 249 });
  });
});
