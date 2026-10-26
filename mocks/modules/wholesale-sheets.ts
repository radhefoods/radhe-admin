// Section 25 (doc/WHOLESALE_CATALOG.md section 7): CSV import and export of
// the wholesale catalogue, the flow of the retail import with the
// wholesale columns. A product row is one SKU; the `stock` column sets
// the cartons on hand through the ledger.

import { z } from "zod";
import type { PackUnit } from "../../src/lib/api/types/index.ts";
import type { Db } from "../db.ts";
import { baseQuantity } from "../domain.ts";
import { HttpError, fail, json, newId } from "../http.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";
import { Cells, summaryOf, textOf, unknownColumns } from "./catalog-sheets.ts";
import { PACK_UNITS, slugify } from "./catalog.ts";
import {
  applyWholesaleProductFields,
  applyWholesaleSkuPatch,
  assertSkuSet,
  createWholesaleProduct,
  createWholesaleSku,
  nextWholesalePosition,
  orderedWholesaleCategories,
  recordWholesaleMovement,
  sortedSkus,
  wholesaleSkuByCode,
  type WholesaleCategoryRecord,
  type WholesaleProductRecord,
  type WholesaleSkuRecord,
} from "./wholesale.ts";

const MAX_ROWS = 2000;

export const CATEGORY_COLUMNS = [
  "slug_en",
  "slug_de",
  "name_en",
  "name_de",
  "description_en",
  "description_de",
  "sort_order",
  "is_visible",
] as const;

export const PRODUCT_COLUMNS = [
  "sku",
  "name_en",
  "name_de",
  "slug_en",
  "slug_de",
  "subtitle_en",
  "subtitle_de",
  "short_description_en",
  "short_description_de",
  "description_en",
  "description_de",
  "highlights_en",
  "highlights_de",
  "brand",
  "category_slug",
  "pack_value",
  "pack_unit",
  "units_per_carton",
  "sku_enabled",
  "stock",
  "vat_rate",
  "status",
  "is_available",
  "sort_order",
  "storage_type",
  "ingredients_en",
  "ingredients_de",
  "allergens_en",
  "allergens_de",
  "nutrition_en",
  "nutrition_de",
  "storage_instructions_en",
  "storage_instructions_de",
  "origin",
  "manufacturer",
  "search_keywords",
] as const;

type Row = Record<string, string | number | boolean | null>;
type Action = "create" | "update" | "skip" | "unchanged" | "error";
type Existing = "skip" | "update";

interface RowResult {
  row: number;
  key: string;
  name: string;
  action: Action;
  id: string | null;
  /** Product rows: the SKU the row matched or created. */
  skuId?: string | null;
  changes: string[];
  problems: string[];
}

const zRow = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);
const importBody = z.strictObject({
  categories: z.array(zRow).max(MAX_ROWS).optional(),
  products: z.array(zRow).max(MAX_ROWS).optional(),
  existing: z.enum(["skip", "update"]).optional(),
});

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// --- Categories ------------------------------------------------------------------

interface CategoryPlan {
  result: RowResult;
  existing: WholesaleCategoryRecord | null;
  input: {
    name?: { en?: string; de?: string };
    slugDe?: string;
    description?: { en?: string; de?: string };
    sortOrder?: number;
    isVisible?: boolean;
  };
}

function planCategories(
  db: Db,
  rows: Row[],
  existing: Existing,
): CategoryPlan[] {
  const plans: CategoryPlan[] = [];
  const keys = new Map<string, number>();
  rows.forEach((row, index) => {
    const cells = new Cells(row);
    const slugEn = cells.slug("slug_en");
    const name = cells.translated("name", 160);
    const key = slugEn ?? (name?.en ? slugify(name.en) : "");
    const record = key
      ? (db.wholesaleCategories.find((entry) => entry.slug.en === key) ?? null)
      : null;
    const plan: CategoryPlan = {
      result: {
        row: index + 1,
        key,
        name: name?.en ?? record?.name.en ?? "",
        action: record ? (existing === "update" ? "update" : "skip") : "create",
        id: record?.id ?? null,
        changes: [],
        problems: cells.problems,
      },
      existing: record,
      input: {
        name,
        slugDe: cells.slug("slug_de"),
        description: cells.translated("description", 20000),
        sortOrder: cells.int("sort_order", 0, 100000),
        isVisible: cells.bool("is_visible"),
      },
    };
    if (!key) plan.result.problems.push("name_en or slug_en is required");
    else if (keys.has(key))
      plan.result.problems.push(
        `${key}: the same category as row ${keys.get(key)}`,
      );
    else keys.set(key, index + 1);
    if (!record && !name?.en)
      plan.result.problems.push("name_en is required for a new category");
    if (record && plan.result.action === "update") {
      const { input } = plan;
      if (
        input.name &&
        !same(
          {
            en: input.name.en ?? record.name.en,
            de: input.name.de ?? record.name.de ?? undefined,
          },
          { en: record.name.en, de: record.name.de ?? undefined },
        )
      )
        plan.result.changes.push("name");
      if (input.slugDe !== undefined && input.slugDe !== record.slug.de)
        plan.result.changes.push("slug");
      if (
        input.description &&
        !same(input.description, {
          en: record.description?.en ?? undefined,
          de: record.description?.de ?? undefined,
        })
      )
        plan.result.changes.push("description");
      if (input.sortOrder !== undefined && input.sortOrder !== record.sortOrder)
        plan.result.changes.push("sortOrder");
      if (input.isVisible !== undefined && input.isVisible !== record.isVisible)
        plan.result.changes.push("isVisible");
      if (plan.result.changes.length === 0) plan.result.action = "unchanged";
    }
    if (plan.result.problems.length > 0) plan.result.action = "error";
    plans.push(plan);
  });
  return plans;
}

function writeCategory(db: Db, plan: CategoryPlan, now: number): void {
  const { input } = plan;
  if (plan.existing) {
    const record = plan.existing;
    if (input.name)
      record.name = {
        en: input.name.en ?? record.name.en,
        de: input.name.de ?? record.name.de,
      };
    if (input.slugDe !== undefined)
      record.slug = { ...record.slug, de: input.slugDe };
    if (input.description)
      record.description = {
        ...(record.description ?? {}),
        ...input.description,
      };
    if (input.sortOrder !== undefined) record.sortOrder = input.sortOrder;
    if (input.isVisible !== undefined) record.isVisible = input.isVisible;
    record.updatedAt = iso(now);
    plan.result.id = record.id;
    return;
  }
  const slug = {
    en: plan.result.key,
    de:
      input.slugDe ??
      (input.name?.de ? slugify(input.name.de) : plan.result.key),
  };
  if (
    db.wholesaleCategories.some(
      (entry) => entry.slug.en === slug.en || entry.slug.de === slug.de,
    )
  ) {
    throw fail(
      409,
      "WHOLESALE_CATEGORY_SLUG_TAKEN",
      "Another wholesale category uses this slug.",
    );
  }
  const record: WholesaleCategoryRecord = {
    id: newId(now + plan.result.row),
    name: { en: input.name!.en!, de: input.name?.de ?? null },
    slug,
    description: input.description ?? null,
    sortOrder:
      input.sortOrder ??
      (db.wholesaleCategories.length === 0
        ? 0
        : Math.max(...db.wholesaleCategories.map((entry) => entry.sortOrder)) +
          1),
    isVisible: input.isVisible ?? true,
    image: null,
    createdAt: iso(now),
    updatedAt: iso(now),
  };
  db.wholesaleCategories.push(record);
  plan.result.id = record.id;
}

// --- Products ----------------------------------------------------------------------

type Pack = { value: number; unit: PackUnit };

interface ProductPlan {
  result: RowResult;
  product: WholesaleProductRecord | null;
  sku: WholesaleSkuRecord | null;
  productKey: string;
  first: boolean;
  code: string | undefined;
  pack: Pack | undefined;
  unitsPerCarton: number | undefined;
  categorySlug: string | undefined;
  stock: number | undefined;
  input: {
    name?: { en?: string; de?: string };
    slugEn?: string;
    slugDe?: string;
    subtitle?: { en?: string; de?: string };
    shortDescription?: { en?: string; de?: string };
    description?: { en?: string; de?: string };
    highlights?: { en?: string[]; de?: string[] };
    brand?: string;
    isEnabled?: boolean;
    vatRate?: number;
    status?: "draft" | "active" | "archived";
    isAvailable?: boolean;
    sortOrder?: number;
    storageType?: "ambient" | "chilled" | "frozen";
    food: Record<string, unknown>;
    searchKeywords?: string[];
  };
}

function skuByPack(
  product: WholesaleProductRecord,
  pack: Pack,
  units: number | undefined,
): WholesaleSkuRecord | undefined {
  const matches = product.skus.filter(
    (sku) => baseQuantity(sku.packSize) === baseQuantity(pack),
  );
  if (units !== undefined)
    return matches.find((sku) => sku.unitsPerCarton === units);
  return matches.length === 1 ? matches[0] : undefined;
}

function planProducts(
  db: Db,
  rows: Row[],
  categoryRows: Row[],
  existing: Existing,
): ProductPlan[] {
  const plans: ProductPlan[] = [];
  const categoryKeys = categoryRows.map(
    (row) => textOf(row, "slug_en") || slugify(textOf(row, "name_en")),
  );
  const firstRows = new Map<string, number>();
  rows.forEach((row, index) => {
    const cells = new Cells(row);
    const codeText = textOf(row, "sku").toUpperCase();
    let code: string | undefined;
    if (codeText) {
      if (/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(codeText)) code = codeText;
      else
        cells.problems.push(
          `sku: "${codeText}" must have 2 to 40 characters: letters, digits, ".", "_" or "-"`,
        );
    }
    const name = cells.translated("name", 160);
    const slugEn = cells.slug("slug_en");
    const packValue = cells.decimal("pack_value", 3);
    const packUnit = cells.oneOf("pack_unit", PACK_UNITS);
    const pack: Pack | undefined =
      packValue !== undefined && packUnit
        ? { value: packValue, unit: packUnit }
        : undefined;
    const unitsPerCarton = cells.int("units_per_carton", 1, 1000);
    const byCode = code ? wholesaleSkuByCode(db, code) : undefined;
    let productKey = slugEn ?? (name?.en ? slugify(name.en) : "");
    let product: WholesaleProductRecord | null = byCode?.product ?? null;
    if (!product && productKey)
      product =
        db.wholesaleProducts.find((entry) => entry.slug.en === productKey) ??
        null;
    if (!productKey && product) productKey = product.slug.en;
    let sku: WholesaleSkuRecord | null = byCode?.sku ?? null;
    if (!sku && product && !code) {
      sku = pack
        ? (skuByPack(product, pack, unitsPerCarton) ?? null)
        : product.skus.length === 1
          ? (product.skus[0] ?? null)
          : null;
    }
    const first = productKey ? !firstRows.has(productKey) : true;
    if (productKey && first) firstRows.set(productKey, index + 1);

    const categorySlug = cells.slug("category_slug");
    const vatPercent = cells.decimal("vat_rate", 2);
    if (vatPercent !== undefined && vatPercent > 100)
      cells.problems.push("vat_rate: a percentage up to 100");
    const food: Record<string, unknown> = {};
    for (const stem of [
      "ingredients",
      "allergens",
      "nutrition",
      "storage_instructions",
    ]) {
      const value = cells.translated(stem, 20000);
      if (value) food[stem] = value;
    }
    const origin = cells.text("origin", 120);
    const manufacturer = cells.text("manufacturer", 500);
    if (origin) food.origin = origin;
    if (manufacturer) food.manufacturer = manufacturer;
    const highlightsEn = cells.list("highlights_en", 20);
    const highlightsDe = cells.list("highlights_de", 20);

    const plan: ProductPlan = {
      result: {
        row: index + 1,
        key: code ?? sku?.sku ?? productKey,
        name: name?.en ?? product?.name.en ?? "",
        action: "create",
        id: product?.id ?? null,
        skuId: sku?.id ?? null,
        changes: [],
        problems: cells.problems,
      },
      product,
      sku,
      productKey,
      first,
      code,
      pack,
      unitsPerCarton,
      categorySlug,
      stock: cells.int("stock", -1_000_000, 1_000_000),
      input: {
        name,
        slugEn,
        slugDe: cells.slug("slug_de"),
        subtitle: cells.translated("subtitle", 300),
        shortDescription: cells.translated("short_description", 300),
        description: cells.translated("description", 20000),
        highlights:
          highlightsEn || highlightsDe
            ? {
                ...(highlightsEn ? { en: highlightsEn } : {}),
                ...(highlightsDe ? { de: highlightsDe } : {}),
              }
            : undefined,
        brand: cells.text("brand", 80),
        isEnabled: cells.bool("sku_enabled"),
        vatRate:
          vatPercent === undefined ? undefined : Math.round(vatPercent * 100),
        status: cells.oneOf("status", ["draft", "active", "archived"] as const),
        isAvailable: cells.bool("is_available"),
        sortOrder: cells.int("sort_order", 0, 1_000_000),
        storageType: cells.oneOf("storage_type", [
          "ambient",
          "chilled",
          "frozen",
        ] as const),
        food,
        searchKeywords: cells.list("search_keywords", 30),
      },
    };
    const problems = plan.result.problems;
    if (!productKey) problems.push("name_en or slug_en is required");
    if (
      categorySlug !== undefined &&
      !db.wholesaleCategories.some((entry) => entry.slug.en === categorySlug) &&
      !categoryKeys.includes(categorySlug)
    )
      problems.push(
        `category_slug: "${categorySlug}" is not a wholesale category`,
      );

    if (!product) {
      // A new product on its first row, or a further SKU of one made by an earlier row.
      if (first) {
        if (!name?.en) problems.push("name_en is required for a new product");
        if (!categorySlug)
          problems.push("category_slug is required for a new product");
        if (vatPercent === undefined)
          problems.push("vat_rate is required for a new product");
      } else if (!code) {
        problems.push("sku is required for a further SKU of a new product");
      }
      if (!pack)
        problems.push("pack_value and pack_unit are required for a new SKU");
      if (unitsPerCarton === undefined)
        problems.push("units_per_carton is required for a new SKU");
      plan.result.action = "create";
    } else if (!sku) {
      // A new SKU of a product that exists.
      if (!pack)
        problems.push("pack_value and pack_unit are required for a new SKU");
      if (unitsPerCarton === undefined)
        problems.push("units_per_carton is required for a new SKU");
      plan.result.action = existing === "update" ? "update" : "skip";
      if (plan.result.action === "update") plan.result.changes.push("sku");
    } else {
      plan.result.action = existing === "update" ? "update" : "skip";
      if (plan.result.action === "update") {
        const { input } = plan;
        const changes = plan.result.changes;
        if (first) {
          if (
            input.name &&
            !same(
              {
                en: input.name.en ?? product.name.en,
                de: input.name.de ?? product.name.de ?? undefined,
              },
              { en: product.name.en, de: product.name.de ?? undefined },
            )
          )
            changes.push("name");
          if (input.brand !== undefined && input.brand !== product.brand)
            changes.push("brand");
          if (input.vatRate !== undefined && input.vatRate !== product.vatRate)
            changes.push("vatRate");
          if (input.status !== undefined && input.status !== product.status)
            changes.push("status");
          if (
            input.isAvailable !== undefined &&
            input.isAvailable !== product.isAvailable
          )
            changes.push("isAvailable");
          if (
            input.sortOrder !== undefined &&
            input.sortOrder !== product.sortOrder
          )
            changes.push("sortOrder");
          if (
            input.storageType !== undefined &&
            input.storageType !== product.storageType
          )
            changes.push("storageType");
          if (categorySlug !== undefined) {
            const current = db.wholesaleCategories.find(
              (entry) => entry.id === product.categoryId,
            );
            if (current?.slug.en !== categorySlug) changes.push("categoryId");
          }
          for (const key of [
            "subtitle",
            "shortDescription",
            "description",
          ] as const) {
            const value = input[key];
            const current = product[key];
            if (
              value &&
              !same(value, {
                en: current?.en ?? undefined,
                de: current?.de ?? undefined,
              })
            )
              changes.push(key);
          }
          if (
            input.highlights &&
            !same(
              {
                en: input.highlights.en ?? product.highlights.en,
                de: input.highlights.de ?? product.highlights.de,
              },
              product.highlights,
            )
          )
            changes.push("highlights");
          if (Object.keys(input.food).length > 0) changes.push("food");
          if (
            input.searchKeywords &&
            !same(input.searchKeywords, product.searchKeywords)
          )
            changes.push("searchKeywords");
        }
        if (pack && baseQuantity(pack) !== baseQuantity(sku.packSize))
          changes.push("packSize");
        if (
          unitsPerCarton !== undefined &&
          unitsPerCarton !== sku.unitsPerCarton
        )
          changes.push("unitsPerCarton");
        if (input.isEnabled !== undefined && input.isEnabled !== sku.isEnabled)
          changes.push("isEnabled");
        if (plan.stock !== undefined && plan.stock !== sku.stock)
          changes.push("stock");
        if (changes.length === 0) plan.result.action = "unchanged";
      }
    }
    if (problems.length > 0) plan.result.action = "error";
    plans.push(plan);
  });
  return plans;
}

function foodOf(food: Record<string, unknown>) {
  if (Object.keys(food).length === 0) return undefined;
  return {
    ingredients: food.ingredients as { en?: string; de?: string } | undefined,
    allergens: food.allergens as { en?: string; de?: string } | undefined,
    nutrition: food.nutrition as { en?: string; de?: string } | undefined,
    storageInstructions: food.storage_instructions as
      { en?: string; de?: string } | undefined,
    origin: food.origin as string | undefined,
    manufacturer: food.manufacturer as string | undefined,
  };
}

function writeProduct(
  db: Db,
  plan: ProductPlan,
  createdByKey: Map<string, WholesaleProductRecord>,
  adminId: string,
  now: number,
): void {
  const { input } = plan;
  const categoryId =
    plan.categorySlug === undefined
      ? undefined
      : db.wholesaleCategories.find(
          (entry) => entry.slug.en === plan.categorySlug,
        )?.id;
  if (plan.categorySlug !== undefined && !categoryId)
    throw fail(
      404,
      "WHOLESALE_CATEGORY_NOT_FOUND",
      "The wholesale category was not found.",
    );
  const product = plan.product ?? createdByKey.get(plan.productKey) ?? null;
  const fields = {
    subtitle: input.subtitle,
    shortDescription: input.shortDescription,
    description: input.description,
    highlights: input.highlights,
    brand: input.brand,
    isAvailable: input.isAvailable,
    sortOrder: input.sortOrder,
    storageType: input.storageType,
    searchKeywords: input.searchKeywords,
    food: foodOf(input.food),
  };

  if (!product) {
    const created = createWholesaleProduct(
      db,
      {
        name: { en: input.name!.en!, de: input.name?.de ?? null },
        slug:
          input.slugEn || input.slugDe
            ? { en: input.slugEn, de: input.slugDe }
            : undefined,
        categoryId: categoryId!,
        skus: [
          {
            sku: plan.code,
            packSize: plan.pack!,
            unitsPerCarton: plan.unitsPerCarton!,
            isEnabled: input.isEnabled,
            stock: plan.stock,
          },
        ],
        vatRate: input.vatRate!,
        status: input.status,
        ...fields,
      },
      adminId,
      now + plan.result.row,
      {},
    );
    // The opening stock of an imported SKU is an import in the ledger.
    const movement = db.wholesaleStockMovements.find(
      (entry) =>
        entry.productId === created.id && entry.reason === "adjustment",
    );
    if (movement) movement.reason = "import";
    plan.result.id = created.id;
    plan.result.skuId = created.skus[0]?.id ?? null;
    createdByKey.set(plan.productKey, created);
    return;
  }

  if (plan.first && plan.product) {
    if (input.name)
      product.name = {
        en: input.name.en ?? product.name.en,
        de: input.name.de ?? product.name.de,
      };
    if (input.slugDe !== undefined)
      product.slug = { ...product.slug, de: input.slugDe };
    if (input.vatRate !== undefined) product.vatRate = input.vatRate;
    if (input.status !== undefined) {
      product.status = input.status;
      if (input.status === "active") product.publishedAt ??= iso(now);
    }
    if (categoryId !== undefined && categoryId !== product.categoryId) {
      product.categoryId = categoryId;
      product.sortOrder =
        input.sortOrder ?? nextWholesalePosition(db, categoryId);
    }
    applyWholesaleProductFields(product, fields);
    product.updatedAt = iso(now);
  }
  let sku = plan.sku;
  if (!sku) {
    assertSkuSet([
      ...product.skus.map((entry) => ({
        packSize: entry.packSize,
        unitsPerCarton: entry.unitsPerCarton,
        sku: entry.sku,
      })),
      {
        packSize: plan.pack!,
        unitsPerCarton: plan.unitsPerCarton!,
        sku: plan.code,
      },
    ]);
    sku = createWholesaleSku(
      db,
      product,
      {
        sku: plan.code,
        packSize: plan.pack!,
        unitsPerCarton: plan.unitsPerCarton!,
        isEnabled: input.isEnabled,
        stock: plan.stock,
      },
      adminId,
      now + plan.result.row,
      "import",
    );
    product.updatedAt = iso(now);
  } else {
    applyWholesaleSkuPatch(
      db,
      product,
      sku,
      {
        packSize: plan.pack,
        unitsPerCarton: plan.unitsPerCarton,
        isEnabled: input.isEnabled,
      },
      now,
    );
    if (plan.stock !== undefined && plan.stock !== sku.stock) {
      recordWholesaleMovement(
        db,
        product,
        sku,
        "import",
        plan.stock - sku.stock,
        { adminId, note: "CSV import" },
        now,
      );
    }
  }
  plan.result.id = product.id;
  plan.result.skuId = sku.id;
}

// --- The routes ----------------------------------------------------------------------

const STOPPED = "Not written: the import stopped earlier.";

function run(
  db: Db,
  body: z.output<typeof importBody>,
  apply: boolean,
  adminId: string,
  now: number,
) {
  const existing = body.existing ?? "skip";
  const categoryRows = (body.categories ?? []) as Row[];
  const productRows = (body.products ?? []) as Row[];
  const categoryPlans = body.categories
    ? planCategories(db, categoryRows, existing)
    : null;
  const productPlans = body.products
    ? planProducts(db, productRows, categoryRows, existing)
    : null;
  let stoppedAt: { type: "categories" | "products"; row: number } | null = null;

  if (apply) {
    const createdByKey = new Map<string, WholesaleProductRecord>();
    const writable = (action: Action) =>
      action === "create" || action === "update";
    if (categoryPlans) {
      for (const plan of categoryPlans) {
        if (stoppedAt || !writable(plan.result.action)) continue;
        try {
          writeCategory(db, plan, now);
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          plan.result.action = "error";
          plan.result.problems = [error.message];
          stoppedAt = { type: "categories", row: plan.result.row };
        }
      }
    }
    if (productPlans) {
      // The row that creates a product before the rows that add its SKUs.
      const ordered = [
        ...productPlans.filter((plan) => plan.product || plan.first),
        ...productPlans.filter((plan) => !plan.product && !plan.first),
      ];
      for (const plan of ordered) {
        if (stoppedAt || !writable(plan.result.action)) continue;
        try {
          writeProduct(db, plan, createdByKey, adminId, now);
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          plan.result.action = "error";
          plan.result.problems = [error.message];
          stoppedAt = { type: "products", row: plan.result.row };
        }
      }
    }
    if (stoppedAt) {
      for (const plan of [...(categoryPlans ?? []), ...(productPlans ?? [])]) {
        if (writable(plan.result.action) && plan.result.id === null) {
          plan.result.action = "skip";
          plan.result.problems = [STOPPED];
        }
      }
    }
  }

  const sheet = (
    plans: { result: RowResult }[] | null,
    rows: Row[],
    known: readonly string[],
  ) =>
    plans
      ? {
          summary: summaryOf(plans.map((plan) => plan.result)),
          rows: plans.map((plan) => plan.result),
          unknownColumns: unknownColumns(rows, known),
        }
      : undefined;
  return {
    ...(categoryPlans
      ? { categories: sheet(categoryPlans, categoryRows, CATEGORY_COLUMNS) }
      : {}),
    ...(productPlans
      ? { products: sheet(productPlans, productRows, PRODUCT_COLUMNS) }
      : {}),
    applied: apply,
    stoppedAt,
  };
}

const yesNo = (value: boolean) => (value ? "yes" : "no");
const joined = (list: string[] | null | undefined) => (list ?? []).join("|");

function exportCategories(db: Db) {
  const rows = orderedWholesaleCategories(db).map((category) => ({
    slug_en: category.slug.en,
    slug_de: category.slug.de,
    name_en: category.name.en,
    name_de: category.name.de ?? "",
    description_en: category.description?.en ?? "",
    description_de: category.description?.de ?? "",
    sort_order: String(category.sortOrder),
    is_visible: yesNo(category.isVisible),
  }));
  return { type: "categories", columns: [...CATEGORY_COLUMNS], rows };
}

function exportProducts(db: Db) {
  const rows = [...db.wholesaleProducts]
    .sort((a, b) => a.slug.en.localeCompare(b.slug.en))
    .flatMap((product) => {
      const category = db.wholesaleCategories.find(
        (entry) => entry.id === product.categoryId,
      );
      return sortedSkus(product).map((sku) => ({
        sku: sku.sku,
        name_en: product.name.en,
        name_de: product.name.de ?? "",
        slug_en: product.slug.en,
        slug_de: product.slug.de,
        subtitle_en: product.subtitle?.en ?? "",
        subtitle_de: product.subtitle?.de ?? "",
        short_description_en: product.shortDescription?.en ?? "",
        short_description_de: product.shortDescription?.de ?? "",
        description_en: product.description?.en ?? "",
        description_de: product.description?.de ?? "",
        highlights_en: joined(product.highlights.en),
        highlights_de: joined(product.highlights.de),
        brand: product.brand ?? "",
        category_slug: category?.slug.en ?? "",
        pack_value: String(sku.packSize.value),
        pack_unit: sku.packSize.unit,
        units_per_carton: String(sku.unitsPerCarton),
        sku_enabled: yesNo(sku.isEnabled),
        stock: String(sku.stock),
        vat_rate: String(product.vatRate / 100),
        status: product.status,
        is_available: yesNo(product.isAvailable),
        sort_order: String(product.sortOrder),
        storage_type: product.storageType,
        ingredients_en: product.food?.ingredients?.en ?? "",
        ingredients_de: product.food?.ingredients?.de ?? "",
        allergens_en: product.food?.allergens?.en ?? "",
        allergens_de: product.food?.allergens?.de ?? "",
        nutrition_en: product.food?.nutrition?.en ?? "",
        nutrition_de: product.food?.nutrition?.de ?? "",
        storage_instructions_en: product.food?.storageInstructions?.en ?? "",
        storage_instructions_de: product.food?.storageInstructions?.de ?? "",
        origin: product.food?.origin ?? "",
        manufacturer: product.food?.manufacturer ?? "",
        search_keywords: joined(product.searchKeywords),
      }));
    });
  return { type: "products", columns: [...PRODUCT_COLUMNS], rows };
}

export function registerWholesaleSheets(router: Router): void {
  const base = "/v1/admin/wholesale";

  router.post(
    `${base}/import/preview`,
    { permission: "wholesale.manage" },
    async (ctx) => {
      const body = await ctx.body(importBody);
      return json(run(ctx.db, body, false, ctx.admin.id, ctx.now));
    },
  );

  router.post(
    `${base}/import`,
    { permission: "wholesale.manage" },
    async (ctx) => {
      const body = await ctx.body(importBody);
      return json(run(ctx.db, body, true, ctx.admin.id, ctx.now));
    },
  );

  router.get(`${base}/export`, { permission: "wholesale.read" }, (ctx) => {
    const type = ctx.query.get("type");
    if (type === "categories") return json(exportCategories(ctx.db));
    if (type === "products") return json(exportProducts(ctx.db));
    throw fail(400, "VALIDATION_FAILED", "The request contains invalid data.", [
      { field: "type", problems: ["type must be categories or products"] },
    ]);
  });
}
