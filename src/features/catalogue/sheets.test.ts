import { describe, expect, it } from "vitest";
import { csvOf, sheetFromMatrix } from "./sheets";

describe("a sheet read from a file", () => {
  it("keys the rows by the header, trims the cells and keeps numbers and booleans", () => {
    const sheet = sheetFromMatrix([
      [" sku ", "name_en", "regular_price", "is_visible", ""],
      ["RF-1 ", " Basmati Rice", 4.99, true, "ignored"],
      ["", "", "", "", ""],
      [null, "Atta", "8,49", "no"],
    ]);
    expect(sheet.columns).toEqual([
      "sku",
      "name_en",
      "regular_price",
      "is_visible",
    ]);
    expect(sheet.rows).toEqual([
      {
        sku: "RF-1",
        name_en: "Basmati Rice",
        regular_price: 4.99,
        is_visible: true,
      },
      { sku: "", name_en: "Atta", regular_price: "8,49", is_visible: "no" },
    ]);
  });

  it("writes CSV in the columns given, quoting what needs it", () => {
    const text = csvOf(
      ["slug_en", "name_en", "description_en"],
      [
        {
          slug_en: "snacks",
          name_en: "Snacks",
          description_en: "Crunchy, savoury",
        },
        { slug_en: "rice", name_en: "Rice & Grains" },
      ],
    );
    expect(text.split(/\r?\n/)).toEqual([
      "slug_en,name_en,description_en",
      'snacks,Snacks,"Crunchy, savoury"',
      "rice,Rice & Grains,",
    ]);
  });
});
