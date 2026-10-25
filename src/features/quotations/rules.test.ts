import { describe, expect, it } from "vitest";
import type { QuotationItem } from "@/lib/api/types";
import {
  actionsFor,
  lineAmount,
  lineValues,
  LINES_SCHEMA,
  emptiedPrices,
  pricedText,
  revisionText,
  sendBlocked,
  toLinesPatch,
} from "./rules";

const item = (overrides: Partial<QuotationItem> = {}): QuotationItem => ({
  id: "670100000000000000000001",
  productId: "66f300000000000000000001",
  variantId: "66f400000000000000000001",
  sku: "DW-00041",
  name: "Daawat Original Basmati Rice",
  brand: "Daawat",
  packSize: { value: 1, unit: "kg", label: "1 kg" },
  carton: {
    units: 20,
    label: "20 × 1 kg",
    content: { value: 20, unit: "kg", label: "20 kg" },
  },
  cartons: 3,
  vatRate: 700,
  unitPrice: 8000,
  lineTotal: 24000,
  ...overrides,
});

const priced = item();
const unpriced = item({
  id: "670100000000000000000002",
  sku: "RF-00007",
  name: "Toor Dal",
  cartons: 2,
  unitPrice: null,
  lineTotal: null,
});
const items = [priced, unpriced];

const problems = (values: ReturnType<typeof lineValues>) => {
  const result = LINES_SCHEMA.safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(
        result.error.issues.map((issue) => [
          issue.path.join("."),
          issue.message,
        ]),
      );
};

describe("the lines form", () => {
  it("starts from the quotation: euros for a price, empty for none", () => {
    expect(lineValues(items)).toEqual({
      lines: [
        { id: priced.id, cartons: "3", unitPrice: "80.00" },
        { id: unpriced.id, cartons: "2", unitPrice: "" },
      ],
    });
  });

  it("accepts cartons from 1 to 10,000 and a price from one cent to €100,000, written either way", () => {
    const values = lineValues(items);
    expect(problems(values)).toEqual({});
    values.lines[1]!.unitPrice = "75,50";
    values.lines[1]!.cartons = "10000";
    expect(problems(values)).toEqual({});
    values.lines[0]!.cartons = "0";
    values.lines[1]!.unitPrice = "100,000.01";
    expect(Object.keys(problems(values))).toEqual([
      "lines.0.cartons",
      "lines.1.unitPrice",
    ]);
    values.lines[0]!.cartons = "2.5";
    expect(problems(values)["lines.0.cartons"]).toMatch(/whole number/);
  });

  it("does not let a priced line lose its price; an unpriced one may stay empty", () => {
    const values = lineValues(items);
    expect(emptiedPrices(values, items)).toEqual([]);
    values.lines[0]!.unitPrice = "";
    expect(problems(values)).toEqual({});
    expect(emptiedPrices(values, items)).toEqual([
      { index: 0, message: expect.stringMatching(/keeps a price/) as string },
    ]);
  });

  it("sends only the lines that changed, each with only what changed, in cents", () => {
    const values = lineValues(items);
    expect(toLinesPatch(values, items)).toEqual([]);
    values.lines[0]!.cartons = "4";
    values.lines[1]!.unitPrice = "62,40";
    expect(toLinesPatch(values, items)).toEqual([
      { id: priced.id, cartons: 4 },
      { id: unpriced.id, unitPrice: 6240 },
    ]);
    values.lines[0]!.unitPrice = "79.99";
    expect(toLinesPatch(values, items)[0]).toEqual({
      id: priced.id,
      cartons: 4,
      unitPrice: 7999,
    });
  });

  it("shows the amount of a line as typed, or nothing without a price", () => {
    expect(lineAmount({ id: "x", cartons: "3", unitPrice: "80" })).toBe(24000);
    expect(lineAmount({ id: "x", cartons: "3", unitPrice: "" })).toBeNull();
    expect(lineAmount({ id: "x", cartons: "", unitPrice: "80" })).toBeNull();
  });
});

describe("the words and the actions of a status", () => {
  it("offers send and cancel before sending, the outcomes after, nothing when closed", () => {
    expect(actionsFor("new")).toEqual(["send", "cancel"]);
    expect(actionsFor("draft")).toEqual(["send", "cancel"]);
    expect(actionsFor("sent")).toEqual([
      "resend",
      "decline",
      "accept",
      "cancel",
    ]);
    expect(actionsFor("accepted")).toEqual([]);
    expect(actionsFor("declined")).toEqual([]);
    expect(actionsFor("cancelled")).toEqual([]);
  });

  it("holds the send back for unsaved prices first, then for unpriced lines", () => {
    expect(sendBlocked({ items }, true)).toBe("Save the prices first.");
    expect(sendBlocked({ items }, false)).toBe("1 line without a price.");
    expect(sendBlocked({ items: [priced] }, false)).toBeNull();
  });

  it("names the revision, and says when a draft was sent before", () => {
    expect(revisionText({ status: "new", revision: 0 })).toBeNull();
    expect(revisionText({ status: "sent", revision: 1 })).toBe("Revision 1");
    expect(revisionText({ status: "draft", revision: 1 })).toBe(
      "Revision 1 sent before",
    );
    expect(revisionText({ status: "accepted", revision: 2 })).toBe(
      "Revision 2",
    );
    expect(pricedText({ pricedLines: 2, itemCount: 3 })).toBe("2 of 3 priced");
  });
});
