// Section 8.2: CSV import and Excel export of the catalogue. The rows of a
// sheet arrive as JSON; the mock checks them like the API does, previews
// what would happen, writes them in the right order, and gives every
// record back as flat rows.

import { z } from "zod";
import type {
  CategoryRecord,
  Db,
  ProductRecord,
  VariantRecord,
} from "../db.ts";
import { baseQuantity, orderedCategories, sortedVariants } from "../domain.ts";
import { HttpError, fail, json, newId } from "../http.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";
import { recordMovement } from "./stock.ts";
import {
  PACK_UNITS,
  applyProductFields,
  applyVariantPatch,
  assertCategorySlugFree,
  assertPackSizes,
  assertParent,
  assertProductSlugFree,
  assertQuantities,
  createVariant,
  lastPosition,
  logPrice,
  nextProductPosition,
  slugify,
  variantBySku,
} from "./catalog.ts";

const MAX_ROWS = 2000;

export const CATEGORY_COLUMNS = [
  "slug_en",
  "slug_de",
  "name_en",
  "name_de",
  "parent_slug",
  "tagline_en",
  "tagline_de",
  "description_en",
  "description_de",
  "sort_order",
  "is_visible",
  "listing_view",
  "seo_title_en",
  "seo_title_de",
  "seo_description_en",
  "seo_description_de",
] as const;

export const PRODUCT_COLUMNS = [
  "sku",
  "gtin",
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
  "uses_en",
  "uses_de",
  "brand",
  "category_slug",
  "pack_value",
  "pack_unit",
  "variant_enabled",
  "regular_price",
  "sale_price",
  "discount_percent",
  "vat_rate",
  "status",
  "is_available",
  "is_featured",
  "sort_order",
  "min_order_quantity",
  "max_order_quantity",
  "stock_quantity",
  "low_stock_threshold",
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
  "tags",
  "search_keywords",
  "seo_title_en",
  "seo_title_de",
  "seo_description_en",
  "seo_description_de",
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
  /** Product rows: the pack size the row matched or created. */
  variantId?: string | null;
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

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YES = ["yes", "true", "ja", "1"];
const NO = ["no", "false", "nein", "0"];

// --- Reading cells ------------------------------------------------------------

/** The cell as text: trimmed; numbers and booleans in the import's writing. */
export function text(row: Row, column: string): string {
  const value = row[column];
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value).trim();
}

/** Reads the typed cells of one row, collecting what is wrong with them. */
export class Cells {
  readonly problems: string[] = [];
  private readonly row: Row;
  // Node strips types only: no parameter properties here.
  constructor(row: Row) {
    this.row = row;
  }

  text(column: string, max = 20000): string | undefined {
    const value = text(this.row, column);
    if (value === "") return undefined;
    if (value.length > max) {
      this.problems.push(`${column}: at most ${max} characters`);
      return undefined;
    }
    return value;
  }

  translated(
    stem: string,
    max = 300,
  ): { en?: string; de?: string } | undefined {
    const en = this.text(`${stem}_en`, max);
    const de = this.text(`${stem}_de`, max);
    if (en === undefined && de === undefined) return undefined;
    return {
      ...(en !== undefined ? { en } : {}),
      ...(de !== undefined ? { de } : {}),
    };
  }

  slug(column: string): string | undefined {
    const value = this.text(column, 120);
    if (value === undefined) return undefined;
    if (!SLUG.test(value)) {
      this.problems.push(
        `${column}: "${value}" must use lower-case letters, digits and single hyphens`,
      );
      return undefined;
    }
    return value;
  }

  bool(column: string): boolean | undefined {
    const value = text(this.row, column).toLowerCase();
    if (value === "") return undefined;
    if (YES.includes(value)) return true;
    if (NO.includes(value)) return false;
    this.problems.push(`${column}: "${value}" is not yes or no`);
    return undefined;
  }

  int(column: string, min: number, max: number): number | undefined {
    const value = text(this.row, column);
    if (value === "") return undefined;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) {
      this.problems.push(
        `${column}: "${value}" must be a whole number from ${min} to ${max}`,
      );
      return undefined;
    }
    return number;
  }

  decimal(column: string, decimals: number): number | undefined {
    const value = text(this.row, column).replace(",", ".");
    if (value === "") return undefined;
    const pattern = new RegExp(`^\\d+(?:\\.\\d{1,${decimals}})?$`);
    if (!pattern.test(value)) {
      this.problems.push(
        `${column}: "${value}" must be a number with at most ${decimals} decimals`,
      );
      return undefined;
    }
    return Number(value);
  }

  /** Euros with up to two decimals, as cents. */
  cents(column: string): number | undefined {
    const value = this.decimal(column, 2);
    return value === undefined ? undefined : Math.round(value * 100);
  }

  oneOf<T extends string>(column: string, values: readonly T[]): T | undefined {
    const value = text(this.row, column).toLowerCase();
    if (value === "") return undefined;
    if ((values as readonly string[]).includes(value)) return value as T;
    this.problems.push(
      `${column}: "${value}" must be one of ${values.join(", ")}`,
    );
    return undefined;
  }

  list(column: string, max: number, each?: (entry: string) => string | null) {
    const value = text(this.row, column);
    if (value === "") return undefined;
    const entries = value
      .split("|")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (entries.length > max) {
      this.problems.push(`${column}: at most ${max} entries`);
      return undefined;
    }
    for (const entry of entries) {
      const problem = each?.(entry);
      if (problem) {
        this.problems.push(`${column}: ${problem}`);
        return undefined;
      }
    }
    return entries;
  }
}

export function unknownColumns(
  rows: Row[],
  known: readonly string[],
): string[] {
  const seen = new Set<string>();
  for (const row of rows)
    for (const column of Object.keys(row))
      if (!(known as readonly string[]).includes(column)) seen.add(column);
  return [...seen].sort();
}

export function summaryOf(rows: { action: Action }[]) {
  const count = (action: Action) =>
    rows.filter((entry) => entry.action === action).length;
  return {
    total: rows.length,
    create: count("create"),
    update: count("update"),
    skip: count("skip"),
    unchanged: count("unchanged"),
    error: count("error"),
  };
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

// --- Categories ----------------------------------------------------------------

interface CategoryPlan {
  result: RowResult;
  existing: CategoryRecord | null;
  /** `undefined`: leave as it is; `null`: a main category; a slug: resolved later. */
  parent: undefined | null | { existingId: string } | { rowKey: string };
  input: {
    name?: { en?: string; de?: string };
    slugDe?: string;
    tagline?: { en?: string; de?: string };
    description?: { en?: string; de?: string };
    sortOrder?: number;
    isVisible?: boolean;
    listingView?: "product" | "variants_by_product" | "variants_by_size";
    seoTitle?: { en?: string; de?: string };
    seoDescription?: { en?: string; de?: string };
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
      ? (db.categories.find((entry) => entry.slug.en === key) ?? null)
      : null;
    const plan: CategoryPlan = {
      result: {
        row: index + 1,
        key,
        name: name?.en ?? record?.name.en ?? "",
        action: "create",
        id: record?.id ?? null,
        changes: [],
        problems: cells.problems,
      },
      existing: record,
      parent: undefined,
      input: {},
    };
    plans.push(plan);
    if (!key) cells.problems.push("slug_en or name_en is required");
    else if (keys.has(key))
      cells.problems.push(`slug_en: the same as row ${keys.get(key)}`);
    else keys.set(key, index + 1);
    if (!record && !name?.en)
      cells.problems.push("name_en is required for a new category");

    plan.input = {
      name,
      slugDe: cells.slug("slug_de"),
      tagline: cells.translated("tagline", 300),
      description: cells.translated("description", 20000),
      sortOrder: cells.int("sort_order", 0, 100000),
      isVisible: cells.bool("is_visible"),
      listingView: cells.oneOf("listing_view", [
        "product",
        "variants_by_product",
        "variants_by_size",
      ] as const),
      seoTitle: cells.translated("seo_title", 300),
      seoDescription: cells.translated("seo_description", 300),
    };

    const parentSlug = text(row, "parent_slug");
    if (parentSlug === "") plan.parent = record ? undefined : null;
    else if (parentSlug.toLowerCase() === "none") plan.parent = null;
    else if (parentSlug === key)
      cells.problems.push("parent_slug: a category cannot be its own parent");
    else {
      const parent = db.categories.find(
        (entry) => entry.slug.en === parentSlug,
      );
      if (parent) plan.parent = { existingId: parent.id };
      else if (
        rows.some(
          (other, at) =>
            at !== index &&
            (text(other, "slug_en") || slugify(text(other, "name_en"))) ===
              parentSlug,
        )
      )
        plan.parent = { rowKey: parentSlug };
      else
        cells.problems.push(
          `parent_slug: "${parentSlug}" is neither an existing category nor a row of this file`,
        );
    }
  });

  // The level a row ends up at: parents of the file count as well.
  const levelOf = (plan: CategoryPlan, seen: string[]): number => {
    if (plan.parent === null) return 1;
    if (plan.parent === undefined) {
      if (!plan.existing) return 1;
      let level = 1;
      let current: CategoryRecord | undefined = plan.existing;
      while (current?.parentId) {
        level += 1;
        current = db.categories.find((entry) => entry.id === current?.parentId);
      }
      return level;
    }
    if ("existingId" in plan.parent) {
      let level = 2;
      let current = db.categories.find(
        (entry) =>
          entry.id === (plan.parent as { existingId: string }).existingId,
      );
      while (current?.parentId) {
        level += 1;
        current = db.categories.find((entry) => entry.id === current?.parentId);
      }
      return level;
    }
    const key = plan.parent.rowKey;
    if (seen.includes(key)) return 99;
    const parentPlan = plans.find((entry) => entry.result.key === key);
    return parentPlan ? levelOf(parentPlan, [...seen, key]) + 1 : 99;
  };
  for (const plan of plans) {
    if (plan.result.problems.length > 0) continue;
    const level = levelOf(plan, [plan.result.key]);
    if (level === 99 || level > 3)
      plan.result.problems.push(
        "parent_slug: categories can be three levels deep at most",
      );
  }

  for (const plan of plans) {
    const record = plan.existing;
    if (plan.result.problems.length > 0) {
      plan.result.action = "error";
      continue;
    }
    if (!record) continue;
    const changes: string[] = [];
    const input = plan.input;
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
      changes.push("name");
    if (input.slugDe !== undefined && input.slugDe !== record.slug.de)
      changes.push("slug_de");
    if (plan.parent !== undefined) {
      const parentId =
        plan.parent === null
          ? null
          : "existingId" in plan.parent
            ? plan.parent.existingId
            : "(new)";
      if (parentId !== record.parentId) changes.push("parent_slug");
    }
    if (
      input.tagline &&
      !same(input.tagline, {
        en: record.tagline?.en ?? undefined,
        de: record.tagline?.de ?? undefined,
      })
    )
      changes.push("tagline");
    if (
      input.description &&
      !same(input.description, {
        en: record.description?.en ?? undefined,
        de: record.description?.de ?? undefined,
      })
    )
      changes.push("description");
    if (input.sortOrder !== undefined && input.sortOrder !== record.sortOrder)
      changes.push("sort_order");
    if (input.isVisible !== undefined && input.isVisible !== record.isVisible)
      changes.push("is_visible");
    if (
      input.listingView !== undefined &&
      input.listingView !== record.listingView
    )
      changes.push("listing_view");
    if (
      input.seoTitle &&
      !same(input.seoTitle, {
        en: record.seo?.title?.en ?? undefined,
        de: record.seo?.title?.de ?? undefined,
      })
    )
      changes.push("seo_title");
    if (
      input.seoDescription &&
      !same(input.seoDescription, {
        en: record.seo?.description?.en ?? undefined,
        de: record.seo?.description?.de ?? undefined,
      })
    )
      changes.push("seo_description");
    plan.result.changes = existing === "update" ? changes : [];
    plan.result.action =
      existing === "skip"
        ? "skip"
        : changes.length > 0
          ? "update"
          : "unchanged";
  }
  return plans;
}

/** Parents before children, whatever the order of the file. */
function orderCategoryPlans(plans: CategoryPlan[]): CategoryPlan[] {
  const done = new Set<string>();
  const ordered: CategoryPlan[] = [];
  let pending = plans.filter((plan) => plan.result.action !== "error");
  while (pending.length > 0) {
    const ready = pending.filter(
      (plan) =>
        !(plan.parent && "rowKey" in plan.parent) ||
        done.has(plan.parent.rowKey),
    );
    if (ready.length === 0) break;
    for (const plan of ready) {
      ordered.push(plan);
      done.add(plan.result.key);
    }
    pending = pending.filter((plan) => !ready.includes(plan));
  }
  return ordered;
}

function writeCategory(
  db: Db,
  plan: CategoryPlan,
  createdIds: Map<string, string>,
  now: number,
): void {
  const input = plan.input;
  const parentId =
    plan.parent === undefined
      ? undefined
      : plan.parent === null
        ? null
        : "existingId" in plan.parent
          ? plan.parent.existingId
          : (createdIds.get(plan.parent.rowKey) ?? null);
  const seo =
    input.seoTitle || input.seoDescription
      ? {
          title: input.seoTitle ?? null,
          description: input.seoDescription ?? null,
        }
      : undefined;
  if (!plan.existing) {
    const parent = parentId ?? null;
    assertParent(db, parent);
    const name = { en: input.name!.en!, de: input.name?.de ?? null };
    const slug = {
      en: plan.result.key,
      de: input.slugDe ?? (name.de ? slugify(name.de) : null),
    };
    assertCategorySlugFree(db, slug);
    const category: CategoryRecord = {
      id: newId(now),
      name,
      slug,
      tagline: input.tagline ?? null,
      description: input.description ?? null,
      parentId: parent,
      sortOrder: input.sortOrder ?? lastPosition(db, parent),
      isVisible: input.isVisible ?? true,
      listingView: input.listingView ?? "variants_by_size",
      image: null,
      seo: seo ?? null,
      createdAt: iso(now),
      updatedAt: iso(now),
    };
    db.categories.push(category);
    plan.result.id = category.id;
    createdIds.set(plan.result.key, category.id);
    return;
  }
  const category = plan.existing;
  if (parentId !== undefined && parentId !== category.parentId) {
    assertParent(db, parentId, category);
    category.parentId = parentId;
    category.sortOrder = lastPosition(db, parentId);
  }
  if (input.name)
    category.name = {
      en: input.name.en ?? category.name.en,
      de: input.name.de ?? category.name.de ?? null,
    };
  if (input.slugDe !== undefined) {
    const slug = { en: category.slug.en, de: input.slugDe };
    assertCategorySlugFree(db, slug, category.id);
    category.slug = slug;
  }
  if (input.tagline)
    category.tagline = { ...category.tagline, ...input.tagline };
  if (input.description)
    category.description = { ...category.description, ...input.description };
  if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
  if (input.isVisible !== undefined) category.isVisible = input.isVisible;
  if (input.listingView !== undefined) category.listingView = input.listingView;
  if (seo)
    category.seo = {
      title: seo.title ?? category.seo?.title ?? null,
      description: seo.description ?? category.seo?.description ?? null,
    };
  category.updatedAt = iso(now);
  createdIds.set(plan.result.key, category.id);
}

// --- Products ------------------------------------------------------------------

type Pack = { value: number; unit: (typeof PACK_UNITS)[number] };

/**
 * One row of the product sheet is one pack size (8.2). The rows of a
 * product are tied by `slug_en` (or the slug of `name_en`); the product
 * columns come from the first of them.
 */
interface ProductPlan {
  result: RowResult;
  /** The product the row belongs to, when it exists. */
  product: ProductRecord | null;
  /** The pack size the row matched, when it exists. */
  variant: VariantRecord | null;
  /** The key of the product in the file: `slug_en`, or the slug the name would get. */
  productKey: string;
  /** The first row of this product in the file carries the product columns. */
  first: boolean;
  sku: string | undefined;
  pack: Pack | undefined;
  category: undefined | { existingId: string } | { rowKey: string };
  input: {
    name?: { en?: string; de?: string };
    slugEn?: string;
    slugDe?: string;
    gtin?: string;
    subtitle?: { en?: string; de?: string };
    shortDescription?: { en?: string; de?: string };
    description?: { en?: string; de?: string };
    highlights?: { en?: string[]; de?: string[] };
    uses?: { en?: string[]; de?: string[] };
    brand?: string;
    isEnabled?: boolean;
    regularPrice?: number;
    salePrice?: number | null;
    discountPercent?: number | null;
    vatRate?: number;
    status?: "draft" | "active" | "archived";
    isAvailable?: boolean;
    isFeatured?: boolean;
    sortOrder?: number;
    minOrderQuantity?: number;
    maxOrderQuantity?: number | null;
    stockQuantity?: number;
    lowStockThreshold?: number | null;
    storageType?: "ambient" | "chilled" | "frozen";
    food?: Record<string, { en?: string; de?: string } | string | undefined>;
    tags?: string[];
    searchKeywords?: string[];
    seoTitle?: { en?: string; de?: string };
    seoDescription?: { en?: string; de?: string };
  };
}

/** The pack size of a product with this pack, if any. */
function variantByPack(
  product: ProductRecord,
  pack: Pack,
): VariantRecord | undefined {
  return product.variants.find(
    (entry) => baseQuantity(entry.packSize) === baseQuantity(pack),
  );
}

function planProducts(
  db: Db,
  rows: Row[],
  categoryRows: Row[],
  existing: Existing,
): ProductPlan[] {
  const plans: ProductPlan[] = [];
  const categoryKeys = categoryRows.map(
    (row) => text(row, "slug_en") || slugify(text(row, "name_en")),
  );
  /** The first row of each product key in the file. */
  const firstRows = new Map<string, number>();
  const skuRows = new Map<string, number>();

  rows.forEach((row, index) => {
    const cells = new Cells(row);
    const skuText = text(row, "sku").toUpperCase();
    let sku: string | undefined;
    if (skuText) {
      if (/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(skuText)) sku = skuText;
      else
        cells.problems.push(
          `sku: "${skuText}" must have 2 to 40 characters: letters, digits, ".", "_" or "-"`,
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

    // The pack size by its article number, and through it the product.
    const bySku = sku ? variantBySku(db, sku) : undefined;
    let productKey = slugEn ?? (name?.en ? slugify(name.en) : "");
    let product: ProductRecord | null = bySku?.product ?? null;
    if (!product && productKey) {
      product =
        db.products.find((entry) => entry.slug.en === productKey) ?? null;
    }
    if (bySku && productKey && bySku.product.slug.en !== productKey) {
      // A slug that names another product than the one the SKU belongs to.
      const other = db.products.find((entry) => entry.slug.en === productKey);
      if (other || !slugEn)
        cells.problems.push(
          `sku: "${sku}" belongs to product ${bySku.product.slug.en}, not to ${productKey}`,
        );
    }
    if (!productKey && product) productKey = product.slug.en;
    let variant: VariantRecord | null = bySku?.variant ?? null;
    if (!variant && product && !sku) {
      // Without an article number, the pack names the pack size, or the
      // only pack size there is.
      variant = pack
        ? (variantByPack(product, pack) ?? null)
        : product.variants.length === 1
          ? (product.variants[0] ?? null)
          : null;
    }
    const first = productKey ? !firstRows.has(productKey) : true;
    if (productKey && first) firstRows.set(productKey, index + 1);

    const plan: ProductPlan = {
      result: {
        row: index + 1,
        key: sku ?? variant?.sku ?? productKey,
        name: name?.en ?? product?.name.en ?? "",
        action: "create",
        id: product?.id ?? null,
        variantId: variant?.id ?? null,
        changes: [],
        problems: cells.problems,
      },
      product,
      variant,
      productKey,
      first,
      sku,
      pack,
      category: undefined,
      input: {},
    };
    plans.push(plan);
    if (!productKey && !sku)
      cells.problems.push("sku, slug_en or name_en is required");
    if (sku) {
      if (skuRows.has(sku))
        cells.problems.push(`sku: the same as row ${skuRows.get(sku)}`);
      else skuRows.set(sku, index + 1);
    }
    if (packValue !== undefined && (packValue < 0.001 || packValue > 1_000_000))
      cells.problems.push("pack_value: from 0.001 to 1,000,000");

    const salePrice = cells.cents("sale_price");
    const discountPercent = cells.int("discount_percent", 0, 99);
    if (salePrice && discountPercent)
      cells.problems.push(
        "sale_price and discount_percent: give one of them, not both",
      );
    const gtin = cells.text("gtin", 14);
    if (gtin !== undefined && !/^(\d{8}|\d{12,14})$/.test(gtin))
      cells.problems.push(`gtin: "${gtin}" must have 8, 12, 13 or 14 digits`);
    const vatPercent = cells.decimal("vat_rate", 2);
    if (vatPercent !== undefined && vatPercent > 100)
      cells.problems.push("vat_rate: a percentage up to 100");
    const minQty = cells.int("min_order_quantity", 1, 10000);
    const maxQty = cells.int("max_order_quantity", 0, 10000);
    const stockQuantity = cells.int("stock_quantity", 0, 1_000_000);
    const lowStockThreshold = cells.int("low_stock_threshold", 0, 1_000_000);
    const food: ProductPlan["input"]["food"] = {};
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

    plan.input = {
      name,
      slugEn,
      slugDe: cells.slug("slug_de"),
      gtin,
      subtitle: cells.translated("subtitle", 300),
      shortDescription: cells.translated("short_description", 300),
      description: cells.translated("description", 20000),
      highlights: listPair(cells, "highlights"),
      uses: listPair(cells, "uses"),
      brand: cells.text("brand", 80),
      isEnabled: cells.bool("variant_enabled"),
      regularPrice: cells.cents("regular_price"),
      salePrice:
        salePrice === undefined
          ? undefined
          : salePrice === 0
            ? null
            : salePrice,
      discountPercent:
        discountPercent === undefined
          ? undefined
          : discountPercent === 0
            ? null
            : discountPercent,
      vatRate:
        vatPercent === undefined ? undefined : Math.round(vatPercent * 100),
      status: cells.oneOf("status", ["draft", "active", "archived"] as const),
      isAvailable: cells.bool("is_available"),
      isFeatured: cells.bool("is_featured"),
      sortOrder: cells.int("sort_order", 0, 1_000_000),
      minOrderQuantity: minQty,
      maxOrderQuantity:
        maxQty === undefined ? undefined : maxQty === 0 ? null : maxQty,
      stockQuantity,
      lowStockThreshold:
        lowStockThreshold === undefined
          ? undefined
          : lowStockThreshold === 0
            ? null
            : lowStockThreshold,
      storageType: cells.oneOf("storage_type", [
        "ambient",
        "chilled",
        "frozen",
      ] as const),
      food: Object.keys(food).length > 0 ? food : undefined,
      tags: cells.list("tags", 20, (tag) =>
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(tag) && tag.length <= 40
          ? null
          : `"${tag}" must use lower-case letters, digits and hyphens`,
      ),
      searchKeywords: cells.list("search_keywords", 30, (word) =>
        word.length >= 2 && word.length <= 60
          ? null
          : `"${word}" must have 2 to 60 characters`,
      ),
      seoTitle: cells.translated("seo_title", 300),
      seoDescription: cells.translated("seo_description", 300),
    };

    const categorySlug = text(row, "category_slug");
    if (categorySlug) {
      const category = db.categories.find(
        (entry) => entry.slug.en === categorySlug,
      );
      if (category) plan.category = { existingId: category.id };
      else if (categoryKeys.includes(categorySlug))
        plan.category = { rowKey: categorySlug };
      else
        cells.problems.push(
          `category_slug: "${categorySlug}" is neither an existing category nor a row of the categories sheet`,
        );
    }

    if (!variant) {
      // A pack size that is added: to a product that exists, or to one
      // that the first row of its key creates.
      for (const [column, present] of [
        ["pack_value", packValue !== undefined],
        ["pack_unit", packUnit !== undefined],
        ["regular_price", plan.input.regularPrice !== undefined],
      ] as const) {
        if (!present)
          cells.problems.push(`${column} is required for a new pack size`);
      }
      if (!product && first) {
        // The slug a new product would get must be free (8): the preview
        // says so; only a slug taken a moment ago stops the import itself.
        const taken = productKey
          ? db.products.find((entry) => entry.slug.en === productKey)
          : undefined;
        if (taken)
          cells.problems.push(
            `slug_en: "${productKey}" is used by product ${taken.slug.en} already`,
          );
        for (const [column, present] of [
          ["name_en", Boolean(name?.en)],
          ["category_slug", plan.category !== undefined],
          ["vat_rate", plan.input.vatRate !== undefined],
        ] as const) {
          if (!present)
            cells.problems.push(`${column} is required for a new product`);
        }
      } else if (!product && !sku) {
        cells.problems.push(
          "sku is required for a further pack size of a new product",
        );
      } else if (product && pack && !sku) {
        // A pack that is not on the product yet needs an article number.
        cells.problems.push(
          `sku is required for a new pack size of ${product.slug.en}`,
        );
      }
    }
  });

  // The packs of one product in the file must be of one family and unique,
  // together with the pack sizes the product has already.
  const byKey = new Map<string, ProductPlan[]>();
  for (const plan of plans) {
    if (!plan.productKey) continue;
    byKey.set(plan.productKey, [...(byKey.get(plan.productKey) ?? []), plan]);
  }
  for (const group of byKey.values()) {
    const product = group.find((plan) => plan.product)?.product ?? null;
    const packs = [
      ...(product?.variants ?? [])
        .filter((entry) => !group.some((plan) => plan.variant === entry))
        .map((entry) => entry.packSize),
      ...group.flatMap((plan) => (plan.pack ? [plan.pack] : [])),
    ];
    const skus = [
      ...(product?.variants ?? [])
        .filter((entry) => !group.some((plan) => plan.variant === entry))
        .map((entry) => entry.sku),
      ...group.map((plan) => plan.sku ?? plan.variant?.sku),
    ];
    try {
      assertPackSizes(packs, skus);
    } catch (error) {
      if (!(error instanceof HttpError)) throw error;
      for (const plan of group)
        if (!plan.variant || plan.pack)
          plan.result.problems.push(error.message);
    }
  }

  for (const plan of plans) {
    if (plan.result.problems.length > 0) {
      plan.result.action = "error";
      continue;
    }
    if (!plan.variant) {
      // A product with its first pack size, or a further pack size.
      if (plan.product || !plan.first) plan.result.changes = ["variant"];
      continue;
    }
    const product = plan.product!;
    const variant = plan.variant;
    const input = plan.input;
    const changes: string[] = [];
    const translatedDiffers = (
      value: { en?: string; de?: string } | undefined,
      current: { en?: string | null; de?: string | null } | null | undefined,
    ) =>
      Boolean(value) &&
      ((value!.en !== undefined && value!.en !== (current?.en ?? undefined)) ||
        (value!.de !== undefined && value!.de !== (current?.de ?? undefined)));
    // The pack size's own columns, read from every row.
    if (input.gtin !== undefined && input.gtin !== variant.gtin)
      changes.push("gtin");
    if (plan.pack && baseQuantity(plan.pack) !== baseQuantity(variant.packSize))
      changes.push("packSize");
    if (input.isEnabled !== undefined && input.isEnabled !== variant.isEnabled)
      changes.push("isEnabled");
    if (
      input.regularPrice !== undefined &&
      input.regularPrice !== variant.regularPrice
    )
      changes.push("regularPrice");
    if (input.salePrice !== undefined && input.salePrice !== variant.salePrice)
      changes.push("salePrice");
    if (input.discountPercent !== undefined) {
      const regular = input.regularPrice ?? variant.regularPrice;
      const sale =
        input.discountPercent === null
          ? null
          : Math.round((regular * (100 - input.discountPercent)) / 100);
      if (sale !== variant.salePrice) changes.push("discountPercent");
    }
    if (
      input.stockQuantity !== undefined &&
      input.stockQuantity !== variant.stock.quantity
    )
      changes.push("stock");
    if (
      input.lowStockThreshold !== undefined &&
      input.lowStockThreshold !== variant.stock.lowStockThreshold
    )
      changes.push("lowStockThreshold");
    // The product's columns, from its first row in the file only.
    if (plan.first) {
      if (translatedDiffers(input.name, product.name)) changes.push("name");
      if (input.slugEn !== undefined && input.slugEn !== product.slug.en)
        changes.push("slug");
      if (input.slugDe !== undefined && input.slugDe !== product.slug.de)
        changes.push("slug");
      if (translatedDiffers(input.subtitle, product.subtitle))
        changes.push("subtitle");
      if (translatedDiffers(input.shortDescription, product.shortDescription))
        changes.push("shortDescription");
      if (translatedDiffers(input.description, product.description))
        changes.push("description");
      if (
        input.highlights &&
        !same(input.highlights, {
          en: product.highlights?.en,
          de: product.highlights?.de,
        })
      )
        changes.push("highlights");
      if (
        input.uses &&
        !same(input.uses, { en: product.uses?.en, de: product.uses?.de })
      )
        changes.push("uses");
      if (input.brand !== undefined && input.brand !== product.brand)
        changes.push("brand");
      if (
        plan.category &&
        "existingId" in plan.category &&
        plan.category.existingId !== product.categoryId
      )
        changes.push("category");
      if (plan.category && "rowKey" in plan.category) changes.push("category");
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
        input.isFeatured !== undefined &&
        input.isFeatured !== product.isFeatured
      )
        changes.push("isFeatured");
      if (
        input.sortOrder !== undefined &&
        input.sortOrder !== product.sortOrder
      )
        changes.push("sortOrder");
      if (
        input.minOrderQuantity !== undefined &&
        input.minOrderQuantity !== product.minOrderQuantity
      )
        changes.push("minOrderQuantity");
      if (
        input.maxOrderQuantity !== undefined &&
        input.maxOrderQuantity !== product.maxOrderQuantity
      )
        changes.push("maxOrderQuantity");
      if (
        input.storageType !== undefined &&
        input.storageType !== product.storageType
      )
        changes.push("storageType");
      if (input.food) {
        for (const [stem, value] of Object.entries(input.food)) {
          const current =
            product.food?.[
              toCamel(stem) as keyof NonNullable<ProductRecord["food"]>
            ];
          if (
            typeof value === "string"
              ? value !== current
              : translatedDiffers(
                  value,
                  current as { en?: string | null; de?: string | null } | null,
                )
          )
            changes.push(toCamel(stem));
        }
      }
      if (input.tags && !same(input.tags, product.tags)) changes.push("tags");
      if (
        input.searchKeywords &&
        !same(input.searchKeywords, product.searchKeywords)
      )
        changes.push("searchKeywords");
      if (translatedDiffers(input.seoTitle, product.seo?.title))
        changes.push("seo");
      if (translatedDiffers(input.seoDescription, product.seo?.description))
        changes.push("seo");
    }
    plan.result.changes = existing === "update" ? [...new Set(changes)] : [];
    plan.result.action =
      existing === "skip"
        ? "skip"
        : changes.length > 0
          ? "update"
          : "unchanged";
  }
  return plans;
}

function listPair(cells: Cells, stem: string) {
  const en = cells.list(`${stem}_en`, 20);
  const de = cells.list(`${stem}_de`, 20);
  if (!en && !de) return undefined;
  return { ...(en ? { en } : {}), ...(de ? { de } : {}) };
}

const toCamel = (stem: string) =>
  stem.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** The row that creates a product before the rows that add its pack sizes, whatever the order of the file. */
function orderProductPlans(plans: ProductPlan[]): ProductPlan[] {
  const writable = plans.filter((plan) => plan.result.action !== "error");
  return [
    ...writable.filter((plan) => plan.product || plan.first),
    ...writable.filter((plan) => !plan.product && !plan.first),
  ];
}

/** The product fields of a row, as the catalogue module applies them. */
function productFieldsOf(plan: ProductPlan) {
  const input = plan.input;
  const food = input.food
    ? {
        ingredients: input.food.ingredients as
          { en?: string; de?: string } | undefined,
        allergens: input.food.allergens as
          { en?: string; de?: string } | undefined,
        nutrition: input.food.nutrition as
          { en?: string; de?: string } | undefined,
        storageInstructions: input.food.storage_instructions as
          { en?: string; de?: string } | undefined,
        origin: input.food.origin as string | undefined,
        manufacturer: input.food.manufacturer as string | undefined,
      }
    : undefined;
  return {
    subtitle: input.subtitle,
    shortDescription: input.shortDescription,
    description: input.description,
    highlights: input.highlights,
    uses: input.uses,
    brand: input.brand,
    isAvailable: input.isAvailable,
    isFeatured: input.isFeatured,
    sortOrder: input.sortOrder,
    storageType: input.storageType,
    tags: input.tags,
    searchKeywords: input.searchKeywords,
    seo:
      input.seoTitle || input.seoDescription
        ? { title: input.seoTitle, description: input.seoDescription }
        : undefined,
    food,
  };
}

/** The pack size of a row as `POST …/variants` takes it. */
function variantInputOf(plan: ProductPlan) {
  const input = plan.input;
  return {
    sku: plan.sku,
    gtin: input.gtin,
    packSize: plan.pack!,
    regularPrice: input.regularPrice!,
    salePrice: input.salePrice,
    discountPercent: input.discountPercent,
    isEnabled: input.isEnabled,
    stockQuantity: input.stockQuantity,
    lowStockThreshold: input.lowStockThreshold,
  };
}

function writeProduct(
  db: Db,
  plan: ProductPlan,
  categoryIds: Map<string, string>,
  createdByKey: Map<string, ProductRecord>,
  adminId: string,
  now: number,
): void {
  const input = plan.input;
  const categoryId = plan.category
    ? "existingId" in plan.category
      ? plan.category.existingId
      : (categoryIds.get(plan.category.rowKey) ?? "")
    : undefined;
  if (
    categoryId !== undefined &&
    !db.categories.some((entry) => entry.id === categoryId)
  )
    throw fail(404, "CATEGORY_NOT_FOUND", "The category was not found.");

  const product = plan.product ?? createdByKey.get(plan.productKey) ?? null;

  if (!product) {
    // The first row of a new product creates it with its first pack size.
    const min = input.minOrderQuantity ?? 1;
    const max = input.maxOrderQuantity ?? null;
    assertQuantities(min, max);
    const name = { en: input.name!.en!, de: input.name?.de ?? null };
    const slug = {
      en: input.slugEn ?? slugify(name.en),
      de: input.slugDe ?? (name.de ? slugify(name.de) : null),
    };
    assertProductSlugFree(db, slug, [plan.pack!]);
    const status = input.status ?? "draft";
    const created: ProductRecord = {
      id: newId(now),
      name,
      slug,
      brand: null,
      vatRate: input.vatRate!,
      status,
      isAvailable: true,
      isFeatured: false,
      // A create without a position goes last (7).
      sortOrder:
        input.sortOrder ?? nextProductPosition(db, categoryId as string),
      subtitle: null,
      shortDescription: null,
      description: null,
      highlights: null,
      uses: null,
      categoryId: categoryId!,
      minOrderQuantity: min,
      maxOrderQuantity: max,
      storageType: "ambient",
      variants: [],
      food: null,
      tags: [],
      searchKeywords: [],
      seo: null,
      images: [],
      publishedAt: status === "active" ? iso(now) : null,
      createdAt: iso(now),
      updatedAt: iso(now),
    };
    applyProductFields(created, productFieldsOf(plan));
    const variant = createVariant(
      db,
      created,
      { ...variantInputOf(plan), stockQuantity: undefined },
      adminId,
      now,
    );
    // The opening stock of an imported pack size is recorded as a restock (8.2).
    if (input.stockQuantity) {
      recordMovement(
        db,
        created,
        variant,
        "restock",
        input.stockQuantity,
        { adminId, note: "CSV import" },
        now,
      );
    }
    db.products.push(created);
    plan.result.id = created.id;
    plan.result.variantId = variant.id;
    createdByKey.set(plan.productKey, created);
    return;
  }

  if (!plan.variant) {
    // A further pack size of a product that exists or was created just now.
    assertPackSizes(
      [...product.variants.map((entry) => entry.packSize), plan.pack!],
      [...product.variants.map((entry) => entry.sku), plan.sku],
    );
    assertProductSlugFree(db, product.slug, [plan.pack!], product.id);
    const variant = createVariant(
      db,
      product,
      { ...variantInputOf(plan), stockQuantity: undefined },
      adminId,
      now,
    );
    if (input.stockQuantity) {
      recordMovement(
        db,
        product,
        variant,
        "restock",
        input.stockQuantity,
        { adminId, note: "CSV import" },
        now,
      );
    }
    product.updatedAt = iso(now);
    plan.result.id = product.id;
    plan.result.variantId = variant.id;
    createdByKey.set(plan.productKey, product);
    return;
  }

  // An update: the product columns first (from the first row), then the
  // pack size, then the stock count (8.2).
  const variant = plan.variant;
  if (plan.first) {
    const min = input.minOrderQuantity ?? product.minOrderQuantity;
    const max =
      input.maxOrderQuantity === undefined
        ? product.maxOrderQuantity
        : input.maxOrderQuantity;
    assertQuantities(min, max);
    if (input.slugEn !== undefined || input.slugDe !== undefined) {
      const slug = {
        en: input.slugEn ?? product.slug.en,
        de: input.slugDe ?? product.slug.de ?? null,
      };
      assertProductSlugFree(
        db,
        slug,
        product.variants.map((entry) => entry.packSize),
        product.id,
      );
      product.slug = slug;
    }
    const vatRate = input.vatRate ?? product.vatRate;
    const vatChanged = vatRate !== product.vatRate;
    product.vatRate = vatRate;
    product.minOrderQuantity = min;
    product.maxOrderQuantity = max;
    if (input.name)
      product.name = {
        en: input.name.en ?? product.name.en,
        de: input.name.de ?? product.name.de ?? null,
      };
    if (categoryId !== undefined && categoryId !== product.categoryId) {
      // A moved product takes the last position of its new category (7).
      product.categoryId = categoryId;
      product.sortOrder =
        input.sortOrder ?? nextProductPosition(db, categoryId);
    }
    if (input.status !== undefined) {
      product.status = input.status;
      if (input.status === "active") product.publishedAt ??= iso(now);
    }
    applyProductFields(product, productFieldsOf(plan));
    if (vatChanged) {
      for (const entry of product.variants)
        logPrice(db, product, entry, adminId, now);
    }
  }
  applyVariantPatch(
    db,
    product,
    variant,
    {
      gtin: input.gtin,
      packSize: plan.pack,
      regularPrice: input.regularPrice,
      salePrice: input.salePrice,
      discountPercent: input.discountPercent,
      isEnabled: input.isEnabled,
      lowStockThreshold: input.lowStockThreshold,
    },
    adminId,
    now,
  );
  product.updatedAt = iso(now);
  // A changed count is recorded as an import movement (8.2).
  if (
    input.stockQuantity !== undefined &&
    input.stockQuantity !== variant.stock.quantity
  ) {
    recordMovement(
      db,
      product,
      variant,
      "import",
      input.stockQuantity - variant.stock.quantity,
      { adminId, note: "CSV import" },
      now,
    );
  }
  createdByKey.set(plan.productKey, product);
}

// --- The routes -----------------------------------------------------------------

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
    const categoryIds = new Map<string, string>();
    for (const category of db.categories)
      categoryIds.set(category.slug.en, category.id);
    const createdByKey = new Map<string, ProductRecord>();
    const writable = (action: Action) =>
      action === "create" || action === "update";
    const stop = (type: "categories" | "products", row: number) => {
      stoppedAt = { type, row };
    };
    if (categoryPlans) {
      for (const plan of orderCategoryPlans(categoryPlans)) {
        if (stoppedAt || !writable(plan.result.action)) continue;
        try {
          writeCategory(db, plan, categoryIds, now);
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          plan.result.action = "error";
          plan.result.problems = [error.message];
          stop("categories", plan.result.row);
        }
      }
    }
    if (productPlans) {
      for (const plan of orderProductPlans(productPlans)) {
        if (stoppedAt || !writable(plan.result.action)) continue;
        try {
          writeProduct(db, plan, categoryIds, createdByKey, adminId, now);
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          plan.result.action = "error";
          plan.result.problems = [error.message];
          stop("products", plan.result.row);
        }
      }
    }
    if (stoppedAt) {
      // Everything that was still to be written is reported as not written.
      for (const plan of [...(categoryPlans ?? []), ...(productPlans ?? [])]) {
        if (writable(plan.result.action) && plan.result.id === null) {
          plan.result.action = "skip";
          plan.result.problems = [STOPPED];
        } else if (
          plan.result.action === "update" &&
          !plan.result.changes.length
        ) {
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

const euros = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toFixed(2);
const yesNo = (value: boolean) => (value ? "yes" : "no");
const joined = (list: string[] | null | undefined) => (list ?? []).join("|");

function exportCategories(db: Db) {
  const rows = orderedCategories(db).map((category) => {
    const parent = db.categories.find(
      (entry) => entry.id === category.parentId,
    );
    return {
      slug_en: category.slug.en,
      slug_de: category.slug.de ?? "",
      name_en: category.name.en,
      name_de: category.name.de ?? "",
      parent_slug: parent?.slug.en ?? "",
      tagline_en: category.tagline?.en ?? "",
      tagline_de: category.tagline?.de ?? "",
      description_en: category.description?.en ?? "",
      description_de: category.description?.de ?? "",
      sort_order: String(category.sortOrder),
      is_visible: yesNo(category.isVisible),
      listing_view: category.listingView,
      seo_title_en: category.seo?.title?.en ?? "",
      seo_title_de: category.seo?.title?.de ?? "",
      seo_description_en: category.seo?.description?.en ?? "",
      seo_description_de: category.seo?.description?.de ?? "",
    };
  });
  return { type: "categories", columns: [...CATEGORY_COLUMNS], rows };
}

function exportProducts(db: Db) {
  // One row per pack size: products by base slug, their pack sizes smallest
  // first, the product columns repeated on every row (8.2).
  const rows = [...db.products]
    .sort((a, b) => a.slug.en.localeCompare(b.slug.en))
    .flatMap((product) => {
      const category = db.categories.find(
        (entry) => entry.id === product.categoryId,
      );
      return sortedVariants(product).map((variant) => ({
        sku: variant.sku,
        gtin: variant.gtin ?? "",
        name_en: product.name.en,
        name_de: product.name.de ?? "",
        slug_en: product.slug.en,
        slug_de: product.slug.de ?? "",
        subtitle_en: product.subtitle?.en ?? "",
        subtitle_de: product.subtitle?.de ?? "",
        short_description_en: product.shortDescription?.en ?? "",
        short_description_de: product.shortDescription?.de ?? "",
        description_en: product.description?.en ?? "",
        description_de: product.description?.de ?? "",
        highlights_en: joined(product.highlights?.en),
        highlights_de: joined(product.highlights?.de),
        uses_en: joined(product.uses?.en),
        uses_de: joined(product.uses?.de),
        brand: product.brand ?? "",
        category_slug: category?.slug.en ?? "",
        pack_value: String(variant.packSize.value),
        pack_unit: variant.packSize.unit,
        variant_enabled: yesNo(variant.isEnabled),
        regular_price: euros(variant.regularPrice),
        sale_price: euros(variant.salePrice),
        discount_percent: "",
        vat_rate: String(product.vatRate / 100),
        status: product.status,
        is_available: yesNo(product.isAvailable),
        is_featured: yesNo(product.isFeatured),
        sort_order: String(product.sortOrder),
        min_order_quantity: String(product.minOrderQuantity),
        max_order_quantity:
          product.maxOrderQuantity === null
            ? ""
            : String(product.maxOrderQuantity),
        stock_quantity: String(variant.stock.quantity),
        low_stock_threshold:
          variant.stock.lowStockThreshold === null
            ? ""
            : String(variant.stock.lowStockThreshold),
        storage_type: product.storageType ?? "ambient",
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
        tags: joined(product.tags),
        search_keywords: joined(product.searchKeywords),
        seo_title_en: product.seo?.title?.en ?? "",
        seo_title_de: product.seo?.title?.de ?? "",
        seo_description_en: product.seo?.description?.en ?? "",
        seo_description_de: product.seo?.description?.de ?? "",
      }));
    });
  return { type: "products", columns: [...PRODUCT_COLUMNS], rows };
}

export function registerCatalogSheets(router: Router): void {
  const base = "/v1/admin/catalog";

  router.post(
    `${base}/import/preview`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const body = await ctx.body(importBody);
      return json(run(ctx.db, body, false, ctx.admin.id, ctx.now));
    },
  );

  router.post(
    `${base}/import`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const body = await ctx.body(importBody);
      return json(run(ctx.db, body, true, ctx.admin.id, ctx.now));
    },
  );

  router.get(`${base}/export`, { permission: "catalog.read" }, (ctx) => {
    const type = ctx.query.get("type");
    if (type === "categories") return json(exportCategories(ctx.db));
    if (type === "products") return json(exportProducts(ctx.db));
    throw fail(400, "VALIDATION_FAILED", "The request contains invalid data.", [
      { field: "type", problems: ["type must be categories or products"] },
    ]);
  });
}

export { text as textOf };
