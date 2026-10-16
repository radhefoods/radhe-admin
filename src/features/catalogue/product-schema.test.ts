import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/errors";
import type { PriceView, ProductDetail } from "@/lib/api/types";
import {
  PRODUCT_FIELD_ALIASES,
  linesOf,
  packDefaults,
  packSchema,
  parsePackValue,
  productDefaults,
  productErrorField,
  productSchema,
  saleOf,
  salePreview,
  toDuplicateInput,
  toProductInput,
  toProductPatch,
  toTag,
  type ProductFormValues,
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

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    id: "66f300000000000000000042",
    sku: "RF-00042",
    name: { en: "Basmati Rice", de: "Basmati Reis" },
    slug: { en: "basmati-rice-5-kg", de: "basmati-reis-5-kg" },
    brand: "India Gate",
    category: { id: CATEGORY, name: { en: "Rice", de: "Reis" } },
    packSize: { value: 5, unit: "kg", label: "5 kg" },
    pricing: pricing(2499, 1999),
    status: "active",
    isAvailable: true,
    isFeatured: false,
    sortOrder: 0,
    stock: { quantity: 40, lowStockThreshold: null, isLow: false },
    variantGroupId: null,
    isDefaultVariant: true,
    packSizeCount: 1,
    imageCount: 0,
    image: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    gtin: "8901234567890",
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
    packSizes: [],
    publishedAt: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

/** A new product as the form holds it once the required fields are typed. */
function typed(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    ...productDefaults(),
    name: { en: "Toor Dal", de: "" },
    categoryId: CATEGORY,
    packSize: { value: "1", unit: "kg" },
    regularPrice: "4.49",
    vatRate: "7",
    ...overrides,
  };
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

  it("requires the English name, a category, a pack size, a price and the VAT rate", () => {
    const missing = problems(productDefaults());
    expect(missing["name.en"]).toBe("The English name is required.");
    expect(missing.categoryId).toBe("Choose a category.");
    expect(missing["packSize.value"]).toBe("Enter the pack size.");
    expect(missing.regularPrice).toBe("Enter an amount.");
    expect(missing.vatRate).toBeDefined();
  });

  it("keeps the article number to the API's pattern, and lets a new product leave it empty", () => {
    expect(problems(typed({ sku: "" })).sku).toBeUndefined();
    expect(problems(typed({ sku: "rf-00042" })).sku).toBeUndefined();
    expect(problems(typed({ sku: "A" })).sku).toBeDefined();
    expect(problems(typed({ sku: "-RF1" })).sku).toBeDefined();
    expect(problems(typed({ sku: "RF 42" })).sku).toBeDefined();
    expect(problems(typed({ sku: "A".repeat(41) })).sku).toBeDefined();
  });

  it("wants an article number and an address for a product that exists", () => {
    const existing = productDefaults(product());
    expect(problems(existing, false)).toEqual({});
    expect(problems({ ...existing, sku: " " }, false).sku).toBeDefined();
    expect(
      problems({ ...existing, slug: { en: "", de: "x" } }, false)["slug.en"],
    ).toBeDefined();
  });

  it("takes a barcode of 8, 12, 13 or 14 digits", () => {
    for (const gtin of [
      "12345678",
      "123456789012",
      "1234567890123",
      "12345678901234",
      "",
    ]) {
      expect(problems(typed({ gtin })).gtin).toBeUndefined();
    }
    for (const gtin of [
      "1234567",
      "123456789",
      "12345678901",
      "abc45678",
      "123456789012345",
    ]) {
      expect(problems(typed({ gtin })).gtin).toBeDefined();
    }
  });

  it("keeps the pack size between 0.001 and 1,000,000", () => {
    const pack = (value: string) =>
      problems(typed({ packSize: { value, unit: "g" } }))["packSize.value"];
    expect(pack("0.001")).toBeUndefined();
    expect(pack("1000000")).toBeUndefined();
    expect(pack("0")).toBeDefined();
    expect(pack("1000001")).toBeDefined();
    expect(pack("0.0001")).toBeDefined();
  });

  it("keeps the price between one cent and 100,000 euros", () => {
    expect(
      problems(typed({ regularPrice: "0.01" })).regularPrice,
    ).toBeUndefined();
    expect(
      problems(typed({ regularPrice: "100000" })).regularPrice,
    ).toBeUndefined();
    expect(problems(typed({ regularPrice: "0" })).regularPrice).toBeDefined();
    expect(
      problems(typed({ regularPrice: "100000.01" })).regularPrice,
    ).toBeDefined();
    expect(
      problems(typed({ regularPrice: "4.9999" })).regularPrice,
    ).toBeDefined();
    expect(
      problems(typed({ regularPrice: "four" })).regularPrice,
    ).toBeDefined();
  });

  it("wants the sale price below the regular price", () => {
    const sale = (salePrice: string) =>
      problems(typed({ regularPrice: "24.99", saleMode: "price", salePrice }))
        .salePrice;
    expect(sale("19.99")).toBeUndefined();
    expect(sale("24.99")).toMatch(/below the regular price \(€24\.99\)/);
    expect(sale("30")).toBeDefined();
    expect(sale("")).toMatch(/Enter the sale price/);
    expect(sale("0")).toBeDefined();
  });

  it("wants a discount of 1 to 99 percent", () => {
    const percent = (discountPercent: string) =>
      problems(typed({ saleMode: "percent", discountPercent })).discountPercent;
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
        typed({ saleMode: "none", salePrice: "999", discountPercent: "abc" }),
      ),
    ).toEqual({});
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
    expect(
      problems(typed({ slug: { en: "basmati-rice-5-kg", de: "" } })),
    ).toEqual({});
    expect(
      problems(typed({ food: { ...typed().food, origin: "x".repeat(121) } }))[
        "food.origin"
      ],
    ).toBeDefined();
  });
});

describe("what POST /products gets", () => {
  it("sends the required fields and leaves out what is empty", () => {
    expect(toProductInput(typed())).toEqual({
      name: { en: "Toor Dal", de: null },
      categoryId: CATEGORY,
      packSize: { value: 1, unit: "kg" },
      regularPrice: 449,
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
        regularPrice: "19,99",
        saleMode: "price",
        salePrice: "17.90",
        vatRate: "10,7",
      }),
    );
    expect(input.regularPrice).toBe(1999);
    expect(input.salePrice).toBe(1790);
    expect(input.vatRate).toBe(1070);
    expect(Number.isInteger(input.regularPrice)).toBe(true);
    expect("discountPercent" in input).toBe(false);
  });

  it("sends a discount as a percentage and then no sale price", () => {
    const input = toProductInput(
      typed({ saleMode: "percent", discountPercent: "20", salePrice: "3.00" }),
    );
    expect(input.discountPercent).toBe(20);
    expect("salePrice" in input).toBe(false);
  });

  it("sends everything that was filled in", () => {
    const input = toProductInput(
      typed({
        sku: "rf-900",
        gtin: "12345678",
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
          title: { en: "Toor Dal 1 kg", de: "" },
          description: { en: "", de: "" },
        },
        slug: { en: "toor-dal-1-kg", de: "" },
      }),
    );
    expect(input).toMatchObject({
      sku: "RF-900",
      gtin: "12345678",
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
      seo: { title: { en: "Toor Dal 1 kg", de: null } },
      slug: { en: "toor-dal-1-kg" },
    });
    expect("uses" in input).toBe(false);
    expect("description" in (input.seo ?? {})).toBe(false);
    expect("allergens" in (input.food ?? {})).toBe(false);
  });
});

describe("what PATCH /products/{id} gets: only what changed", () => {
  const before = product();
  const form = () => productDefaults(before);

  it("sends nothing when nothing changed", () => {
    expect(toProductPatch(form(), before)).toEqual({});
  });

  it("does not count another way of writing the same value as a change", () => {
    expect(
      toProductPatch(
        {
          ...form(),
          regularPrice: "24,99",
          salePrice: "19,99",
          vatRate: "7,0",
          sku: "rf-00042",
        },
        before,
      ),
    ).toEqual({});
  });

  it("sends a changed price alone", () => {
    expect(
      toProductPatch({ ...form(), regularPrice: "26.50" }, before),
    ).toEqual({
      regularPrice: 2650,
    });
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
    expect(toProductPatch({ ...form(), gtin: "" }, before)).toEqual({
      gtin: null,
    });
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

  it("sends the pack size as value and unit together", () => {
    expect(
      toProductPatch(
        { ...form(), packSize: { value: "10", unit: "kg" } },
        before,
      ),
    ).toEqual({ packSize: { value: 10, unit: "kg" } });
  });

  it("sends status, availability and the numbers when they change", () => {
    expect(
      toProductPatch(
        {
          ...form(),
          status: "archived",
          isAvailable: false,
          isFeatured: true,
          sortOrder: "12",
          minOrderQuantity: "2",
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
      storageType: "frozen",
      categoryId: "66f000000000000000000002",
    });
  });

  it("sends an address only with the languages that are filled", () => {
    expect(
      toProductPatch(
        { ...form(), slug: { en: "basmati-5kg", de: "" } },
        before,
      ),
    ).toEqual({ slug: { en: "basmati-5kg" } });
  });

  describe("the sale", () => {
    it("keeps the sale by sending neither a price nor a percentage", () => {
      const patch = toProductPatch(
        { ...form(), regularPrice: "27.00" },
        before,
      );
      expect(patch).toEqual({ regularPrice: 2700 });
    });

    it("ends the sale with salePrice: null", () => {
      expect(toProductPatch({ ...form(), saleMode: "none" }, before)).toEqual({
        salePrice: null,
      });
    });

    it("says nothing about a sale that never was", () => {
      const plain = product({ pricing: pricing(2499) });
      expect(toProductPatch(productDefaults(plain), plain)).toEqual({});
    });

    it("sends a new sale price", () => {
      expect(toProductPatch({ ...form(), salePrice: "17.49" }, before)).toEqual(
        {
          salePrice: 1749,
        },
      );
    });

    it("sends a percentage instead of the price, never both", () => {
      const patch = toProductPatch(
        { ...form(), saleMode: "percent", discountPercent: "25" },
        before,
      );
      expect(patch).toEqual({ discountPercent: 25 });
      expect("salePrice" in patch).toBe(false);
    });

    it("starts a sale on a product that had none", () => {
      const plain = product({ pricing: pricing(2499) });
      expect(
        toProductPatch(
          { ...productDefaults(plain), saleMode: "price", salePrice: "19.99" },
          plain,
        ),
      ).toEqual({ salePrice: 1999 });
    });
  });

  it("works on a product whose optional parts are all empty", () => {
    const bare = product({
      gtin: null,
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
      pricing: pricing(499),
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

describe("a further pack size", () => {
  const source = product();

  it("starts with the unit of the product it copies and both ticks set", () => {
    expect(packDefaults(source)).toMatchObject({
      packSize: { value: "", unit: "kg" },
      asVariant: true,
      copyImages: true,
      saleMode: "none",
    });
  });

  it("wants a pack size and a price, and the same sale rules", () => {
    expect(packSchema.safeParse(packDefaults(source)).success).toBe(false);
    const ok = {
      ...packDefaults(source),
      packSize: { value: "10", unit: "kg" as const },
      regularPrice: "45.99",
    };
    expect(packSchema.safeParse(ok).success).toBe(true);
    expect(
      packSchema.safeParse({ ...ok, saleMode: "price", salePrice: "50" })
        .success,
    ).toBe(false);
  });

  it("becomes the body of POST /products/{id}/duplicate", () => {
    expect(
      toDuplicateInput({
        ...packDefaults(source),
        packSize: { value: "10", unit: "kg" },
        regularPrice: "45.99",
        saleMode: "percent",
        discountPercent: "10",
        sku: "rf-10kg",
        copyImages: false,
      }),
    ).toEqual({
      packSize: { value: 10, unit: "kg" },
      regularPrice: 4599,
      discountPercent: 10,
      sku: "RF-10KG",
      asVariant: true,
      copyImages: false,
    });
  });
});

describe("refusals of the API that belong to a field", () => {
  const error = (code: string, status = 400) =>
    new ApiError({ status, code, message: "refused" });

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
    expect(productErrorField(error("PRODUCT_SLUG_TAKEN", 409), "none")).toBe(
      "slug.en",
    );
    expect(productErrorField(error("CATEGORY_NOT_FOUND", 404), "none")).toBe(
      "categoryId",
    );
  });

  it("leaves everything else to the notice above the buttons", () => {
    expect(
      productErrorField(error("PRODUCT_VARIANT_INVALID"), "none"),
    ).toBeNull();
    expect(productErrorField(error("INTERNAL_ERROR", 500), "none")).toBeNull();
    expect(productErrorField(new Error("boom"), "none")).toBeNull();
  });

  it("shows the API's problems with list entries at the list", () => {
    expect(PRODUCT_FIELD_ALIASES["tags.3"]).toBe("tags");
    expect(PRODUCT_FIELD_ALIASES["highlights.en.0"]).toBe("highlights.en");
    expect(PRODUCT_FIELD_ALIASES["searchKeywords.29"]).toBe("searchKeywords");
  });
});
