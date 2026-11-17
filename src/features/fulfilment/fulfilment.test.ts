import { describe, expect, it } from "vitest";
import { buildUrl } from "@/lib/api/http";
import type { FulfilmentAdjustment, FulfilmentExport } from "@/lib/api/types";
import { param } from "@/lib/hooks/use-url-state";
import {
  FIGURE_LABEL,
  addDays,
  adjustedHint,
  adjustmentProblem,
  afterOf,
  changeText,
  customFrom,
  dayParam,
  daysOf,
  liveLine,
  naturalDirection,
  nextSort,
  parseSort,
  parseUnits,
  periodProblem,
  periodText,
  rowsText,
  sheetOf,
  signed,
  sortParam,
  takeBackOf,
} from "./fulfilment";

const TODAY = "2026-11-17";
const preset = (range: Parameters<typeof daysOf>[0]["range"]) =>
  daysOf({ range, from: "", to: "" }, TODAY);

describe("the period of the report", () => {
  it("works the presets out as days of German time", () => {
    expect(preset("all")).toEqual({});
    expect(preset("today")).toEqual({ from: TODAY, to: TODAY });
    expect(preset("yesterday")).toEqual({
      from: "2026-11-16",
      to: "2026-11-16",
    });
    // Today and the six days before, as the analytics tab counts them.
    expect(preset("last_7_days")).toEqual({ from: "2026-11-11", to: TODAY });
    expect(preset("this_month")).toEqual({ from: "2026-11-01", to: TODAY });
    expect(preset("last_month")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
    });
  });

  it("crosses the turn of a month and of a year", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(
      daysOf({ range: "last_month", from: "", to: "" }, "2026-01-05"),
    ).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(
      daysOf({ range: "yesterday", from: "", to: "" }, "2026-01-01"),
    ).toEqual({ from: "2025-12-31", to: "2025-12-31" });
  });

  it("sends a custom range as it is, with a side that may stay open", () => {
    expect(
      daysOf({ range: "custom", from: "2026-11-01", to: "2026-11-17" }, TODAY),
    ).toEqual({ from: "2026-11-01", to: "2026-11-17" });
    expect(
      daysOf({ range: "custom", from: "2026-11-01", to: "" }, TODAY),
    ).toEqual({ from: "2026-11-01" });
    expect(
      daysOf({ range: "custom", from: "", to: "2026-02-30" }, TODAY),
    ).toEqual({});
    // The days of a preset are never read from the address.
    expect(
      daysOf({ range: "today", from: "2020-01-01", to: "2020-01-02" }, TODAY),
    ).toEqual({ from: TODAY, to: TODAY });
  });

  it("refuses a custom range that runs backwards, and nothing else", () => {
    expect(
      periodProblem({ range: "custom", from: "2026-11-17", to: "2026-11-01" }),
    ).toBe("The first day must not come after the last.");
    expect(
      periodProblem({ range: "custom", from: "2026-11-17", to: "2026-11-17" }),
    ).toBeNull();
    expect(periodProblem({ range: "custom", from: "", to: "" })).toBeNull();
    expect(
      periodProblem({ range: "all", from: "2026-11-17", to: "2026-11-01" }),
    ).toBeNull();
  });

  it("starts a custom range with the days that were shown", () => {
    expect(
      customFrom({ range: "last_month", from: "", to: "" }, TODAY),
    ).toEqual({ range: "custom", from: "2026-10-01", to: "2026-10-31" });
    expect(customFrom({ range: "all", from: "", to: "" }, TODAY)).toEqual({
      range: "custom",
      from: TODAY,
      to: TODAY,
    });
  });

  it("says the period in words", () => {
    expect(periodText({})).toBe("All dates");
    expect(periodText({ from: null, to: null })).toBe("All dates");
    expect(periodText({ from: "2026-11-01", to: "2026-11-17" })).toBe(
      "1 to 17 Nov 2026",
    );
    expect(periodText({ from: TODAY, to: TODAY })).toBe("17 Nov 2026");
    expect(periodText({ from: "2026-11-01" })).toBe("From 1 Nov 2026");
    expect(periodText({ to: TODAY })).toBe("Until 17 Nov 2026");
  });

  it("takes only a day that exists from the address", () => {
    expect(dayParam.parse("2026-11-17")).toBe("2026-11-17");
    expect(dayParam.parse("2026-02-30")).toBe("");
    expect(dayParam.parse("yesterday")).toBe("");
    expect(dayParam.serialize("")).toBeNull();
  });
});

describe("the sort of the report", () => {
  it("reads the API's default and its rule without a direction", () => {
    expect(parseSort(undefined)).toEqual({
      field: "dispatched",
      direction: "desc",
    });
    expect(parseSort("name")).toEqual({ field: "name", direction: "asc" });
    expect(parseSort("net")).toEqual({ field: "net", direction: "desc" });
    expect(naturalDirection("sku")).toBe("asc");
    expect(naturalDirection("returned")).toBe("desc");
  });

  it("sorts a new column its natural way and turns the same one round", () => {
    expect(nextSort(undefined, "name")).toBe("name:asc");
    expect(nextSort("name:asc", "name")).toBe("name:desc");
    expect(nextSort("name:desc", "returned")).toBe("returned:desc");
    // The default is "dispatched, largest first": a click on it turns it round.
    expect(nextSort(undefined, "dispatched")).toBe("dispatched:asc");
  });

  it("keeps the default out of the address and refuses what the API would", () => {
    expect(sortParam.parse("net:asc")).toBe("net:asc");
    expect(sortParam.parse("dispatched:desc")).toBeUndefined();
    expect(sortParam.parse("price:asc")).toBeUndefined();
    expect(sortParam.parse("net:up")).toBeUndefined();
    expect(sortParam.serialize("dispatched:desc")).toBeNull();
    expect(sortParam.serialize("sku:asc")).toBe("sku:asc");
  });
});

describe("the words of the tracker", () => {
  it("writes a change with its sign and leaves out what does not change", () => {
    expect(signed(2)).toBe("+2");
    expect(signed(-1)).toBe("−1");
    expect(signed(0)).toBe("0");
    expect(changeText({ dispatched: 2, returned: 1 })).toBe(
      "+2 dispatched, +1 returned",
    );
    expect(changeText({ dispatched: -3, returned: 0 })).toBe("−3 dispatched");
    expect(changeText({ dispatched: 0, returned: 1 })).toBe("+1 returned");
    expect(changeText({ dispatched: 0, returned: 0 })).toBe("no change");
    expect(adjustedHint({ dispatched: 2, returned: 1 })).toBe(
      "+2 dispatched, +1 returned by hand",
    );
  });
});

describe("the file of the export", () => {
  const answer: Pick<FulfilmentExport, "columns" | "rows"> = {
    columns: [
      { key: "product_name", label: "Product name" },
      { key: "sku", label: "SKU" },
      { key: "dispatched", label: "Dispatched (API)" },
      { key: "net", label: "Net (API)" },
    ],
    rows: [
      {
        product_name: "TRS Chana Dal",
        sku: "RF-04433",
        dispatched: 20,
        net: 18,
      },
      { product_name: "=SUM(A1)", sku: "RF-04436", dispatched: 0, net: -1 },
    ],
  };

  it("writes the columns in the order of the answer, the three figures under the panel's labels", () => {
    const sheet = sheetOf(answer);
    expect(sheet.labels).toEqual([
      "Product name",
      "SKU",
      FIGURE_LABEL.dispatched,
      FIGURE_LABEL.net,
    ]);
    expect(sheet.rows).toEqual([
      {
        "Product name": "TRS Chana Dal",
        SKU: "RF-04433",
        [FIGURE_LABEL.dispatched]: "20",
        [FIGURE_LABEL.net]: "18",
      },
      {
        "Product name": "=SUM(A1)",
        SKU: "RF-04436",
        [FIGURE_LABEL.dispatched]: "0",
        // A period can be down: the number is written as it is.
        [FIGURE_LABEL.net]: "-1",
      },
    ]);
  });

  it("counts the rows in words", () => {
    expect(rowsText(1)).toBe("1 row will be exported");
    expect(rowsText(12)).toBe("12 rows will be exported");
  });
});

describe("an adjustment by hand", () => {
  const current = { dispatched: 20, returned: 2 };

  it("reads a whole number that may be negative", () => {
    expect(parseUnits("")).toBe(0);
    expect(parseUnits(" 2 ")).toBe(2);
    expect(parseUnits("+2")).toBe(2);
    expect(parseUnits("-3")).toBe(-3);
    expect(parseUnits("−3")).toBe(-3);
    expect(parseUnits("-")).toBe(0);
    expect(parseUnits("1.5")).toBeNull();
    expect(parseUnits("two")).toBeNull();
    expect(parseUnits("12345678")).toBeNull();
  });

  it("works out the figures after it; net sold follows", () => {
    expect(afterOf(current, { dispatched: 2, returned: 1 })).toEqual({
      dispatched: 22,
      returned: 3,
      net: 19,
    });
    expect(liveLine(current, { dispatched: 2, returned: 1 })).toBe(
      "Dispatched 20 → 22 · Returned 2 → 3 · Net sold 18 → 19",
    );
    expect(liveLine(current, { dispatched: 0, returned: 0 })).toBe(
      "Dispatched 20 → 20 · Returned 2 → 2 · Net sold 18 → 18",
    );
  });

  it("says before sending what the API refuses anyway", () => {
    expect(adjustmentProblem(current, { dispatched: 0, returned: 0 })).toBe(
      "Change at least one of the two figures.",
    );
    expect(adjustmentProblem(current, { dispatched: -21, returned: 0 })).toBe(
      "Only 20 units count as dispatched: the figure cannot go below zero.",
    );
    expect(adjustmentProblem(current, { dispatched: 0, returned: -3 })).toBe(
      "Only 2 units count as returned: the figure cannot go below zero.",
    );
    expect(adjustmentProblem(current, { dispatched: 0, returned: 19 })).toBe(
      "No more units can be returned than were dispatched: that would be 21 returned of 20 dispatched.",
    );
    expect(
      adjustmentProblem(current, { dispatched: 0, returned: 18 }),
    ).toBeNull();
    expect(
      adjustmentProblem(current, { dispatched: -18, returned: 0 }),
    ).toBeNull();
    expect(
      adjustmentProblem(current, { dispatched: 2, returned: 1 }),
    ).toBeNull();
  });

  it("takes an entry back with the opposite numbers and a reason that names it", () => {
    const adjustment = {
      date: "2026-11-17",
      dispatched: 2,
      returned: -1,
      reason: "Two bags sold at the market stall",
    } as FulfilmentAdjustment;
    expect(takeBackOf(adjustment)).toEqual({
      dispatched: -2,
      returned: 1,
      reason:
        "Takes back the adjustment of 17 Nov 2026: Two bags sold at the market stall",
    });
    // Never minus zero, and never longer than the API takes.
    const long = takeBackOf({
      ...adjustment,
      returned: 0,
      reason: "x".repeat(500),
    });
    expect(Object.is(long.returned, 0)).toBe(true);
    expect(long.reason).toHaveLength(500);
  });
});

describe("a list in the address and in a call", () => {
  it("sends a list as a repeated parameter and leaves an empty one out", () => {
    expect(
      buildUrl("http://api.test", "/v1/x", {
        brand: ["TRS", "India Gate"],
        q: "dal",
      }),
    ).toBe("http://api.test/v1/x?brand=TRS&brand=India+Gate&q=dal");
    expect(buildUrl("http://api.test", "/v1/x", { brand: [] })).toBe(
      "http://api.test/v1/x",
    );
  });

  it("reads every value of a repeated parameter once, trimmed", () => {
    const brands = param.list();
    expect(brands.parseAll?.(["TRS", " Heera ", "TRS", ""])).toEqual([
      "TRS",
      "Heera",
    ]);
    expect(brands.serializeAll?.(["TRS", "Heera"])).toEqual(["TRS", "Heera"]);
    expect(brands.parse(null)).toEqual([]);
    expect(param.list(2).parseAll?.(["a", "b", "c"])).toEqual(["a", "b"]);
  });
});
