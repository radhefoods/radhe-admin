// Section 8.2: CSV import and Excel export of the catalogue. The rows of a
// sheet arrive as JSON; the mock checks them like the API does, previews
// what would happen, writes them in the right order, and gives every
// record back as flat rows.

import { z } from "zod";
import type { CategoryRecord, Db, ProductRecord } from "../db.ts";
import { orderedCategories, packLabel } from "../domain.ts";
import { HttpError, fail, json, newId } from "../http.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";
import { recordMovement } from "./stock.ts";
import {
  PACK_UNITS,
  applyProductFields,
  applyVariantOf,
  assertCategorySlugFree,
  assertParent,
  assertProductSlugFree,
  assertQuantities,
  lastPosition,
  logPrice,
  normalSku,
  resolveSale,
  slugify,
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
  "variant_of_sku",
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
function text(row: Row, column: string): string {
  const value = row[column];
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return String(value).trim();
}

/** Reads the typed cells of one row, collecting what is wrong with them. */
class Cells {
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

function unknownColumns(rows: Row[], known: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const row of rows)
    for (const column of Object.keys(row))
      if (!(known as readonly string[]).includes(column)) seen.add(column);
  return [...seen].sort();
}

function summaryOf(rows: RowResult[]) {
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
  if (seo)
    category.seo = {
      title: seo.title ?? category.seo?.title ?? null,
      description: seo.description ?? category.seo?.description ?? null,
    };
  category.updatedAt = iso(now);
  createdIds.set(plan.result.key, category.id);
}

// --- Products ------------------------------------------------------------------

interface ProductPlan {
  result: RowResult;
  existing: ProductRecord | null;
  sku: string | undefined;
  category: undefined | { existingId: string } | { rowKey: string };
  variantOf: undefined | null | { existingId: string } | { rowKey: string };
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
    packValue?: number;
    packUnit?: (typeof PACK_UNITS)[number];
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

function planProducts(
  db: Db,
  rows: Row[],
  categoryRows: Row[],
  existing: Existing,
): ProductPlan[] {
  const plans: ProductPlan[] = [];
  const keys = new Map<string, number>();
  const categoryKeys = categoryRows.map(
    (row) => text(row, "slug_en") || slugify(text(row, "name_en")),
  );
  const fileSkus = rows.map((row) => text(row, "sku").toUpperCase());

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
    const label =
      packValue !== undefined && packUnit ? packLabel(packValue, packUnit) : "";
    const key =
      sku ??
      slugEn ??
      (name?.en && label ? slugify(`${name.en} ${label}`) : "");
    const record = sku
      ? (db.products.find((entry) => entry.sku === sku) ?? null)
      : key
        ? (db.products.find((entry) => entry.slug.en === key) ?? null)
        : null;
    const plan: ProductPlan = {
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
      sku,
      category: undefined,
      variantOf: undefined,
      input: {},
    };
    plans.push(plan);
    if (!key)
      cells.problems.push(
        "sku, slug_en, or name_en with pack_value and pack_unit is required",
      );
    else if (keys.has(key))
      cells.problems.push(`sku or slug: the same as row ${keys.get(key)}`);
    else keys.set(key, index + 1);

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
      packValue,
      packUnit,
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
    const variantOf = text(row, "variant_of_sku").toUpperCase();
    if (variantOf === "NONE") plan.variantOf = null;
    else if (variantOf) {
      if (variantOf === sku)
        cells.problems.push(
          "variant_of_sku: a product cannot be a pack size of itself",
        );
      else {
        const target = db.products.find((entry) => entry.sku === variantOf);
        if (target) plan.variantOf = { existingId: target.id };
        else if (fileSkus.includes(variantOf))
          plan.variantOf = { rowKey: variantOf };
        else
          cells.problems.push(
            `variant_of_sku: "${variantOf}" is neither an existing product nor a row of this file`,
          );
      }
    }

    if (!record) {
      // The slug a new product would get must be free (8): the preview
      // says so; only a slug taken a moment ago stops the import itself.
      const wouldBe =
        slugEn ?? (name?.en && label ? slugify(`${name.en} ${label}`) : "");
      const taken = wouldBe
        ? db.products.find((entry) => entry.slug.en === wouldBe)
        : undefined;
      if (taken)
        cells.problems.push(
          `slug_en: "${wouldBe}" is used by product ${taken.sku} already`,
        );
      for (const [column, present] of [
        ["name_en", Boolean(name?.en)],
        ["category_slug", plan.category !== undefined],
        ["pack_value", packValue !== undefined],
        ["pack_unit", packUnit !== undefined],
        ["regular_price", plan.input.regularPrice !== undefined],
        ["vat_rate", plan.input.vatRate !== undefined],
      ] as const) {
        if (!present)
          cells.problems.push(`${column} is required for a new product`);
      }
    }
  });

  for (const plan of plans) {
    const record = plan.existing;
    if (plan.result.problems.length > 0) {
      plan.result.action = "error";
      continue;
    }
    if (!record) continue;
    const input = plan.input;
    const changes: string[] = [];
    const translatedDiffers = (
      value: { en?: string; de?: string } | undefined,
      current: { en?: string | null; de?: string | null } | null | undefined,
    ) =>
      Boolean(value) &&
      ((value!.en !== undefined && value!.en !== (current?.en ?? undefined)) ||
        (value!.de !== undefined && value!.de !== (current?.de ?? undefined)));
    if (translatedDiffers(input.name, record.name)) changes.push("name");
    if (input.slugEn !== undefined && input.slugEn !== record.slug.en)
      changes.push("slug_en");
    if (input.slugDe !== undefined && input.slugDe !== record.slug.de)
      changes.push("slug_de");
    if (input.gtin !== undefined && input.gtin !== record.gtin)
      changes.push("gtin");
    if (translatedDiffers(input.subtitle, record.subtitle))
      changes.push("subtitle");
    if (translatedDiffers(input.shortDescription, record.shortDescription))
      changes.push("short_description");
    if (translatedDiffers(input.description, record.description))
      changes.push("description");
    if (
      input.highlights &&
      !same(input.highlights, {
        en: record.highlights?.en,
        de: record.highlights?.de,
      })
    )
      changes.push("highlights");
    if (
      input.uses &&
      !same(input.uses, { en: record.uses?.en, de: record.uses?.de })
    )
      changes.push("uses");
    if (input.brand !== undefined && input.brand !== record.brand)
      changes.push("brand");
    if (
      plan.category &&
      "existingId" in plan.category &&
      plan.category.existingId !== record.categoryId
    )
      changes.push("category_slug");
    if (plan.category && "rowKey" in plan.category)
      changes.push("category_slug");
    if (
      input.packValue !== undefined &&
      input.packValue !== record.packSize.value
    )
      changes.push("pack_value");
    if (input.packUnit !== undefined && input.packUnit !== record.packSize.unit)
      changes.push("pack_unit");
    if (plan.variantOf !== undefined) {
      // The main pack size the product follows now, if any.
      const currentMain =
        record.variantGroupId && !record.isDefaultVariant
          ? db.products.find(
              (entry) =>
                entry.variantGroupId === record.variantGroupId &&
                entry.isDefaultVariant,
            )
          : undefined;
      const wanted =
        plan.variantOf === null
          ? null
          : "existingId" in plan.variantOf
            ? plan.variantOf.existingId
            : "(a row of this file)";
      if ((currentMain?.id ?? null) !== wanted) changes.push("variant_of_sku");
    }
    if (
      input.regularPrice !== undefined &&
      input.regularPrice !== record.regularPrice
    )
      changes.push("regular_price");
    if (input.salePrice !== undefined && input.salePrice !== record.salePrice)
      changes.push("sale_price");
    if (input.discountPercent !== undefined) {
      const regular = input.regularPrice ?? record.regularPrice;
      const sale =
        input.discountPercent === null
          ? null
          : Math.round((regular * (100 - input.discountPercent)) / 100);
      if (sale !== record.salePrice) changes.push("discount_percent");
    }
    if (input.vatRate !== undefined && input.vatRate !== record.vatRate)
      changes.push("vat_rate");
    if (input.status !== undefined && input.status !== record.status)
      changes.push("status");
    if (
      input.isAvailable !== undefined &&
      input.isAvailable !== record.isAvailable
    )
      changes.push("is_available");
    if (
      input.isFeatured !== undefined &&
      input.isFeatured !== record.isFeatured
    )
      changes.push("is_featured");
    if (input.sortOrder !== undefined && input.sortOrder !== record.sortOrder)
      changes.push("sort_order");
    if (
      input.minOrderQuantity !== undefined &&
      input.minOrderQuantity !== record.minOrderQuantity
    )
      changes.push("min_order_quantity");
    if (
      input.maxOrderQuantity !== undefined &&
      input.maxOrderQuantity !== record.maxOrderQuantity
    )
      changes.push("max_order_quantity");
    if (
      input.stockQuantity !== undefined &&
      input.stockQuantity !== record.stock.quantity
    )
      changes.push("stock");
    if (
      input.lowStockThreshold !== undefined &&
      input.lowStockThreshold !== record.stock.lowStockThreshold
    )
      changes.push("lowStockThreshold");
    if (
      input.storageType !== undefined &&
      input.storageType !== record.storageType
    )
      changes.push("storage_type");
    if (input.food) {
      for (const [stem, value] of Object.entries(input.food)) {
        const current =
          record.food?.[
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
          changes.push(stem);
      }
    }
    if (input.tags && !same(input.tags, record.tags)) changes.push("tags");
    if (
      input.searchKeywords &&
      !same(input.searchKeywords, record.searchKeywords)
    )
      changes.push("search_keywords");
    if (translatedDiffers(input.seoTitle, record.seo?.title))
      changes.push("seo_title");
    if (translatedDiffers(input.seoDescription, record.seo?.description))
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

function listPair(cells: Cells, stem: string) {
  const en = cells.list(`${stem}_en`, 20);
  const de = cells.list(`${stem}_de`, 20);
  if (!en && !de) return undefined;
  return { ...(en ? { en } : {}), ...(de ? { de } : {}) };
}

const toCamel = (stem: string) =>
  stem.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** Main pack sizes before the sizes that join them, whatever the order of the file. */
function orderProductPlans(plans: ProductPlan[]): ProductPlan[] {
  const done = new Set<string>();
  const ordered: ProductPlan[] = [];
  let pending = plans.filter((plan) => plan.result.action !== "error");
  while (pending.length > 0) {
    const ready = pending.filter(
      (plan) =>
        !(plan.variantOf && "rowKey" in plan.variantOf) ||
        done.has(plan.variantOf.rowKey),
    );
    if (ready.length === 0) break;
    for (const plan of ready) {
      ordered.push(plan);
      if (plan.sku) done.add(plan.sku);
    }
    pending = pending.filter((plan) => !ready.includes(plan));
  }
  return ordered;
}

function writeProduct(
  db: Db,
  plan: ProductPlan,
  categoryIds: Map<string, string>,
  createdBySku: Map<string, string>,
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
  const variantOf =
    plan.variantOf === undefined
      ? undefined
      : plan.variantOf === null
        ? null
        : "existingId" in plan.variantOf
          ? plan.variantOf.existingId
          : (createdBySku.get(plan.variantOf.rowKey) ?? null);
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
  const fields = {
    gtin: input.gtin,
    subtitle: input.subtitle,
    shortDescription: input.shortDescription,
    description: input.description,
    highlights: input.highlights,
    uses: input.uses,
    brand: input.brand,
    isAvailable: input.isAvailable,
    isFeatured: input.isFeatured,
    sortOrder: input.sortOrder,
    lowStockThreshold: input.lowStockThreshold,
    storageType: input.storageType,
    tags: input.tags,
    searchKeywords: input.searchKeywords,
    seo:
      input.seoTitle || input.seoDescription
        ? { title: input.seoTitle, description: input.seoDescription }
        : undefined,
    food,
  };

  if (!plan.existing) {
    const regularPrice = input.regularPrice!;
    const salePrice = resolveSale(regularPrice, input, null);
    const min = input.minOrderQuantity ?? 1;
    const max = input.maxOrderQuantity ?? null;
    assertQuantities(min, max);
    const sku = normalSku(db, plan.sku);
    const label = packLabel(input.packValue!, input.packUnit!);
    const name = { en: input.name!.en!, de: input.name?.de ?? null };
    const slug = {
      en: input.slugEn ?? slugify(`${name.en} ${label}`),
      de: input.slugDe ?? (name.de ? slugify(`${name.de} ${label}`) : null),
    };
    assertProductSlugFree(db, slug);
    const status = input.status ?? "draft";
    const product: ProductRecord = {
      id: newId(now),
      sku,
      gtin: null,
      name,
      slug,
      brand: null,
      packSize: { value: input.packValue!, unit: input.packUnit!, label },
      regularPrice,
      salePrice,
      vatRate: input.vatRate!,
      status,
      isAvailable: true,
      isFeatured: false,
      sortOrder: 0,
      variantGroupId: null,
      isDefaultVariant: true,
      subtitle: null,
      shortDescription: null,
      description: null,
      highlights: null,
      uses: null,
      categoryId: categoryId!,
      minOrderQuantity: min,
      maxOrderQuantity: max,
      storageType: "ambient",
      stock: { quantity: 0, lowStockThreshold: null },
      food: null,
      tags: [],
      searchKeywords: [],
      seo: null,
      images: [],
      publishedAt: status === "active" ? iso(now) : null,
      createdAt: iso(now),
      updatedAt: iso(now),
    };
    applyProductFields(product, fields);
    db.products.push(product);
    if (variantOf) applyVariantOf(db, product, variantOf);
    logPrice(db, product, adminId, now);
    // A new product with a count starts its history with a restock (8.2).
    if (input.stockQuantity) {
      recordMovement(
        db,
        product,
        "restock",
        input.stockQuantity,
        { adminId, note: "CSV import" },
        now,
      );
    }
    plan.result.id = product.id;
    createdBySku.set(product.sku, product.id);
    return;
  }

  const product = plan.existing;
  const regularPrice = input.regularPrice ?? product.regularPrice;
  const salePrice = resolveSale(regularPrice, input, product.salePrice);
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
    assertProductSlugFree(db, slug, product.id);
    product.slug = slug;
  }
  if (variantOf !== undefined) applyVariantOf(db, product, variantOf);
  const vatRate = input.vatRate ?? product.vatRate;
  const priceChanged =
    regularPrice !== product.regularPrice ||
    salePrice !== product.salePrice ||
    vatRate !== product.vatRate;
  product.regularPrice = regularPrice;
  product.salePrice = salePrice;
  product.vatRate = vatRate;
  product.minOrderQuantity = min;
  product.maxOrderQuantity = max;
  if (input.name)
    product.name = {
      en: input.name.en ?? product.name.en,
      de: input.name.de ?? product.name.de ?? null,
    };
  if (categoryId !== undefined) product.categoryId = categoryId;
  if (input.packValue !== undefined || input.packUnit !== undefined) {
    const value = input.packValue ?? product.packSize.value;
    const unit = input.packUnit ?? product.packSize.unit;
    product.packSize = { value, unit, label: packLabel(value, unit) };
  }
  if (input.status !== undefined) {
    product.status = input.status;
    if (input.status === "active") product.publishedAt ??= iso(now);
  }
  applyProductFields(product, fields);
  product.updatedAt = iso(now);
  if (priceChanged) logPrice(db, product, adminId, now);
  // A changed count is recorded as an import movement (8.2).
  if (
    input.stockQuantity !== undefined &&
    input.stockQuantity !== product.stock.quantity
  ) {
    recordMovement(
      db,
      product,
      "import",
      input.stockQuantity - product.stock.quantity,
      { adminId, note: "CSV import" },
      now,
    );
  }
  createdBySku.set(product.sku, product.id);
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
    const createdBySku = new Map<string, string>();
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
          writeProduct(db, plan, categoryIds, createdBySku, adminId, now);
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
      seo_title_en: category.seo?.title?.en ?? "",
      seo_title_de: category.seo?.title?.de ?? "",
      seo_description_en: category.seo?.description?.en ?? "",
      seo_description_de: category.seo?.description?.de ?? "",
    };
  });
  return { type: "categories", columns: [...CATEGORY_COLUMNS], rows };
}

function exportProducts(db: Db) {
  const rows = [...db.products]
    .sort((a, b) => a.sku.localeCompare(b.sku))
    .map((product) => {
      const category = db.categories.find(
        (entry) => entry.id === product.categoryId,
      );
      const main =
        product.variantGroupId && !product.isDefaultVariant
          ? db.products.find(
              (entry) =>
                entry.variantGroupId === product.variantGroupId &&
                entry.isDefaultVariant,
            )
          : undefined;
      return {
        sku: product.sku,
        gtin: product.gtin ?? "",
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
        pack_value: String(product.packSize.value),
        pack_unit: product.packSize.unit,
        variant_of_sku: main?.sku ?? "",
        regular_price: euros(product.regularPrice),
        sale_price: euros(product.salePrice),
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
        stock_quantity: String(product.stock.quantity),
        low_stock_threshold:
          product.stock.lowStockThreshold === null
            ? ""
            : String(product.stock.lowStockThreshold),
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
      };
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
