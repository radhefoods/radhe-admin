import { describe, expect, it } from "vitest";
import { formatDelta, readStockChange, stockState } from "./stock";

const stock = { quantity: 12 };

describe("the stock dialog (documentation, 8: POST /products/{id}/stock)", () => {
  it("sends the counted number as `quantity`", () => {
    expect(
      readStockChange({ mode: "set", value: " 20 ", note: "" }, stock),
    ).toEqual({ body: { quantity: 20 }, delta: 8, after: 20, problem: null });
    expect(
      readStockChange({ mode: "set", value: "0", note: " Gone off " }, stock),
    ).toEqual({
      body: { quantity: 0, note: "Gone off" },
      delta: -12,
      after: 0,
      problem: null,
    });
  });

  it("sends units in or out as `delta`, never both fields", () => {
    expect(
      readStockChange({ mode: "adjust", value: "+5", note: "" }, stock).body,
    ).toEqual({ delta: 5 });
    expect(
      readStockChange({ mode: "adjust", value: "5", note: "" }, stock).body,
    ).toEqual({ delta: 5 });
    expect(
      readStockChange({ mode: "adjust", value: "-4", note: "" }, stock),
    ).toEqual({ body: { delta: -4 }, delta: -4, after: 8, problem: null });
  });

  it("refuses what the API would refuse, with the numbers", () => {
    expect(
      readStockChange({ mode: "adjust", value: "-13", note: "" }, stock)
        .problem,
    ).toBe("Only 12 units are in stock; 13 cannot be removed.");
    expect(
      readStockChange(
        { mode: "adjust", value: "-2", note: "" },
        { quantity: 1 },
      ).problem,
    ).toBe("Only 1 unit is in stock; 2 cannot be removed.");
    expect(
      readStockChange({ mode: "set", value: "-1", note: "" }, stock).problem,
    ).toBe("Enter a whole number, 0 or more.");
    expect(
      readStockChange({ mode: "set", value: "1000001", note: "" }, stock)
        .problem,
    ).toBe("At most 1,000,000 units.");
    expect(
      readStockChange({ mode: "adjust", value: "0", note: "" }, stock).problem,
    ).toBe("Nothing would change.");
    expect(
      readStockChange({ mode: "adjust", value: "", note: "" }, stock).problem,
    ).toBe("Enter a number.");
    expect(
      readStockChange({ mode: "adjust", value: "1.5", note: "" }, stock)
        .problem,
    ).toMatch(/whole number/);
  });

  it("prints a change with its sign", () => {
    expect(formatDelta(12)).toBe("+12");
    expect(formatDelta(-4)).toBe("−4");
    expect(formatDelta(0)).toBe("0");
  });

  it("names the state of a stock", () => {
    expect(
      stockState({ quantity: 0, lowStockThreshold: null, isLow: false }),
    ).toEqual({ label: "Sold out", tone: "danger" });
    expect(
      stockState({ quantity: 3, lowStockThreshold: 5, isLow: true }),
    ).toEqual({ label: "Low stock", tone: "attention" });
    expect(
      stockState({ quantity: 30, lowStockThreshold: 5, isLow: false }),
    ).toBeNull();
  });
});
