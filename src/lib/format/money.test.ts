import { describe, expect, it } from "vitest";
import {
  centsToInput,
  formatMoney,
  formatVatRate,
  parseEuros,
  parseVatRate,
  rateToInput,
  vatInside,
} from "./money";

describe("formatMoney", () => {
  it("prints integer cents as euros", () => {
    expect(formatMoney(1999)).toBe("€19.99");
    expect(formatMoney(0)).toBe("€0.00");
    expect(formatMoney(5)).toBe("€0.05");
    expect(formatMoney(100)).toBe("€1.00");
  });

  it("groups thousands", () => {
    expect(formatMoney(584260)).toBe("€5,842.60");
    expect(formatMoney(123456789)).toBe("€1,234,567.89");
  });

  it("prints a credit with a real minus sign", () => {
    expect(formatMoney(-499)).toBe("−€4.99");
  });

  it("never prints a float", () => {
    expect(formatMoney(19.99)).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
  });
});

describe("parseEuros", () => {
  it("reads both ways of writing a decimal", () => {
    expect(parseEuros("19.99")).toBe(1999);
    expect(parseEuros("19,99")).toBe(1999);
    expect(parseEuros("19")).toBe(1900);
    expect(parseEuros("19,9")).toBe(1990);
    expect(parseEuros("0,05")).toBe(5);
    expect(parseEuros("€ 4,99")).toBe(499);
    expect(parseEuros(" 12.50 € ")).toBe(1250);
  });

  it("reads grouped thousands", () => {
    expect(parseEuros("1.234,56")).toBe(123456);
    expect(parseEuros("1,234.56")).toBe(123456);
    expect(parseEuros("1.234")).toBe(123400);
    expect(parseEuros("1,234")).toBe(123400);
    expect(parseEuros("12.345.678,90")).toBe(1234567890);
  });

  it("stays exact where floats are not", () => {
    // 0.1 + 0.2, 1.15 * 100, 8.2 * 100 all go wrong as floats.
    expect(parseEuros("0.30")).toBe(30);
    expect(parseEuros("1.15")).toBe(115);
    expect(parseEuros("8.20")).toBe(820);
    expect(parseEuros("4.35")).toBe(435);
    expect(parseEuros("99999.99")).toBe(9999999);
  });

  it("refuses what is not an amount", () => {
    expect(parseEuros("")).toBeNull();
    expect(parseEuros("abc")).toBeNull();
    expect(parseEuros("-5")).toBeNull();
    expect(parseEuros("1.2345")).toBeNull();
    expect(parseEuros("1,2,3")).toBeNull();
    expect(parseEuros("12.34.56")).toBeNull();
    expect(parseEuros("1e3")).toBeNull();
    expect(parseEuros(",50")).toBeNull();
  });

  it("round-trips with the value of an input", () => {
    for (const cents of [0, 1, 99, 100, 1999, 584260, 10_000_000]) {
      expect(parseEuros(centsToInput(cents))).toBe(cents);
    }
  });
});

describe("centsToInput", () => {
  it("is empty for a missing amount", () => {
    expect(centsToInput(null)).toBe("");
    expect(centsToInput(undefined)).toBe("");
  });

  it("has two decimals and no grouping", () => {
    expect(centsToInput(123456)).toBe("1234.56");
    expect(centsToInput(5)).toBe("0.05");
  });
});

describe("VAT rates", () => {
  it("prints hundredths of a percent", () => {
    expect(formatVatRate(700)).toBe("7 %");
    expect(formatVatRate(1900)).toBe("19 %");
    expect(formatVatRate(1070)).toBe("10.7 %");
    expect(formatVatRate(0)).toBe("0 %");
    expect(rateToInput(1905)).toBe("19.05");
  });

  it("reads a percentage", () => {
    expect(parseVatRate("7")).toBe(700);
    expect(parseVatRate("19 %")).toBe(1900);
    expect(parseVatRate("10,7")).toBe(1070);
    expect(parseVatRate("0")).toBe(0);
    expect(parseVatRate("100")).toBe(10000);
    expect(parseVatRate("101")).toBeNull();
    expect(parseVatRate("7.123")).toBeNull();
    expect(parseVatRate("")).toBeNull();
  });

  it("derives the VAT inside a gross amount like the API", () => {
    // The example of the documentation (10.2): 3097 gross at 7 %.
    expect(vatInside(3097, 700)).toBe(203);
    expect(vatInside(2598, 700)).toBe(170);
    expect(vatInside(1190, 1900)).toBe(190);
    expect(vatInside(1000, 0)).toBe(0);
  });
});
