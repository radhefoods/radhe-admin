import { describe, expect, it } from "vitest";
import {
  companyDefaults,
  companySchema,
  toCompanyInput,
} from "./company-section";
import { feeFor, sortTiers, tierProblems, tierSentences } from "./delivery-fee";
import { deliveryFeeDefaults, deliveryFeeSchema } from "./delivery-fee-section";
import { hourLabel, paymentsSchema } from "./payments-section";
import { missingForInvoicesText } from "./settings-frame";

const tier = (minOrderValue: number, fee: number) => ({ minOrderValue, fee });

describe("the rules of the delivery fee tiers", () => {
  it("accepts tiers of which one starts at 0 and none repeats", () => {
    expect(tierProblems([tier(0, 499), tier(5000, 0)])).toEqual([]);
    expect(tierProblems([tier(0, 0)])).toEqual([]);
    // The order does not matter: the API sorts them.
    expect(tierProblems([tier(5000, 0), tier(0, 499)])).toEqual([]);
  });

  it("asks for a tier that starts at 0, at the lowest tier", () => {
    const problems = tierProblems([tier(5000, 0), tier(1000, 499)]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.index).toBe(1);
    expect(problems[0]?.message).toMatch(/One tier must start at €0\.00/);
  });

  it("refuses two tiers at the same value, at the second of them", () => {
    const problems = tierProblems([
      tier(0, 499),
      tier(5000, 199),
      tier(5000, 0),
    ]);
    expect(problems).toEqual([
      { index: 2, message: "Another tier already starts at €50.00." },
    ]);
  });

  it("names both problems when both rules are broken", () => {
    const problems = tierProblems([tier(2000, 499), tier(2000, 0)]);
    expect(problems.map((problem) => problem.index)).toEqual([0, 1]);
  });

  it("sorts lowest first without changing what it was given", () => {
    const tiers = [tier(5000, 0), tier(0, 499)];
    expect(sortTiers(tiers)).toEqual([tier(0, 499), tier(5000, 0)]);
    expect(tiers[0]).toEqual(tier(5000, 0));
  });
});

describe("what the tiers mean", () => {
  it("says it in a sentence per tier", () => {
    expect(tierSentences([tier(0, 499), tier(5000, 0)])).toEqual([
      "Below €50.00 delivery costs €4.99.",
      "From €50.00 delivery is free.",
    ]);
  });

  it("handles a single tier", () => {
    expect(tierSentences([tier(0, 0)])).toEqual([
      "Delivery is free for every order.",
    ]);
    expect(tierSentences([tier(0, 399)])).toEqual([
      "Delivery costs €3.99 for every order.",
    ]);
  });

  it("handles tiers in between, whatever order they were typed in", () => {
    expect(
      tierSentences([tier(10000, 0), tier(0, 599), tier(5000, 299)]),
    ).toEqual([
      "Below €50.00 delivery costs €5.99.",
      "From €50.00 delivery costs €2.99.",
      "From €100.00 delivery is free.",
    ]);
  });

  it("applies the highest tier an order reaches", () => {
    const tiers = [tier(0, 499), tier(5000, 199), tier(10000, 0)];
    expect(feeFor(tiers, 0)).toBe(499);
    expect(feeFor(tiers, 4999)).toBe(499);
    expect(feeFor(tiers, 5000)).toBe(199);
    expect(feeFor(tiers, 250000)).toBe(0);
    expect(feeFor([tier(1000, 100)], 500)).toBeNull();
  });
});

describe("euros in the form, cents in the request", () => {
  it("turns what was typed into integer cents", () => {
    const parsed = deliveryFeeSchema.parse({
      tiers: [
        { minOrderValue: "0", fee: "4,99" },
        { minOrderValue: "50.00", fee: "0.00" },
        { minOrderValue: "1.234,56", fee: "€ 0" },
      ],
    });
    expect(parsed.tiers).toEqual([
      tier(0, 499),
      tier(5000, 0),
      tier(123456, 0),
    ]);
    for (const entry of parsed.tiers) {
      expect(Number.isInteger(entry.minOrderValue)).toBe(true);
      expect(Number.isInteger(entry.fee)).toBe(true);
    }
  });

  it("shows the saved cents as euros, lowest tier first", () => {
    expect(deliveryFeeDefaults([tier(5000, 0), tier(0, 499)])).toEqual({
      tiers: [
        { minOrderValue: "0.00", fee: "4.99" },
        { minOrderValue: "50.00", fee: "0.00" },
      ],
    });
  });

  it("refuses what is not an amount, and more than the API takes", () => {
    const text = deliveryFeeSchema.safeParse({
      tiers: [{ minOrderValue: "0", fee: "abc" }],
    });
    expect(text.success).toBe(false);
    const tooMuch = deliveryFeeSchema.safeParse({
      tiers: [{ minOrderValue: "0", fee: "100000.01" }],
    });
    expect(tooMuch.success).toBe(false);
  });

  it("puts the rule that is broken at the tier that has to change", () => {
    const result = deliveryFeeSchema.safeParse({
      tiers: [
        { minOrderValue: "0", fee: "4.99" },
        { minOrderValue: "0.00", fee: "0" },
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path.join("."))).toEqual([
      "tiers.1.minOrderValue",
    ]);
  });

  it("accepts 1 to 10 tiers", () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({
      minOrderValue: String(index * 10),
      fee: "1",
    }));
    expect(
      deliveryFeeSchema.safeParse({ tiers: rows.slice(0, 10) }).success,
    ).toBe(true);
    expect(deliveryFeeSchema.safeParse({ tiers: rows }).success).toBe(false);
    expect(deliveryFeeSchema.safeParse({ tiers: [] }).success).toBe(false);
  });
});

describe("the company details", () => {
  const filled = {
    name: " Radhe Foods GmbH ",
    addressLines: [
      { value: "Hauptstraße 1" },
      { value: " " },
      { value: "60311 Frankfurt" },
    ],
    email: "billing@radhefoods.de",
    phone: "",
    website: "",
    vatId: "de 123 456 789",
    taxNumber: "",
    registration: "",
    logoUrl: "",
    invoiceFooter: "",
  };

  it("sends optional keys only when they are set, and drops empty lines", () => {
    const input = toCompanyInput(companySchema.parse(filled));
    expect(JSON.parse(JSON.stringify(input))).toEqual({
      name: "Radhe Foods GmbH",
      addressLines: ["Hauptstraße 1", "60311 Frankfurt"],
      email: "billing@radhefoods.de",
      vatId: "DE123456789",
    });
  });

  it("applies the rule of each field", () => {
    const problem = (change: Partial<typeof filled>) => {
      const result = companySchema.safeParse({ ...filled, ...change });
      return result.success ? null : result.error.issues[0]?.path.join(".");
    };
    expect(problem({})).toBeNull();
    expect(problem({ name: "" })).toBe("name");
    expect(problem({ name: "x".repeat(121) })).toBe("name");
    expect(problem({ addressLines: [{ value: "" }, { value: "  " }] })).toBe(
      "addressLines.0.value",
    );
    expect(problem({ email: "not an email" })).toBe("email");
    expect(problem({ phone: "1".repeat(41) })).toBe("phone");
    expect(problem({ website: "www.radhefoods.de" })).toBe("website");
    expect(problem({ website: "https://www.radhefoods.de" })).toBeNull();
    expect(problem({ vatId: "D123" })).toBe("vatId");
    expect(problem({ vatId: "ATU12345678" })).toBeNull();
    expect(problem({ taxNumber: "1".repeat(41) })).toBe("taxNumber");
    expect(problem({ registration: "x".repeat(161) })).toBe("registration");
    expect(problem({ logoUrl: "http://radhefoods.de/logo.png" })).toBe(
      "logoUrl",
    );
    expect(problem({ logoUrl: "https://radhefoods.de/logo.png" })).toBeNull();
    expect(problem({ invoiceFooter: "x".repeat(1001) })).toBe("invoiceFooter");
  });

  it("offers two empty lines for an installation without an address", () => {
    const defaults = companyDefaults({
      name: "Radhe Foods",
      addressLines: [],
      email: "",
      missingForInvoices: ["addressLines", "email", "vatId or taxNumber"],
    });
    expect(defaults.addressLines).toEqual([{ value: "" }, { value: "" }]);
    expect(defaults.vatId).toBe("");
  });

  it("names what is missing for invoices in words", () => {
    expect(
      missingForInvoicesText(["addressLines", "email", "vatId or taxNumber"]),
    ).toBe("the address, the email address and a VAT id or a tax number");
    expect(missingForInvoicesText(["name"])).toBe("the company name");
  });
});

describe("the payment settings", () => {
  it("keeps to the ranges of the API", () => {
    const ok = paymentsSchema.safeParse({
      reminderHour: "0",
      defaultDeadlineDays: "60",
      checkoutMinutes: "1440",
    });
    expect(ok.success && ok.data).toEqual({
      reminderHour: 0,
      defaultDeadlineDays: 60,
      checkoutMinutes: 1440,
    });
    const paths = (values: Record<string, string>) => {
      const result = paymentsSchema.safeParse(values);
      return result.success
        ? []
        : result.error.issues.map((issue) => issue.path[0]);
    };
    expect(
      paths({
        reminderHour: "24",
        defaultDeadlineDays: "0",
        checkoutMinutes: "29",
      }),
    ).toEqual(["reminderHour", "defaultDeadlineDays", "checkoutMinutes"]);
    expect(
      paths({
        reminderHour: "9",
        defaultDeadlineDays: "61",
        checkoutMinutes: "1441",
      }),
    ).toEqual(["defaultDeadlineDays", "checkoutMinutes"]);
  });

  it("prints an hour as a time", () => {
    expect(hourLabel(9)).toBe("09:00");
    expect(hourLabel(23)).toBe("23:00");
  });
});
