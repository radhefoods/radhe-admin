import { describe, expect, it } from "vitest";
import type { WholesaleProductDetail, WholesaleSku } from "@/lib/api/types";
import {
  emptySkuRow,
  planOf,
  productDefaults,
  productSchema,
  rowProblems,
  skuRow,
  toProductInput,
  toProductPatch,
  toSkuInput,
  toSkuPatch,
  type ProductFormValues,
} from "./product-schema";

function sku(overrides: Partial<WholesaleSku> = {}): WholesaleSku {
  return {
    id: "671200000000000000000001",
    sku: "RFW-00001",
    packSize: { value: 1, unit: "kg", label: "1 kg" },
    unitsPerCarton: 20,
    carton: {
      units: 20,
      label: "20 × 1 kg",
      content: { value: 20, unit: "kg", label: "20 kg" },
    },
    isEnabled: true,
    stock: 40,
    createdAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

const BIG = sku({
  id: "671200000000000000000002",
  sku: "RFW-00002",
  packSize: { value: 5, unit: "kg", label: "5 kg" },
  unitsPerCarton: 4,
  carton: {
    units: 4,
    label: "4 × 5 kg",
    content: { value: 20, unit: "kg", label: "20 kg" },
  },
  stock: 10,
});

function product(
  overrides: Partial<WholesaleProductDetail> = {},
): WholesaleProductDetail {
  return {
    id: "671100000000000000000001",
    name: { en: "Daawat Basmati Rice", de: "Daawat Basmati Reis" },
    slug: { en: "daawat-basmati-rice", de: "daawat-basmati-reis" },
    brand: "Daawat",
    category: { id: "671000000000000000000001", name: { en: "Rice" } },
    categoryId: "671000000000000000000001",
    status: "active",
    isAvailable: true,
    sortOrder: 2,
    vatRate: 700,
    skus: [sku(), BIG],
    skuCount: 2,
    stock: { quantity: 50, shortSkus: 0 },
    imageCount: 0,
    image: null,
    images: [],
    retailProductId: null,
    subtitle: { en: "Aged two years", de: null },
    shortDescription: null,
    description: null,
    highlights: { en: ["Aged 2 years"], de: [] },
    storageType: "ambient",
    food: null,
    searchKeywords: ["Basmatireis"],
    publishedAt: "2026-10-01T09:00:00.000Z",
    createdAt: "2026-10-01T08:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
    ...overrides,
  };
}

const typed = (
  overrides: Partial<ProductFormValues> = {},
): ProductFormValues => ({
  ...productDefaults(),
  name: { en: "Toor Dal", de: "" },
  categoryId: "671000000000000000000003",
  vatRate: "7",
  skus: [
    {
      ...emptySkuRow("kg"),
      packSize: { value: "5", unit: "kg" },
      unitsPerCarton: "4",
      stock: "12",
    },
  ],
  ...overrides,
});

const problems = (values: ProductFormValues, creating = true) => {
  const result = productSchema({ creating }).safeParse(values);
  return result.success
    ? {}
    : Object.fromEntries(
        result.error.issues.map((issue) => [
          issue.path.join("."),
          issue.message,
        ]),
      );
};

describe("the rules of the SKU table", () => {
  it("wants a pack size, packs per carton from 1 to 1000, and at least one row", () => {
    const row = typed().skus[0]!;
    expect(
      problems(typed({ skus: [{ ...row, unitsPerCarton: "" }] })),
    ).toHaveProperty("skus.0.unitsPerCarton");
    expect(
      problems(typed({ skus: [{ ...row, unitsPerCarton: "1001" }] })),
    ).toHaveProperty("skus.0.unitsPerCarton");
    expect(
      problems(
        typed({ skus: [{ ...row, packSize: { value: "", unit: "kg" } }] }),
      ),
    ).toHaveProperty("skus.0.packSize.value");
    expect(problems(typed({ skus: [] }))["skus"]).toMatch(/at least one SKU/);
    expect(problems(typed())).toEqual({});
  });

  it("refuses a mixed unit family and the same pack with the same carton twice, but allows another carton", () => {
    const row = typed().skus[0]!;
    const litre = { ...row, packSize: { value: "1", unit: "l" as const } };
    expect(rowProblems([row, litre])).toEqual([
      expect.objectContaining({ index: 1, field: "packSize.unit" }),
    ]);
    expect(rowProblems([row, { ...row }])).toEqual([
      expect.objectContaining({ index: 1, field: "unitsPerCarton" }),
    ]);
    expect(rowProblems([row, { ...row, unitsPerCarton: "2" }])).toEqual([]);
    expect(rowProblems([row, { ...row, removed: true }])).toEqual([]);
  });
});

describe("what the API gets", () => {
  it("sends a new product with its SKUs, the VAT in hundredths, and only what was typed", () => {
    expect(toProductInput(typed())).toEqual({
      name: { en: "Toor Dal", de: null },
      categoryId: "671000000000000000000003",
      skus: [
        { packSize: { value: 5, unit: "kg" }, unitsPerCarton: 4, stock: 12 },
      ],
      vatRate: 700,
      status: "draft",
      isAvailable: true,
      storageType: "ambient",
    });
    const [plain] = toProductInput(
      typed({
        skus: [
          {
            ...typed().skus[0]!,
            stock: "0",
            sku: "rfw-toor-5",
            isEnabled: false,
          },
        ],
      }),
    ).skus;
    expect(plain).toEqual({
      sku: "RFW-TOOR-5",
      packSize: { value: 5, unit: "kg" },
      unitsPerCarton: 4,
      isEnabled: false,
    });
  });

  it("sends only the changed fields of a SKU, never its stock", () => {
    const row = skuRow(sku());
    expect(toSkuPatch(row, sku())).toEqual({});
    expect(toSkuPatch({ ...row, unitsPerCarton: "24" }, sku())).toEqual({
      unitsPerCarton: 24,
    });
    expect(
      toSkuPatch({ ...row, isEnabled: false, stock: "99" }, sku()),
    ).toEqual({
      isEnabled: false,
    });
    expect(toSkuInput(emptySkuRow("kg")).stock).toBeUndefined();
  });

  it("sends only the changed fields of the product, translated fields whole", () => {
    const before = product();
    const values = productDefaults(before);
    expect(toProductPatch(values, before)).toEqual({});
    expect(
      toProductPatch(
        { ...values, subtitle: { en: "Aged two years", de: "Zwei Jahre" } },
        before,
      ),
    ).toEqual({ subtitle: { en: "Aged two years", de: "Zwei Jahre" } });
    expect(toProductPatch({ ...values, brand: "" }, before)).toEqual({
      brand: null,
    });
    expect(toProductPatch({ ...values, vatRate: "19" }, before)).toEqual({
      vatRate: 1900,
    });
  });

  it("plans the patch, the removals, the changes and the additions of a save", () => {
    const before = product();
    const values = productDefaults(before);
    const plan = planOf(
      {
        ...values,
        status: "archived",
        skus: [
          { ...values.skus[0]!, removed: true },
          { ...values.skus[1]!, unitsPerCarton: "2" },
          {
            ...emptySkuRow("kg"),
            packSize: { value: "20", unit: "kg" },
            unitsPerCarton: "1",
            stock: "3",
          },
        ],
      },
      before,
    );
    expect(plan.patch).toEqual({ status: "archived" });
    expect(plan.remove.map((entry) => entry.id)).toEqual([sku().id]);
    expect(plan.change).toEqual([{ sku: BIG, patch: { unitsPerCarton: 2 } }]);
    expect(plan.add).toEqual([
      {
        row: 2,
        label: "1 × 20 kg",
        input: {
          packSize: { value: 20, unit: "kg" },
          unitsPerCarton: 1,
          stock: 3,
        },
      },
    ]);
  });

  it("keeps the address and the article numbers of what exists", () => {
    const before = product();
    const values = productDefaults(before);
    expect(
      problems({ ...values, slug: { en: "", de: "" } }, false)["slug.en"],
    ).toMatch(/keeps its address/);
    expect(
      problems(
        { ...values, skus: [{ ...values.skus[0]!, sku: "" }, values.skus[1]!] },
        false,
      )["skus.0.sku"],
    ).toMatch(/keeps its article number/);
  });
});
