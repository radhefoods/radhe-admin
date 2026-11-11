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

  it("writes a cell a spreadsheet would run as a formula as text", () => {
    const text = csvOf(
      ["name_en", "stock", "note"],
      [
        { name_en: '=HYPERLINK("http://evil.example")', stock: "-5" },
        { name_en: "@SUM(1+1)", stock: "+1.5", note: "- not a number" },
        { name_en: "+cmd|' /C calc'!A0", stock: "12", note: "Rice - 5 kg" },
      ],
    );
    expect(text.split(/\r?\n/)).toEqual([
      "name_en,stock,note",
      // Numbers with a sign stay numbers; text in the middle is untouched.
      '"\'=HYPERLINK(""http://evil.example"")",-5,',
      '"\'@SUM(1+1)",+1.5,"\'- not a number"',
      "\"'+cmd|' /C calc'!A0\",12,Rice - 5 kg",
    ]);
  });

  it("reads the guarded cells of an export back as they were", () => {
    const sheet = sheetFromMatrix([
      ["name_en", "stock", "note"],
      ["'=HYPERLINK(1)", "-5", "'- not a number"],
      ["'t is fine", "'12", "'@home"],
    ]);
    expect(sheet.rows).toEqual([
      { name_en: "=HYPERLINK(1)", stock: "-5", note: "- not a number" },
      // An apostrophe before anything else is the text's own.
      { name_en: "'t is fine", stock: "'12", note: "@home" },
    ]);
  });
});
