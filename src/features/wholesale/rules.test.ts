import { describe, expect, it } from "vitest";
import type { WholesaleSku } from "@/lib/api/types";
import {
  cartonsText,
  overviewState,
  readStockChange,
  skuStockState,
} from "./rules";

const sku = (label: string): Pick<WholesaleSku, "carton"> => ({
  carton: {
    units: 20,
    label,
    content: { value: 20, unit: "kg", label: "20 kg" },
  },
});

describe("the words for cartons and stock", () => {
  it("lists the cartons of a product as the API labels them", () => {
    expect(cartonsText([sku("20 × 1 kg"), sku("4 × 5 kg")])).toBe(
      "20 × 1 kg, 4 × 5 kg",
    );
  });

  it("calls a count below zero a shortage, and nothing else", () => {
    expect(skuStockState(-1)).toEqual({ label: "Short", tone: "danger" });
    expect(skuStockState(0)).toBeNull();
    expect(skuStockState(12)).toBeNull();
    expect(overviewState({ quantity: 10, shortSkus: 0 })).toBeNull();
    expect(overviewState({ quantity: 10, shortSkus: 1 })?.label).toBe(
      "1 SKU short",
    );
    expect(overviewState({ quantity: -4, shortSkus: 2 })?.label).toBe(
      "2 SKUs short",
    );
  });
});

describe("the stock dialog", () => {
  it("sends the exact count, below zero included", () => {
    expect(readStockChange({ mode: "set", value: "35", note: "" }, 40)).toEqual(
      {
        body: { quantity: 35 },
        delta: -5,
        after: 35,
        problem: null,
      },
    );
    expect(
      readStockChange({ mode: "set", value: "-2", note: "Counted" }, 3),
    ).toEqual({
      body: { quantity: -2, note: "Counted" },
      delta: -5,
      after: -2,
      problem: null,
    });
  });

  it("sends a change with its sign and lets the count go below zero", () => {
    expect(
      readStockChange({ mode: "adjust", value: "+24", note: "" }, 10).body,
    ).toEqual({ delta: 24 });
    expect(
      readStockChange({ mode: "adjust", value: "-50", note: "" }, 35),
    ).toEqual({
      body: { delta: -50 },
      delta: -50,
      after: -15,
      problem: null,
    });
    expect(
      readStockChange({ mode: "adjust", value: "−4", note: "" }, 10).body,
    ).toEqual({ delta: -4 });
  });

  it("refuses what the API would refuse, with the reason", () => {
    expect(
      readStockChange({ mode: "set", value: "", note: "" }, 0).problem,
    ).toBe("Enter a number.");
    expect(
      readStockChange({ mode: "set", value: "2.5", note: "" }, 0).problem,
    ).toMatch(/whole number/);
    expect(
      readStockChange({ mode: "adjust", value: "0", note: "" }, 0).problem,
    ).toBe("Nothing would change.");
    expect(
      readStockChange({ mode: "set", value: "1000001", note: "" }, 0).problem,
    ).toMatch(/At most 1,000,000/);
  });
});
