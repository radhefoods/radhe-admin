import { describe, expect, it } from "vitest";
import type { ProfitLine } from "@/lib/api/types";
import {
  chargedNote,
  differs,
  formatCost,
  formatExact,
  formatFine,
  formatPercent,
  packOf,
  quantityText,
} from "./profit-format";

describe("the figures of costs and profit", () => {
  it("prints an amount of the tables with two decimals", () => {
    expect(formatFine(409)).toBe("€4.09");
    expect(formatFine(27.6)).toBe("€0.28");
    expect(formatFine(410.75)).toBe("€4.11");
    expect(formatFine(-15.175)).toBe("−€0.15");
    expect(formatFine(123456.4)).toBe("€1,234.56");
    expect(formatFine(0)).toBe("€0.00");
    // A rounding that ends in nothing is nothing, not "minus nothing".
    expect(formatFine(-0.4)).toBe("€0.00");
    expect(formatFine(null)).toBe("–");
  });

  it("prints a cost as a negative amount, and no cost as zero", () => {
    expect(formatCost(450)).toBe("−€4.50");
    expect(formatCost(41.075)).toBe("−€0.41");
    expect(formatCost(0)).toBe("€0.00");
    expect(formatCost(null)).toBe("–");
  });

  it("prints a step of the calculation with up to four decimals of a euro", () => {
    expect(formatExact(138)).toBe("€1.38");
    expect(formatExact(13.8)).toBe("€0.138");
    expect(formatExact(53.13)).toBe("€0.5313");
    expect(formatExact(204.93)).toBe("€2.0493");
    expect(formatExact(14.3451)).toBe("€0.1435");
    expect(formatExact(0)).toBe("€0.00");
    expect(formatExact(151.8)).toBe("€1.518");
    expect(formatExact(123456)).toBe("€1,234.56");
    expect(formatExact(-13.8)).toBe("−€0.138");
    expect(formatExact(null)).toBe("–");
  });

  it("prints a percentage without needless zeros", () => {
    expect(formatPercent(25.77)).toBe("25.77 %");
    expect(formatPercent(35)).toBe("35 %");
    expect(formatPercent(1.4)).toBe("1.4 %");
    expect(formatPercent(-12.5)).toBe("−12.5 %");
    expect(formatPercent(0)).toBe("0 %");
    expect(formatPercent(null)).toBe("–");
    expect(formatPercent(undefined)).toBe("–");
  });

  it("tells whether the ordered figure reads differently from the final one", () => {
    expect(differs(409, 409)).toBe(false);
    expect(differs(27.6, 27.61)).toBe(false);
    expect(differs(409, 204.5)).toBe(true);
    expect(differs(105.4, null)).toBe(true);
  });
});

describe("a line of the products", () => {
  const unit: ProfitLine["unit"] = {
    cost: 138,
    rule: {
      fulfilmentPercent: 10,
      extraPercent: 0,
      extraAmount: 0,
      markupPercent: 35,
    },
    priceMode: "auto",
    calculation: {
      cost: 138,
      fulfilment: 13.8,
      extra: 0,
      markup: 53.13,
      net: 204.93,
      vat: 14.3451,
      price: 219,
    },
    price: 219,
    regularPrice: null,
  };

  it("names the pack and the quantity", () => {
    expect(packOf({ packSize: { value: 100, unit: "g" } })).toBe("100 g");
    expect(packOf({ packSize: { value: 1.5, unit: "kg" } })).toBe("1.5 kg");
    const quantity = {
      ordered: 2,
      delivered: 2,
      returned: 0,
      restocked: 0,
      kept: 2,
    };
    expect(quantityText(quantity)).toBe("2");
    expect(quantityText({ ...quantity, returned: 1, kept: 1 })).toBe(
      "2 ordered, 1 kept",
    );
    expect(quantityText({ ...quantity, delivered: 0, kept: 0 })).toBe(
      "2 ordered, 0 kept",
    );
  });

  it("says why the price charged is not the calculated one", () => {
    expect(chargedNote(unit)).toBeNull();
    expect(chargedNote({ ...unit, price: 249, priceMode: "manual" })).toBe(
      "price set by hand",
    );
    expect(chargedNote({ ...unit, price: 199, regularPrice: 219 })).toBe(
      "reduced",
    );
    expect(
      chargedNote({
        ...unit,
        price: 199,
        priceMode: "manual",
        regularPrice: 249,
      }),
    ).toBe("price set by hand, reduced");
    // Another price without a reason the API names: shown, not explained.
    expect(chargedNote({ ...unit, price: 220 })).toBe("");
    // Without a buying price there is no calculation to compare with.
    expect(chargedNote({ ...unit, cost: null, calculation: null })).toBeNull();
  });
});
