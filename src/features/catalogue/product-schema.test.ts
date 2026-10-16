import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { PriceView, ProductDetail, ProductVariant } from "@/lib/api/types";
import {
  PRODUCT_FIELD_ALIASES,
  emptyVariantRow,
  linesOf,
  parsePackValue,
  planIsEmpty,
  planOf,
  productDefaults,
  productErrorField,
  productSchema,
  saleOf,
  salePreview,
  toProductInput,
  toProductPatch,
  toTag,
  toVariantPatch,
  variantErrorRow,
  variantFieldAliases,
  variantRow,
  type ProductFormValues,
  type VariantRowValues,
} from "./product-schema";

const CATEGORY = "66f000000000000000000001";

function pricing(
  regularPrice: number,
  salePrice: number | null = null,
): PriceView {
  const price = salePrice ?? regularPrice;
  return {
    currency: "EUR",
    price,
    regularPrice,
    salePrice,
    onSale: salePrice !== null,
    discountPercent:
      salePrice === null
        ? null
        : Math.round((1 - salePrice / regularPrice) * 100),
    discountAmount: salePrice === null ? null : regularPrice - salePrice,
    vatIncluded: true,
    vatRate: 700,
    vatPercent: 7,
    vatAmount: Math.round((price * 700) / 10700),
    basePrice: { amount: Math.round(price / 5), per: "kg" },
  };
}

function variant(overrides: Partial<ProductVariant> = {}): ProductVariant {
  return {
    id: "66f200000000000000000042",
    sku: "RF-00042",
    gtin: "8901234567890",
    packSize: { value: 5, unit: "kg", label: "5 kg" },
    slug: { en: "basmati-rice-5kg", de: "basmati-reis-5kg" },
    displayName: { en: "Basmati Rice (5 kg)", de: "Basmati Reis (5 kg)" },
    pricing: pricing(2499, 1999),
    isEnabled: true,
    isDefault: true,
    stock: { quantity: 40, lowStockThreshold: null, isLow: false },
    createdAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

const SMALL = variant({
  id: "66f200000000000000000041",
  sku: "RF-00041",
  gtin: null,
  packSize: { value: 1, unit: "kg", label: "1 kg" },
  slug: { en: "basmati-rice-1kg", de: "basmati-reis-1kg" },
  displayName: { en: "Basmati Rice (1 kg)", de: "Basmati Reis (1 kg)" },
  pricing: pricing(549),
  isDefault: false,
  stock: { quantity: 120, lowStockThreshold: 10, isLow: false },
});

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  const variants = overrides.variants ?? [variant()];
  return {
    id: "66f300000000000000000042",
    name: { en: "Basmati Rice", de: "Basmati Reis" },
    slug: { en: "basmati-rice", de: "basmati-reis" },
    brand: "India Gate",
    category: { id: CATEGORY, name: { en: "Rice", de: "Reis" } },
    status: "active",
    isAvailable: true,
    isFeatured: false,
    sortOrder: 0,
    vatRate: 700,
    priceFrom: variants[0]!.pricing.price,
    defaultVariant: variants.find((entry) => entry.isDefault) ?? variants[0]!,
    variants,
    variantCount: variants.length,
    stock: {
      quantity: variants.reduce((sum, entry) => sum + entry.stock.quantity, 0),
      lowVariants: 0,
      isLow: false,
    },
    imageCount: 0,
    image: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    subtitle: null,
    shortDescription: { en: "Long grain rice." },
    description: { en: "Aged basmati.", de: "Gereifter Basmati." },
    highlights: { en: ["Aged 2 years", "Long grain"], de: [] },
    uses: { en: [], de: [] },
    categoryId: CATEGORY,
    minOrderQuantity: 1,
    maxOrderQuantity: null,
    storageType: "ambient",
    food: {
      ingredients: { en: "Basmati rice" },
      allergens: null,
      nutrition: null,
      storageInstructions: null,
      origin: "India",
      manufacturer: null,
    },
    tags: ["new"],
    searchKeywords: ["Reis"],
    seo: null,
    images: [],
    publishedAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

/** A row of a new pack size as typed. */
function row(overrides: Partial<VariantRowValues> = {}): VariantRowValues {
  return {
    ...emptyVariantRow("kg"),
    packSize: { value: "1", unit: "kg" },
    regularPrice: "4.49",
    ...overrides,
  };
}

/** A new product as the form holds it once the required fields are typed. */
function typed(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    ...productDefaults(),
    name: { en: "Toor Dal", de: "" },
    categoryId: CATEGORY,
    variants: [row()],
    vatRate: "7",
    ...overrides,
  };
}

/** The same with the first row changed. */
function typedRow(overrides: Partial<VariantRowValues>): ProductFormValues {
  return typed({ variants: [row(overrides)] });
}

function problems(
  values: ProductFormValues,
  creating = true,
): Record<string, string> {
  const result = productSchema({ creating }).safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

describe("reading what was typed", () => {
  it("takes a list one entry per line and drops empty lines", () => {
    expect(linesOf(" Aged 2 years \n\n  Long grain\r\n")).toEqual([
      "Aged 2 years",
      "Long grain",
    ]);
    expect(linesOf("")).toEqual([]);
  });

  it("reads a pack size with a point or a comma, at most three decimals", () => {
    expect(parsePackValue("5")).toBe(5);
    expect(parsePackValue("0,5")).toBe(0.5);
    expect(parsePackValue("1.250")).toBe(1.25);
    expect(parsePackValue("0.001")).toBe(0.001);
    expect(parsePackValue("1.2345")).toBeNull();
    expect(parsePackValue("five")).toBeNull();
    expect(parsePackValue("")).toBeNull();
    expect(parsePackValue("-1")).toBeNull();
  });

  it("makes a tag of what was typed", () => {
    expect(toTag("Gluten Free")).toBe("gluten-free");
    expect(toTag("  Süß & scharf ")).toBe("suess-scharf");
    expect(toTag("---")).toBe("");
    expect(toTag("a".repeat(60))).toHaveLength(40);
  });
});

describe("the rules of a product (documentation, 8)", () => {
  it("accepts a new product with only the required fields", () => {
    expect(problems(typed())).toEqual({});
  });

  it("requires the English name, a category, the VAT rate, and a pack size with its price", () => {
    const missing = problems(productDefaults());
    expect(missing["name.en"]).toBe("The English name is required.");
    expect(missing.categoryId).toBe("Choose a category.");
    expect(missing["variants.0.packSize.value"]).toBe("Enter the pack size.");
    expect(missing["variants.0.regularPrice"]).toBe("Enter an amount.");
    expect(missing.vatRate).toBeDefined();
  });

  it("keeps the article number to the API's pattern, and lets a new pack size leave it empty", () => {
    const sku = (value: string) =>
      problems(typedRow({ sku: value }))["variants.0.sku"];
    expect(sku("")).toBeUndefined();
    expect(sku("rf-00042")).toBeUndefined();
    expect(sku("A")).toBeDefined();
    expect(sku("-RF1")).toBeDefined();
    expect(sku("RF 42")).toBeDefined();
    expect(sku("A".repeat(41))).toBeDefined();
  });

  it("wants an address for a product that exists, and an article number for a saved pack size", () => {
    const existing = productDefaults(product());
    expect(problems(existing, false)).toEqual({});
    expect(
      problems(
        { ...existing, variants: [{ ...existing.variants[0]!, sku: " " }] },
        false,
      )["variants.0.sku"],
    ).toBe("A pack size keeps its article number. Type one.");
    expect(
      problems({ ...existing, slug: { en: "", de: "x" } }, false)["slug.en"],
    ).toBeDefined();
  });

  it("takes a barcode of 8, 12, 13 or 14 digits", () => {
    const gtin = (value: string) =>
      problems(typedRow({ gtin: value }))["variants.0.gtin"];
    for (const value of [
      "12345678",
      "123456789012",
      "1234567890123",
      "12345678901234",
      "",
    ]) {
      expect(gtin(value)).toBeUndefined();
    }
    for (const value of [
      "1234567",
      "123456789",
      "12345678901",
      "abc45678",
      "123456789012345",
    ]) {
      expect(gtin(value)).toBeDefined();
    }
  });

  it("keeps the pack size between 0.001 and 1,000,000", () => {
    const pack = (value: string) =>
      problems(typedRow({ packSize: { value, unit: "g" } }))[
        "variants.0.packSize.value"
      ];
    expect(pack("0.001")).toBeUndefined();
    expect(pack("1000000")).toBeUndefined();
    expect(pack("0")).toBeDefined();
    expect(pack("1000001")).toBeDefined();
    expect(pack("0.0001")).toBeDefined();
  });

  it("keeps the price between one cent and 100,000 euros", () => {
    const price = (value: string) =>
      problems(typedRow({ regularPrice: value }))["variants.0.regularPrice"];
    expect(price("0.01")).toBeUndefined();
    expect(price("100000")).toBeUndefined();
    expect(price("0")).toBeDefined();
    expect(price("100000.01")).toBeDefined();
    expect(price("4.9999")).toBeDefined();
    expect(price("four")).toBeDefined();
  });

  it("wants the sale price below the regular price", () => {
    const sale = (salePrice: string) =>
      problems(
        typedRow({ regularPrice: "24.99", saleMode: "price", salePrice }),
      )["variants.0.salePrice"];
    expect(sale("19.99")).toBeUndefined();
    expect(sale("24.99")).toMatch(/below the regular price \(€24\.99\)/);
    expect(sale("30")).toBeDefined();
    expect(sale("")).toMatch(/Enter the sale price/);
    expect(sale("0")).toBeDefined();
  });

  it("wants a discount of 1 to 99 percent", () => {
    const percent = (discountPercent: string) =>
      problems(typedRow({ saleMode: "percent", discountPercent }))[
        "variants.0.discountPercent"
      ];
    expect(percent("1")).toBeUndefined();
    expect(percent("99")).toBeUndefined();
    expect(percent("0")).toBeDefined();
    expect(percent("100")).toBeDefined();
    expect(percent("12.5")).toBeDefined();
    expect(percent("")).toBeDefined();
  });

  it("ignores what stands in the sale fields while there is no sale", () => {
    expect(
      problems(
        typedRow({
          saleMode: "none",
          salePrice: "999",
          discountPercent: "abc",
        }),
      ),
    ).toEqual({});
  });

  it("keeps the opening stock and the threshold between 0 and 1,000,000", () => {
    expect(
      problems(typedRow({ stockQuantity: "-1" }))["variants.0.stockQuantity"],
    ).toMatch(/Between 0 and/);
    expect(
      problems(typedRow({ lowStockThreshold: "1000001" }))[
        "variants.0.lowStockThreshold"
      ],
    ).toMatch(/Between 0 and/);
    expect(
      problems(typedRow({ stockQuantity: "", lowStockThreshold: "" })),
    ).toEqual({});
  });

  it("wants the pack sizes of one unit family, each pack once, and each article number once", () => {
    const rows = (...entries: Partial<VariantRowValues>[]) =>
      problems(typed({ variants: entries.map((entry) => row(entry)) }));
    expect(
      rows(
        { packSize: { value: "1", unit: "kg" } },
        { packSize: { value: "500", unit: "ml" } },
      )["variants.1.packSize.unit"],
    ).toMatch(/one unit family/);
    // 1 kg and 1000 g are the same pack.
    expect(
      rows(
        { packSize: { value: "1", unit: "kg" } },
        { packSize: { value: "1000", unit: "g" } },
      )["variants.1.packSize.value"],
    ).toMatch(/same pack as row 1/);
    expect(
      rows(
        { packSize: { value: "1", unit: "kg" }, sku: "rf-1" },
        { packSize: { value: "5", unit: "kg" }, sku: "RF-1" },
      )["variants.1.sku"],
    ).toMatch(/same article number as row 1/);
    expect(
      rows(
        { packSize: { value: "1", unit: "kg" } },
        { packSize: { value: "5", unit: "kg" } },
        { packSize: { value: "250", unit: "g" } },
      ),
    ).toEqual({});
    // A row marked for removal does not count.
    expect(
      rows(
        { packSize: { value: "1", unit: "kg" } },
        { packSize: { value: "1", unit: "kg" }, removed: true },
      ),
    ).toEqual({});
  });

  it("wants at least one and at most 20 pack sizes", () => {
    expect(problems(typed({ variants: [] })).variants).toBe(
      "A product needs at least one pack size.",
    );
    expect(
      problems(typed({ variants: [row({ removed: true })] })).variants,
    ).toBe("A product needs at least one pack size.");
    const many = Array.from({ length: 21 }, (_, index) =>
      row({ packSize: { value: String(index + 1), unit: "kg" } }),
    );
    expect(problems(typed({ variants: many })).variants).toMatch(
      /at most 20 pack sizes/,
    );
  });

  it("wants the largest order quantity not below the smallest", () => {
    expect(
      problems(typed({ minOrderQuantity: "3", maxOrderQuantity: "2" }))
        .maxOrderQuantity,
    ).toMatch(/smallest quantity \(3\)/);
    expect(
      problems(typed({ minOrderQuantity: "3", maxOrderQuantity: "3" })),
    ).toEqual({});
    expect(
      problems(typed({ minOrderQuantity: "3", maxOrderQuantity: "" })),
    ).toEqual({});
    expect(
      problems(typed({ minOrderQuantity: "0" })).minOrderQuantity,
    ).toBeDefined();
    expect(
      problems(typed({ maxOrderQuantity: "10001" })).maxOrderQuantity,
    ).toBeDefined();
    expect(problems(typed({ sortOrder: "1000001" })).sortOrder).toBeDefined();
  });

  it("limits the texts, the lists, the tags and the keywords", () => {
    expect(
      problems(typed({ name: { en: "x".repeat(161), de: "" } }))["name.en"],
    ).toBeDefined();
    expect(
      problems(typed({ subtitle: { en: "x".repeat(301), de: "" } }))[
        "subtitle.en"
      ],
    ).toBeDefined();
    expect(problems(typed({ brand: "x".repeat(81) })).brand).toBeDefined();
    const many = Array.from(
      { length: 21 },
      (_, index) => `Entry ${index}`,
    ).join("\n");
    expect(
      problems(typed({ highlights: { en: many, de: "" } }))["highlights.en"],
    ).toMatch(/At most 20 entries/);
    expect(
      problems(typed({ uses: { en: "", de: "x".repeat(301) } }))["uses.de"],
    ).toBeDefined();
    expect(problems(typed({ tags: ["vegan", "vegan"] })).tags).toBe(
      "Each tag only once.",
    );
    expect(problems(typed({ tags: ["Not A Tag"] })).tags).toBeDefined();
    expect(
      problems(
        typed({ tags: Array.from({ length: 21 }, (_, index) => `t${index}`) }),
      ).tags,
    ).toBe("At most 20 tags.");
    expect(
      problems(typed({ searchKeywords: ["a"] })).searchKeywords,
    ).toBeDefined();
    expect(problems(typed({ searchKeywords: ["Reis", "chawal"] }))).toEqual({});
    expect(
      problems(typed({ slug: { en: "Basmati Rice", de: "" } }))["slug.en"],
    ).toBeDefined();
    expect(problems(typed({ slug: { en: "basmati-rice", de: "" } }))).toEqual(
      {},
    );
    expect(
      problems(typed({ food: { ...typed().food, origin: "x".repeat(121) } }))[
        "food.origin"
      ],
    ).toBeDefined();
  });
});

describe("what POST /products gets", () => {
  it("sends the required fields with the pack sizes and leaves out what is empty", () => {
    expect(toProductInput(typed())).toEqual({
      name: { en: "Toor Dal", de: null },
      categoryId: CATEGORY,
      variants: [{ packSize: { value: 1, unit: "kg" }, regularPrice: 449 }],
      vatRate: 700,
      status: "draft",
      isAvailable: true,
      isFeatured: false,
      sortOrder: 0,
      minOrderQuantity: 1,
      storageType: "ambient",
    });
  });

  it("sends money as integer cents and the VAT rate in hundredths of a percent", () => {
    const input = toProductInput(
      typed({
        variants: [
          row({
            regularPrice: "19,99",
            saleMode: "price",
            salePrice: "17.90",
          }),
        ],
        vatRate: "10,7",
      }),
    );
    const first = input.variants[0]!;
    expect(first.regularPrice).toBe(1999);
    expect(first.salePrice).toBe(1790);
    expect(input.vatRate).toBe(1070);
    expect(Number.isInteger(first.regularPrice)).toBe(true);
    expect("discountPercent" in first).toBe(false);
  });

  it("sends the opening stock, the threshold and the switch of each pack size where the API takes them", () => {
    const [first] = toProductInput(
      typedRow({ stockQuantity: "25", lowStockThreshold: "10" }),
    ).variants;
    expect(first?.stockQuantity).toBe(25);
    expect(first?.lowStockThreshold).toBe(10);
    // The default of 0 is the API's default: it is left out, as is `true`.
    const [plain] = toProductInput(typed()).variants;
    expect(plain?.stockQuantity).toBeUndefined();
    expect(plain?.lowStockThreshold).toBeUndefined();
    expect("isEnabled" in plain!).toBe(false);
    const [off] = toProductInput(typedRow({ isEnabled: false })).variants;
    expect(off?.isEnabled).toBe(false);
  });

  it("sends a discount as a percentage and then no sale price", () => {
    const [first] = toProductInput(
      typedRow({ saleMode: "percent", discountPercent: "20", salePrice: "3" }),
    ).variants;
    expect(first?.discountPercent).toBe(20);
    expect("salePrice" in first!).toBe(false);
  });

  it("sends every pack size that is not marked for removal, in the order of the table", () => {
    const input = toProductInput(
      typed({
        variants: [
          row({ packSize: { value: "1", unit: "kg" }, sku: "rf-1" }),
          row({ packSize: { value: "2", unit: "kg" }, removed: true }),
          row({ packSize: { value: "5", unit: "kg" }, regularPrice: "19.99" }),
        ],
      }),
    );
    expect(input.variants).toEqual([
      { sku: "RF-1", packSize: { value: 1, unit: "kg" }, regularPrice: 449 },
      { packSize: { value: 5, unit: "kg" }, regularPrice: 1999 },
    ]);
  });

  it("sends everything that was filled in", () => {
    const input = toProductInput(
      typed({
        variants: [row({ sku: "rf-900", gtin: "12345678" })],
        subtitle: { en: "Split pigeon peas", de: "" },
        brand: " TRS ",
        highlights: { en: "Rich in protein\nCooks fast", de: "Proteinreich" },
        maxOrderQuantity: "10",
        storageType: "chilled",
        food: {
          ...typed().food,
          ingredients: { en: "Pigeon peas", de: "Straucherbsen" },
          origin: "India",
        },
        tags: ["vegan"],
        searchKeywords: ["Arhar"],
        seo: {
          title: { en: "Toor Dal", de: "" },
          description: { en: "", de: "" },
        },
        slug: { en: "toor-dal", de: "" },
      }),
    );
    expect(input).toMatchObject({
      variants: [{ sku: "RF-900", gtin: "12345678" }],
      subtitle: { en: "Split pigeon peas", de: null },
      brand: "TRS",
      highlights: {
        en: ["Rich in protein", "Cooks fast"],
        de: ["Proteinreich"],
      },
      maxOrderQuantity: 10,
      storageType: "chilled",
      food: {
        ingredients: { en: "Pigeon peas", de: "Straucherbsen" },
        origin: "India",
      },
      tags: ["vegan"],
      searchKeywords: ["Arhar"],
      seo: { title: { en: "Toor Dal", de: null } },
      slug: { en: "toor-dal" },
    });
    expect("uses" in input).toBe(false);
    expect("description" in (input.seo ?? {})).toBe(false);
    expect("allergens" in (input.food ?? {})).toBe(false);
  });
});

describe("what PATCH /products/{id} gets: only the product fields that changed", () => {
  const before = product();
  const form = () => productDefaults(before);

  it("sends nothing when nothing changed", () => {
    expect(toProductPatch(form(), before)).toEqual({});
  });

  it("does not count another way of writing the same value as a change", () => {
    expect(toProductPatch({ ...form(), vatRate: "7,0" }, before)).toEqual({});
  });

  it("sends a translated field whole, with the language that was not touched", () => {
    expect(
      toProductPatch(
        { ...form(), name: { en: "Basmati Rice", de: "Basmatireis" } },
        before,
      ),
    ).toEqual({ name: { en: "Basmati Rice", de: "Basmatireis" } });
    // Emptying the German text clears it.
    expect(
      toProductPatch(
        { ...form(), description: { en: "Aged basmati.", de: "" } },
        before,
      ),
    ).toEqual({ description: { en: "Aged basmati.", de: null } });
    expect(
      toProductPatch(
        { ...form(), shortDescription: { en: "", de: "" } },
        before,
      ),
    ).toEqual({ shortDescription: { en: null, de: null } });
  });

  it("sends a list whole, because the API replaces it", () => {
    expect(
      toProductPatch(
        {
          ...form(),
          highlights: { en: "Aged 2 years\nLong grain\nFragrant", de: "" },
        },
        before,
      ),
    ).toEqual({
      highlights: { en: ["Aged 2 years", "Long grain", "Fragrant"], de: [] },
    });
    expect(toProductPatch({ ...form(), tags: [] }, before)).toEqual({
      tags: [],
    });
    expect(
      toProductPatch({ ...form(), searchKeywords: ["Reis", "chawal"] }, before),
    ).toEqual({ searchKeywords: ["Reis", "chawal"] });
  });

  it("sends the whole food information when one part of it changed", () => {
    const patch = toProductPatch(
      { ...form(), food: { ...form().food, origin: "Punjab, India" } },
      before,
    );
    expect(patch).toEqual({
      food: {
        ingredients: { en: "Basmati rice", de: null },
        allergens: { en: null, de: null },
        nutrition: { en: null, de: null },
        storageInstructions: { en: null, de: null },
        origin: "Punjab, India",
      },
    });
    // The ingredients nobody touched are still part of it: leaving them out would clear them.
    expect(patch.food?.ingredients).toEqual({ en: "Basmati rice", de: null });
  });

  it("clears what was emptied with the value that clears it", () => {
    expect(toProductPatch({ ...form(), brand: " " }, before)).toEqual({
      brand: null,
    });
    const limited = product({ maxOrderQuantity: 4 });
    expect(
      toProductPatch(
        { ...productDefaults(limited), maxOrderQuantity: "" },
        limited,
      ),
    ).toEqual({ maxOrderQuantity: null });
  });

  it("sends status, availability, the VAT rate and the numbers when they change", () => {
    expect(
      toProductPatch(
        {
          ...form(),
          status: "archived",
          isAvailable: false,
          isFeatured: true,
          sortOrder: "12",
          minOrderQuantity: "2",
          vatRate: "19",
          storageType: "frozen",
          categoryId: "66f000000000000000000002",
        },
        before,
      ),
    ).toEqual({
      status: "archived",
      isAvailable: false,
      isFeatured: true,
      sortOrder: 12,
      minOrderQuantity: 2,
      vatRate: 1900,
      storageType: "frozen",
      categoryId: "66f000000000000000000002",
    });
  });

  it("sends an address only with the languages that are filled", () => {
    expect(
      toProductPatch({ ...form(), slug: { en: "basmati", de: "" } }, before),
    ).toEqual({ slug: { en: "basmati" } });
  });

  it("never carries a pack size: the rows have endpoints of their own", () => {
    const changed = {
      ...form(),
      variants: [{ ...form().variants[0]!, regularPrice: "26.50" }],
    };
    expect(toProductPatch(changed, before)).toEqual({});
  });

  it("works on a product whose optional parts are all empty", () => {
    const bare = product({
      brand: null,
      shortDescription: null,
      description: null,
      highlights: null,
      uses: null,
      food: null,
      seo: null,
      storageType: null,
      tags: [],
      searchKeywords: [],
    });
    expect(toProductPatch(productDefaults(bare), bare)).toEqual({});
    expect(
      toProductPatch(
        { ...productDefaults(bare), storageType: "chilled" },
        bare,
      ),
    ).toEqual({ storageType: "chilled" });
  });
});

describe("what PATCH …/variants/{variantId} gets: only what changed on the pack size", () => {
  const before = variant();
  const form = () => variantRow(before);

  it("sends nothing when nothing changed, whatever the way of writing", () => {
    expect(toVariantPatch(form(), before)).toEqual({});
    expect(
      toVariantPatch(
        {
          ...form(),
          regularPrice: "24,99",
          salePrice: "19,99",
          sku: "rf-00042",
        },
        before,
      ),
    ).toEqual({});
  });

  it("sends a changed price alone", () => {
    expect(
      toVariantPatch({ ...form(), regularPrice: "26.50" }, before),
    ).toEqual({ regularPrice: 2650 });
  });

  it("sends the pack size as value and unit together", () => {
    expect(
      toVariantPatch(
        { ...form(), packSize: { value: "10", unit: "kg" } },
        before,
      ),
    ).toEqual({ packSize: { value: 10, unit: "kg" } });
  });

  it("sends the article number upper-cased, the barcode cleared with null", () => {
    expect(toVariantPatch({ ...form(), sku: "rf-5kg" }, before)).toEqual({
      sku: "RF-5KG",
    });
    expect(toVariantPatch({ ...form(), gtin: "" }, before)).toEqual({
      gtin: null,
    });
  });

  it("sends the switch and the threshold when they change, null when the threshold is removed, never the count", () => {
    expect(toVariantPatch({ ...form(), isEnabled: false }, before)).toEqual({
      isEnabled: false,
    });
    expect(
      toVariantPatch({ ...form(), lowStockThreshold: "8" }, before),
    ).toEqual({ lowStockThreshold: 8 });
    expect(
      toVariantPatch({ ...variantRow(SMALL), lowStockThreshold: "" }, SMALL),
    ).toEqual({ lowStockThreshold: null });
    expect(toVariantPatch({ ...form(), stockQuantity: "99" }, before)).toEqual(
      {},
    );
  });

  describe("the sale", () => {
    it("keeps the sale by sending neither a price nor a percentage", () => {
      expect(
        toVariantPatch({ ...form(), regularPrice: "27.00" }, before),
      ).toEqual({ regularPrice: 2700 });
    });

    it("ends the sale with salePrice: null", () => {
      expect(toVariantPatch({ ...form(), saleMode: "none" }, before)).toEqual({
        salePrice: null,
      });
    });

    it("says nothing about a sale that never was", () => {
      expect(toVariantPatch(variantRow(SMALL), SMALL)).toEqual({});
    });

    it("sends a new sale price", () => {
      expect(toVariantPatch({ ...form(), salePrice: "17.49" }, before)).toEqual(
        {
          salePrice: 1749,
        },
      );
    });

    it("sends a percentage instead of the price, never both", () => {
      const patch = toVariantPatch(
        { ...form(), saleMode: "percent", discountPercent: "25" },
        before,
      );
      expect(patch).toEqual({ discountPercent: 25 });
      expect("salePrice" in patch).toBe(false);
    });

    it("starts a sale on a pack size that had none", () => {
      expect(
        toVariantPatch(
          { ...variantRow(SMALL), saleMode: "price", salePrice: "4.99" },
          SMALL,
        ),
      ).toEqual({ salePrice: 499 });
    });
  });
});

describe("the plan of saving an existing product", () => {
  const before = product({ variants: [SMALL, variant()] });
  const form = () => productDefaults(before);

  it("is empty when nothing changed", () => {
    expect(planIsEmpty(planOf(form(), before))).toBe(true);
  });

  it("names the product patch, the pack sizes to change, to remove and to add", () => {
    const values: ProductFormValues = {
      ...form(),
      brand: "Daawat",
      variants: [
        { ...form().variants[0]!, regularPrice: "5.99" },
        { ...form().variants[1]!, removed: true },
        row({ packSize: { value: "10", unit: "kg" }, regularPrice: "45.99" }),
      ],
    };
    const plan = planOf(values, before);
    expect(plan.patch).toEqual({ brand: "Daawat" });
    expect(plan.change).toEqual([
      { variant: SMALL, patch: { regularPrice: 599 } },
    ]);
    expect(plan.remove).toEqual([variant()]);
    expect(plan.add).toEqual([
      {
        row: 2,
        label: "10 kg",
        input: { packSize: { value: 10, unit: "kg" }, regularPrice: 4599 },
      },
    ]);
    expect(planIsEmpty(plan)).toBe(false);
  });

  it("leaves out a new row that was removed again", () => {
    const values = {
      ...form(),
      variants: [...form().variants, row({ removed: true })],
    };
    expect(planIsEmpty(planOf(values, before))).toBe(true);
  });
});

describe("the sale as typed", () => {
  it("is exactly one of price and percentage", () => {
    const values = {
      regularPrice: "24.99",
      salePrice: "19.99",
      discountPercent: "20",
    };
    expect(saleOf({ ...values, saleMode: "price" })).toEqual({
      salePrice: 1999,
    });
    expect(saleOf({ ...values, saleMode: "percent" })).toEqual({
      discountPercent: 20,
    });
    expect(saleOf({ ...values, saleMode: "none" })).toEqual({});
    expect(saleOf({ ...values, saleMode: "none" }, 1999)).toEqual({
      salePrice: null,
    });
    expect(saleOf({ ...values, saleMode: "price" }, 1999)).toEqual({});
  });

  it("previews what customers will pay", () => {
    expect(
      salePreview({
        regularPrice: "24.99",
        saleMode: "price",
        salePrice: "19.99",
        discountPercent: "",
      }),
    ).toEqual({ price: 1999, percent: 20 });
    expect(
      salePreview({
        regularPrice: "24.99",
        saleMode: "percent",
        salePrice: "",
        discountPercent: "20",
      }),
    ).toEqual({ price: 1999, percent: 20 });
    expect(
      salePreview({
        regularPrice: "24.99",
        saleMode: "price",
        salePrice: "30",
        discountPercent: "",
      }),
    ).toBeNull();
    expect(
      salePreview({
        regularPrice: "",
        saleMode: "percent",
        salePrice: "",
        discountPercent: "20",
      }),
    ).toBeNull();
    expect(
      salePreview({
        regularPrice: "24.99",
        saleMode: "none",
        salePrice: "19.99",
        discountPercent: "",
      }),
    ).toBeNull();
  });
});

describe("refusals of the API that belong to a field", () => {
  const error = (code: string, status = 400, details?: unknown) =>
    new ApiError({ status, code, message: "refused", details });

  it("puts each documented code at its field", () => {
    expect(productErrorField(error("PRODUCT_PRICE_INVALID"), "price")).toBe(
      "salePrice",
    );
    expect(productErrorField(error("PRODUCT_PRICE_INVALID"), "percent")).toBe(
      "discountPercent",
    );
    expect(productErrorField(error("PRODUCT_PRICE_INVALID"), "none")).toBe(
      "regularPrice",
    );
    expect(productErrorField(error("PRODUCT_QUANTITY_INVALID"), "none")).toBe(
      "maxOrderQuantity",
    );
    expect(productErrorField(error("PRODUCT_SKU_TAKEN", 409), "none")).toBe(
      "sku",
    );
    expect(productErrorField(error("PRODUCT_VARIANT_INVALID"), "none")).toBe(
      "packSize.value",
    );
    expect(productErrorField(error("PRODUCT_SLUG_TAKEN", 409), "none")).toBe(
      "slug.en",
    );
    expect(productErrorField(error("CATEGORY_NOT_FOUND", 404), "none")).toBe(
      "categoryId",
    );
  });

  it("leaves everything else to the notice above the buttons", () => {
    expect(productErrorField(error("INTERNAL_ERROR", 500), "none")).toBeNull();
    expect(productErrorField(new Error("boom"), "none")).toBeNull();
  });

  it("finds the row a refusal of a new product is about", () => {
    const rows = [
      row({ packSize: { value: "1", unit: "kg" }, sku: "rf-1" }),
      row({ packSize: { value: "5", unit: "kg" }, regularPrice: "19.99" }),
    ];
    expect(variantErrorRow(error("PRODUCT_SKU_TAKEN", 409), [rows[0]!])).toBe(
      0,
    );
    expect(
      variantErrorRow(
        error("PRODUCT_VARIANT_INVALID", 400, { sku: "RF-1" }),
        rows,
      ),
    ).toBe(0);
    expect(
      variantErrorRow(
        error("PRODUCT_VARIANT_INVALID", 400, { baseQuantity: 5000 }),
        rows,
      ),
    ).toBe(1);
    expect(
      variantErrorRow(
        error("PRODUCT_PRICE_INVALID", 400, { regularPrice: 1999 }),
        rows,
      ),
    ).toBe(1);
    expect(variantErrorRow(error("PRODUCT_SKU_TAKEN", 409), rows)).toBeNull();
  });

  it("shows the API's problems with list entries at the list, and with a pack size at its row", () => {
    expect(PRODUCT_FIELD_ALIASES["tags.3"]).toBe("tags");
    expect(PRODUCT_FIELD_ALIASES["highlights.en.0"]).toBe("highlights.en");
    expect(PRODUCT_FIELD_ALIASES["searchKeywords.29"]).toBe("searchKeywords");
    expect(variantFieldAliases(2)["packSize.value"]).toBe(
      "variants.2.packSize.value",
    );
    expect(variantFieldAliases(2)["variants.2.sku"]).toBe("variants.2.sku");
  });
});
