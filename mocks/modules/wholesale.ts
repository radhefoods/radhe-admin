// Section 25: the wholesale catalogue (doc/WHOLESALE_CATALOG.md): wholesale
// categories, wholesale products with SKUs, their stock ledger, pictures,
// the order per category, Copy from retail and the public catalogue the
// wholesale site reads.

import { z } from "zod";
import type {
  AdminImage,
  PackUnit,
  ProductStatus,
  StorageType,
  TranslatedOptional,
  WholesaleCategory,
  WholesaleProductDetail,
  WholesaleProductSummary,
  WholesaleSku,
  WholesaleStockMovement,
  WholesaleStockReason,
} from "../../src/lib/api/types/index.ts";
import type { Db } from "../db.ts";
import { UNIT_FAMILY, baseQuantity, packLabel } from "../domain.ts";
import {
  HttpError,
  boolParam,
  enumParam,
  fail,
  idParam,
  json,
  newId,
  noContent,
  page,
  validationFailed,
  zId,
  zTranslated,
  zTranslatedOptional,
} from "../http.ts";
import { readImage, storeImage, uploadedFiles } from "../media.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";
import { PACK_UNITS, slugify } from "./catalog.ts";

// --- Records -----------------------------------------------------------------

export interface WholesaleCategoryRecord {
  id: string;
  name: { en: string; de?: string | null };
  slug: { en: string; de: string };
  description: TranslatedOptional | null;
  sortOrder: number;
  isVisible: boolean;
  image: AdminImage | null;
  createdAt: string;
  updatedAt: string;
}

export interface WholesaleSkuRecord {
  id: string;
  sku: string;
  packSize: { value: number; unit: PackUnit; label: string };
  unitsPerCarton: number;
  isEnabled: boolean;
  /** Cartons on hand; below zero is a shortage. Written only through the ledger. */
  stock: number;
  createdAt: string;
}

export interface WholesaleProductRecord {
  id: string;
  name: { en: string; de?: string | null };
  slug: { en: string; de: string };
  subtitle: TranslatedOptional | null;
  shortDescription: TranslatedOptional | null;
  description: TranslatedOptional | null;
  highlights: { en: string[]; de: string[] };
  brand: string | null;
  categoryId: string;
  skus: WholesaleSkuRecord[];
  vatRate: number;
  status: ProductStatus;
  isAvailable: boolean;
  sortOrder: number;
  storageType: StorageType;
  images: AdminImage[];
  food: WholesaleProductDetail["food"];
  searchKeywords: string[];
  retailProductId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type WholesaleStockMovementRecord = WholesaleStockMovement;

// --- Schemas -------------------------------------------------------------------

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKU = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
const zSlug = z.strictObject({
  en: z
    .string()
    .max(120)
    .regex(SLUG, "slug must use lower-case letters, digits and single hyphens")
    .nullish(),
  de: z
    .string()
    .max(120)
    .regex(SLUG, "slug must use lower-case letters, digits and single hyphens")
    .nullish(),
});
const zPack = z.strictObject({
  value: z
    .number()
    .min(0.001)
    .max(1_000_000)
    .refine(
      (value) => Math.round(value * 1000) === value * 1000,
      "value must have at most 3 decimals",
    ),
  unit: z.enum(PACK_UNITS),
});
const zStock = z.number().int().min(-1_000_000).max(1_000_000);
const zList = z.strictObject({
  en: z.array(z.string().min(1).max(200)).max(20).optional(),
  de: z.array(z.string().min(1).max(200)).max(20).optional(),
});

const categoryFields = {
  slug: zSlug.optional(),
  description: zTranslatedOptional(20000).optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isVisible: z.boolean().optional(),
};
const createCategory = z.strictObject({
  name: zTranslated(160),
  ...categoryFields,
});
const updateCategory = z.strictObject({
  name: zTranslated(160).optional(),
  ...categoryFields,
});

const skuFields = {
  sku: z.string().optional(),
  unitsPerCarton: z.number().int().min(1).max(1000),
  isEnabled: z.boolean().optional(),
};
const zCreateSku = z.strictObject({
  packSize: zPack,
  stock: zStock.optional(),
  ...skuFields,
});
const zUpdateSku = z.strictObject({
  packSize: zPack.optional(),
  sku: z.string().optional(),
  unitsPerCarton: z.number().int().min(1).max(1000).optional(),
  isEnabled: z.boolean().optional(),
});

const productFields = {
  slug: zSlug.optional(),
  subtitle: zTranslatedOptional(300).optional(),
  shortDescription: zTranslatedOptional(300).optional(),
  description: zTranslatedOptional(20000).optional(),
  highlights: zList.optional(),
  brand: z.string().max(80).nullish(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  storageType: z.enum(["ambient", "chilled", "frozen"]).optional(),
  food: z
    .strictObject({
      ingredients: zTranslatedOptional(20000).optional(),
      allergens: zTranslatedOptional(20000).optional(),
      nutrition: zTranslatedOptional(20000).optional(),
      storageInstructions: zTranslatedOptional(20000).optional(),
      origin: z.string().max(120).optional(),
      manufacturer: z.string().max(500).optional(),
    })
    .optional(),
  searchKeywords: z.array(z.string().min(2).max(60)).max(30).optional(),
};
const createProduct = z.strictObject({
  name: zTranslated(160),
  categoryId: zId,
  skus: z.array(zCreateSku).min(1).max(20),
  vatRate: z.number().int().min(0).max(10000),
  ...productFields,
});
const updateProduct = z.strictObject({
  name: zTranslated(160).optional(),
  categoryId: zId.optional(),
  vatRate: z.number().int().min(0).max(10000).optional(),
  ...productFields,
});
const fromRetail = z.strictObject({
  productId: zId,
  categoryId: zId,
  skus: z
    .array(
      z.strictObject({
        packSize: zPack,
        unitsPerCarton: z.number().int().min(1).max(1000),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  copyImages: z.boolean().optional(),
});
const stockChange = z.strictObject({
  quantity: zStock.optional(),
  delta: zStock.optional(),
  note: z.string().max(500).optional(),
});
const imagePatch = z.strictObject({
  alt: zTranslatedOptional(300).optional(),
  isPrimary: z.literal(true, "isPrimary may only be true").optional(),
});

type ProductInput = z.output<typeof updateProduct>;
type SkuInput = z.output<typeof zCreateSku>;
type SkuPatch = z.output<typeof zUpdateSku>;

// --- Views -----------------------------------------------------------------------

/** A number without trailing zeros: 1.5, 20, 0.25. */
function plainNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

/** The carton of a SKU: `units` packs, the content in kg or l from 1000 g or 1000 ml on. */
export function cartonOf(
  sku: Pick<WholesaleSkuRecord, "unitsPerCarton" | "packSize">,
) {
  const units = sku.unitsPerCarton;
  const pack = sku.packSize;
  let value = units * pack.value;
  let unit: PackUnit = pack.unit;
  if ((unit === "g" || unit === "ml") && value >= 1000) {
    value /= 1000;
    unit = unit === "g" ? "kg" : "l";
  }
  value = Number(value.toFixed(3));
  return {
    units,
    label: `${units} × ${pack.label}`,
    content: { value, unit, label: `${plainNumber(value)} ${unit}` },
  };
}

/** Smallest pack first, then the smaller carton. */
export function sortedSkus(
  product: WholesaleProductRecord,
): WholesaleSkuRecord[] {
  return [...product.skus].sort(
    (a, b) =>
      baseQuantity(a.packSize) - baseQuantity(b.packSize) ||
      a.unitsPerCarton - b.unitsPerCarton,
  );
}

export function skuView(sku: WholesaleSkuRecord): WholesaleSku {
  return {
    id: sku.id,
    sku: sku.sku,
    packSize: sku.packSize,
    unitsPerCarton: sku.unitsPerCarton,
    carton: cartonOf(sku),
    isEnabled: sku.isEnabled,
    stock: sku.stock,
    createdAt: sku.createdAt,
  };
}

function stockOverview(product: WholesaleProductRecord) {
  return {
    quantity: product.skus.reduce((sum, sku) => sum + sku.stock, 0),
    shortSkus: product.skus.filter((sku) => sku.stock < 0).length,
  };
}

export function wholesaleProductSummary(
  db: Db,
  product: WholesaleProductRecord,
): WholesaleProductSummary {
  const category = db.wholesaleCategories.find(
    (entry) => entry.id === product.categoryId,
  );
  const primary =
    product.images.find((image) => image.isPrimary) ?? product.images[0];
  const skus = sortedSkus(product).map(skuView);
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    category: {
      id: product.categoryId,
      name: category?.name ?? { en: "Unknown" },
    },
    status: product.status,
    isAvailable: product.isAvailable,
    sortOrder: product.sortOrder,
    vatRate: product.vatRate,
    skus,
    skuCount: skus.length,
    stock: stockOverview(product),
    imageCount: product.images.length,
    image: primary
      ? {
          id: primary.id,
          alt: primary.alt.en ?? product.name.en,
          isPrimary: true,
          url: primary.url,
          sizes: primary.sizes,
        }
      : null,
    retailProductId: product.retailProductId,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export function wholesaleProductDetail(
  db: Db,
  product: WholesaleProductRecord,
): WholesaleProductDetail {
  return {
    ...wholesaleProductSummary(db, product),
    subtitle: product.subtitle,
    shortDescription: product.shortDescription,
    description: product.description,
    highlights: product.highlights,
    categoryId: product.categoryId,
    storageType: product.storageType,
    food: product.food,
    searchKeywords: product.searchKeywords,
    images: product.images,
    publishedAt: product.publishedAt,
  };
}

export function wholesaleCategoryView(
  db: Db,
  category: WholesaleCategoryRecord,
): WholesaleCategory {
  return {
    ...category,
    productCount: db.wholesaleProducts.filter(
      (product) => product.categoryId === category.id,
    ).length,
  };
}

export function orderedWholesaleCategories(db: Db): WholesaleCategoryRecord[] {
  return [...db.wholesaleCategories].sort(
    (a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? 1 : -1),
  );
}

/** The products of a category in display order: position, then newest first. */
export function wholesaleCategoryProducts(
  db: Db,
  categoryId: string,
): WholesaleProductRecord[] {
  return db.wholesaleProducts
    .filter((product) => product.categoryId === categoryId)
    .sort((a, b) => a.sortOrder - b.sortOrder || (a.id < b.id ? 1 : -1));
}

// --- Rules ----------------------------------------------------------------------

function categoryById(db: Db, id: string): WholesaleCategoryRecord {
  const category = db.wholesaleCategories.find((entry) => entry.id === id);
  if (!category) {
    throw fail(
      404,
      "WHOLESALE_CATEGORY_NOT_FOUND",
      "The wholesale category was not found.",
    );
  }
  return category;
}

function productById(db: Db, id: string): WholesaleProductRecord {
  const product = db.wholesaleProducts.find((entry) => entry.id === id);
  if (!product) {
    throw fail(
      404,
      "WHOLESALE_PRODUCT_NOT_FOUND",
      "The wholesale product was not found.",
    );
  }
  return product;
}

function skuById(
  product: WholesaleProductRecord,
  id: string,
): WholesaleSkuRecord {
  const sku = product.skus.find((entry) => entry.id === id);
  if (!sku)
    throw fail(404, "WHOLESALE_SKU_NOT_FOUND", "The SKU was not found.");
  return sku;
}

/** The wholesale product and SKU an id names, for the quotations. */
export function wholesaleSkuOf(
  db: Db,
  skuId: string,
): { product: WholesaleProductRecord; sku: WholesaleSkuRecord } | undefined {
  for (const product of db.wholesaleProducts) {
    const sku = product.skus.find((entry) => entry.id === skuId);
    if (sku) return { product, sku };
  }
  return undefined;
}

export function wholesaleSkuByCode(
  db: Db,
  code: string,
): { product: WholesaleProductRecord; sku: WholesaleSkuRecord } | undefined {
  for (const product of db.wholesaleProducts) {
    const sku = product.skus.find((entry) => entry.sku === code);
    if (sku) return { product, sku };
  }
  return undefined;
}

function assertCategorySlugFree(
  db: Db,
  slug: { en: string; de: string },
  exceptId?: string,
): void {
  const taken = db.wholesaleCategories.some(
    (entry) =>
      entry.id !== exceptId &&
      (entry.slug.en === slug.en || entry.slug.de === slug.de),
  );
  if (taken) {
    throw fail(
      409,
      "WHOLESALE_CATEGORY_SLUG_TAKEN",
      "Another wholesale category uses this slug.",
    );
  }
}

function assertProductSlugFree(
  db: Db,
  slug: { en: string; de: string },
  exceptId?: string,
): void {
  const taken = db.wholesaleProducts.some(
    (entry) =>
      entry.id !== exceptId &&
      (entry.slug.en === slug.en || entry.slug.de === slug.de),
  );
  if (taken) {
    throw fail(
      409,
      "WHOLESALE_PRODUCT_SLUG_TAKEN",
      "Another wholesale product uses this slug.",
    );
  }
}

/** A slug of its own: `moong-dal`, then `moong-dal-2` for a second copy. */
function freeSlug(taken: (slug: string) => boolean, wanted: string): string {
  if (!taken(wanted)) return wanted;
  for (let index = 2; ; index += 1) {
    const candidate = `${wanted}-${index}`;
    if (!taken(candidate)) return candidate;
  }
}

/** The article number as the API stores it: upper-cased, checked, free across the catalogue. */
export function normalWholesaleSku(
  db: Db,
  sku: string | undefined,
  exceptSkuId?: string,
): string {
  if (sku === undefined) {
    do {
      db.counters.wholesaleSku += 1;
    } while (
      wholesaleSkuByCode(
        db,
        `RFW-${String(db.counters.wholesaleSku).padStart(5, "0")}`,
      )
    );
    return `RFW-${String(db.counters.wholesaleSku).padStart(5, "0")}`;
  }
  const upper = sku.toUpperCase();
  if (!SKU.test(upper)) {
    throw validationFailed([
      {
        field: "sku",
        problems: ["sku must match ^[A-Z0-9][A-Z0-9._-]{1,39}$"],
      },
    ]);
  }
  const taken = wholesaleSkuByCode(db, upper);
  if (taken && taken.sku.id !== exceptSkuId) {
    throw fail(
      409,
      "WHOLESALE_SKU_TAKEN",
      "Another wholesale product has this article number.",
    );
  }
  return upper;
}

/**
 * The rules of the SKU set (section 10): one unit family, no pack with the
 * same carton twice, no article number twice in one product, at most 20.
 */
export function assertSkuSet(
  skus: {
    packSize: { value: number; unit: PackUnit };
    unitsPerCarton: number;
    sku?: string;
  }[],
): void {
  if (skus.length > 20) {
    throw fail(400, "WHOLESALE_SKU_INVALID", "A product has at most 20 SKUs.");
  }
  const families = [
    ...new Set(skus.map((entry) => UNIT_FAMILY[entry.packSize.unit])),
  ];
  if (families.length > 1) {
    throw fail(
      400,
      "WHOLESALE_SKU_INVALID",
      "The SKUs of a product must be of one unit family.",
      { families },
    );
  }
  const seen = new Set<string>();
  for (const entry of skus) {
    const key = `${baseQuantity(entry.packSize)}×${entry.unitsPerCarton}`;
    if (seen.has(key)) {
      throw fail(
        400,
        "WHOLESALE_SKU_INVALID",
        "The same pack size with the same carton appears twice.",
        { baseQuantity: baseQuantity(entry.packSize) },
      );
    }
    seen.add(key);
  }
  const named = skus
    .map((entry) => entry.sku?.toUpperCase())
    .filter((sku): sku is string => sku !== undefined);
  const twice = named.find((sku, index) => named.indexOf(sku) !== index);
  if (twice) {
    throw fail(
      400,
      "WHOLESALE_SKU_INVALID",
      "The same article number appears twice.",
      { sku: twice },
    );
  }
}

function lastCategoryPosition(db: Db): number {
  return db.wholesaleCategories.length === 0
    ? 0
    : Math.max(...db.wholesaleCategories.map((entry) => entry.sortOrder)) + 1;
}

export function nextWholesalePosition(db: Db, categoryId: string): number {
  const positions = db.wholesaleProducts
    .filter((product) => product.categoryId === categoryId)
    .map((product) => product.sortOrder);
  return positions.length === 0 ? 0 : Math.max(...positions) + 1;
}

// --- The stock ledger (section 8) ----------------------------------------------

/** Changes the cartons of a SKU by `delta` and writes the line of the ledger. */
export function recordWholesaleMovement(
  db: Db,
  product: WholesaleProductRecord,
  sku: WholesaleSkuRecord,
  reason: WholesaleStockReason,
  delta: number,
  context: {
    adminId?: string | null;
    note?: string | null;
    quotationId?: string | null;
    quotationNumber?: string | null;
  },
  now: number,
): WholesaleStockMovementRecord {
  const before = sku.stock;
  sku.stock += delta;
  product.updatedAt = iso(now);
  const movement: WholesaleStockMovementRecord = {
    id: newId(now),
    productId: product.id,
    skuId: sku.id,
    sku: sku.sku,
    reason,
    delta,
    quantityBefore: before,
    quantityAfter: sku.stock,
    quotationId: context.quotationId ?? null,
    quotationNumber: context.quotationNumber ?? null,
    adminId: context.adminId ?? null,
    note: context.note ?? null,
    createdAt: iso(now),
  };
  db.wholesaleStockMovements.push(movement);
  return movement;
}

/** A new SKU of a product, with its article number and, with an opening count, its first ledger line. */
export function createWholesaleSku(
  db: Db,
  product: WholesaleProductRecord,
  input: SkuInput,
  adminId: string,
  now: number,
  reason: WholesaleStockReason = "adjustment",
): WholesaleSkuRecord {
  const sku: WholesaleSkuRecord = {
    id: newId(now + product.skus.length),
    sku: normalWholesaleSku(db, input.sku),
    packSize: {
      ...input.packSize,
      label: packLabel(input.packSize.value, input.packSize.unit),
    },
    unitsPerCarton: input.unitsPerCarton,
    isEnabled: input.isEnabled ?? true,
    stock: 0,
    createdAt: iso(now),
  };
  product.skus.push(sku);
  if (input.stock) {
    recordWholesaleMovement(
      db,
      product,
      sku,
      reason,
      input.stock,
      { adminId, note: "Opening stock" },
      now,
    );
  }
  return sku;
}

export function applyWholesaleSkuPatch(
  db: Db,
  product: WholesaleProductRecord,
  sku: WholesaleSkuRecord,
  input: SkuPatch,
  now: number,
): void {
  const code =
    input.sku === undefined
      ? sku.sku
      : normalWholesaleSku(db, input.sku, sku.id);
  const packSize = input.packSize
    ? {
        ...input.packSize,
        label: packLabel(input.packSize.value, input.packSize.unit),
      }
    : sku.packSize;
  const unitsPerCarton = input.unitsPerCarton ?? sku.unitsPerCarton;
  const others = product.skus.filter((entry) => entry.id !== sku.id);
  assertSkuSet([
    ...others.map((entry) => ({
      packSize: entry.packSize,
      unitsPerCarton: entry.unitsPerCarton,
      sku: entry.sku,
    })),
    { packSize, unitsPerCarton, sku: code },
  ]);
  sku.sku = code;
  sku.packSize = packSize;
  sku.unitsPerCarton = unitsPerCarton;
  if (input.isEnabled !== undefined) sku.isEnabled = input.isEnabled;
  product.updatedAt = iso(now);
}

export function applyWholesaleProductFields(
  product: WholesaleProductRecord,
  input: ProductInput,
): void {
  if (input.name !== undefined) product.name = input.name;
  if (input.subtitle !== undefined) product.subtitle = input.subtitle;
  if (input.shortDescription !== undefined)
    product.shortDescription = input.shortDescription;
  if (input.description !== undefined) product.description = input.description;
  if (input.highlights !== undefined)
    product.highlights = {
      en: input.highlights.en ?? [],
      de: input.highlights.de ?? [],
    };
  if (input.brand !== undefined) product.brand = input.brand;
  if (input.isAvailable !== undefined) product.isAvailable = input.isAvailable;
  if (input.sortOrder !== undefined) product.sortOrder = input.sortOrder;
  if (input.storageType !== undefined) product.storageType = input.storageType;
  if (input.searchKeywords !== undefined)
    product.searchKeywords = input.searchKeywords;
  if (input.food !== undefined) {
    product.food = {
      ingredients: input.food.ingredients ?? null,
      allergens: input.food.allergens ?? null,
      nutrition: input.food.nutrition ?? null,
      storageInstructions: input.food.storageInstructions ?? null,
      origin: input.food.origin ?? null,
      manufacturer: input.food.manufacturer ?? null,
    };
  }
}

function matchesSearch(product: WholesaleProductRecord, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const skus = product.skus.map((sku) => sku.sku);
  const haystack = [
    product.name.en,
    product.name.de ?? "",
    product.subtitle?.en ?? "",
    product.brand ?? "",
    ...product.searchKeywords,
  ]
    .join(" ")
    .toLowerCase()
    .split(/[\s-]+/);
  return (
    skus.some((sku) => sku.toLowerCase().startsWith(q.toLowerCase())) ||
    words.every((word) => haystack.some((token) => token.startsWith(word)))
  );
}

function imageOf(product: WholesaleProductRecord, imageId: string): AdminImage {
  const image = product.images.find((entry) => entry.id === imageId);
  if (!image) throw fail(404, "IMAGE_NOT_FOUND", "The image was not found.");
  return image;
}

function ensurePrimary(product: WholesaleProductRecord): void {
  if (
    product.images.length > 0 &&
    !product.images.some((image) => image.isPrimary)
  ) {
    product.images[0]!.isPrimary = true;
  }
}

/** A new wholesale product with its SKUs (section 4). */
export function createWholesaleProduct(
  db: Db,
  input: z.output<typeof createProduct>,
  adminId: string,
  now: number,
  extra: { retailProductId?: string | null; images?: AdminImage[] } = {},
): WholesaleProductRecord {
  categoryById(db, input.categoryId);
  assertSkuSet(input.skus);
  const takenSlug = (slug: string) =>
    db.wholesaleProducts.some(
      (entry) => entry.slug.en === slug || entry.slug.de === slug,
    );
  const slug = {
    en: input.slug?.en ?? freeSlug(takenSlug, slugify(input.name.en)),
    de:
      input.slug?.de ??
      freeSlug(
        takenSlug,
        input.name.de ? slugify(input.name.de) : slugify(input.name.en),
      ),
  };
  if (input.slug?.en || input.slug?.de) assertProductSlugFree(db, slug);
  const status = input.status ?? "draft";
  const product: WholesaleProductRecord = {
    id: newId(now),
    name: input.name,
    slug,
    subtitle: null,
    shortDescription: null,
    description: null,
    highlights: { en: [], de: [] },
    brand: null,
    categoryId: input.categoryId,
    skus: [],
    vatRate: input.vatRate,
    status,
    isAvailable: true,
    sortOrder: input.sortOrder ?? nextWholesalePosition(db, input.categoryId),
    storageType: "ambient",
    images: extra.images ?? [],
    food: null,
    searchKeywords: [],
    retailProductId: extra.retailProductId ?? null,
    publishedAt: status === "active" ? iso(now) : null,
    createdAt: iso(now),
    updatedAt: iso(now),
  };
  applyWholesaleProductFields(product, input);
  for (const sku of input.skus)
    createWholesaleSku(db, product, sku, adminId, now);
  db.wholesaleProducts.push(product);
  return product;
}

// --- Routes ---------------------------------------------------------------------

export function registerWholesale(router: Router): void {
  const categories = "/v1/admin/wholesale/categories";
  const products = "/v1/admin/wholesale/products";
  const READ = { permission: "wholesale.read" };
  const MANAGE = { permission: "wholesale.manage" };

  // --- Categories (section 3) ----------------------------------------------

  router.get(categories, READ, (ctx) =>
    json({
      items: orderedWholesaleCategories(ctx.db).map((entry) =>
        wholesaleCategoryView(ctx.db, entry),
      ),
    }),
  );

  router.post(categories, MANAGE, async (ctx) => {
    const input = await ctx.body(createCategory);
    const slug = {
      en: input.slug?.en ?? slugify(input.name.en),
      de:
        input.slug?.de ??
        (input.name.de ? slugify(input.name.de) : slugify(input.name.en)),
    };
    assertCategorySlugFree(ctx.db, slug);
    const category: WholesaleCategoryRecord = {
      id: newId(ctx.now),
      name: input.name,
      slug,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? lastCategoryPosition(ctx.db),
      isVisible: input.isVisible ?? true,
      image: null,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.wholesaleCategories.push(category);
    return json({ category: wholesaleCategoryView(ctx.db, category) }, 201);
  });

  router.put(`${categories}/order`, MANAGE, async (ctx) => {
    const input = await ctx.body(
      z.strictObject({ orderedIds: z.array(zId).min(1).max(500) }),
    );
    if (new Set(input.orderedIds).size !== input.orderedIds.length) {
      throw validationFailed([
        { field: "orderedIds", problems: ["must not repeat an id"] },
      ]);
    }
    const current = orderedWholesaleCategories(ctx.db);
    const expected = current.map((entry) => entry.id);
    const unknown = input.orderedIds.filter((id) => !expected.includes(id));
    if (unknown.length > 0) {
      throw fail(
        400,
        "WHOLESALE_CATEGORY_ORDER_INVALID",
        "orderedIds names ids that are not wholesale categories.",
        { unknown, expected },
      );
    }
    const named = new Set(input.orderedIds);
    const ordered = [
      ...input.orderedIds.map((id) =>
        current.find((entry) => entry.id === id)!,
      ),
      ...current.filter((entry) => !named.has(entry.id)),
    ];
    ordered.forEach((entry, index) => {
      entry.sortOrder = index;
    });
    return json({
      items: ordered.map((entry) => wholesaleCategoryView(ctx.db, entry)),
    });
  });

  router.get(`${categories}/:id`, READ, (ctx) =>
    json({
      category: wholesaleCategoryView(
        ctx.db,
        categoryById(ctx.db, ctx.params.id ?? ""),
      ),
    }),
  );

  router.patch(`${categories}/:id`, MANAGE, async (ctx) => {
    const input = await ctx.body(updateCategory);
    const category = categoryById(ctx.db, ctx.params.id ?? "");
    if (input.name !== undefined) category.name = input.name;
    if (input.slug !== undefined) {
      const slug = {
        en: input.slug.en ?? category.slug.en,
        de: input.slug.de ?? category.slug.de,
      };
      assertCategorySlugFree(ctx.db, slug, category.id);
      category.slug = slug;
    }
    if (input.description !== undefined)
      category.description = input.description;
    if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
    if (input.isVisible !== undefined) category.isVisible = input.isVisible;
    category.updatedAt = iso(ctx.now);
    return json({ category: wholesaleCategoryView(ctx.db, category) });
  });

  router.delete(`${categories}/:id`, MANAGE, (ctx) => {
    const category = categoryById(ctx.db, ctx.params.id ?? "");
    if (
      ctx.db.wholesaleProducts.some(
        (product) => product.categoryId === category.id,
      )
    ) {
      throw fail(
        409,
        "WHOLESALE_CATEGORY_HAS_PRODUCTS",
        "The category has products.",
      );
    }
    ctx.db.wholesaleCategories = ctx.db.wholesaleCategories.filter(
      (entry) => entry.id !== category.id,
    );
    return noContent();
  });

  router.put(`${categories}/:id/image`, MANAGE, async (ctx) => {
    const category = categoryById(ctx.db, ctx.params.id ?? "");
    const [file] = await uploadedFiles(ctx.request, "file", 1);
    const image = storeImage(ctx.db, await readImage(file as File), ctx.now);
    category.image = {
      ...image,
      alt: category.image?.alt ?? image.alt,
      isPrimary: true,
    };
    category.updatedAt = iso(ctx.now);
    return json({ category: wholesaleCategoryView(ctx.db, category) });
  });

  router.patch(`${categories}/:id/image`, MANAGE, async (ctx) => {
    const input = await ctx.body(
      z.strictObject({ alt: zTranslatedOptional(300) }),
    );
    const category = categoryById(ctx.db, ctx.params.id ?? "");
    if (!category.image)
      throw fail(404, "IMAGE_NOT_FOUND", "The category has no image.");
    category.image.alt = { ...category.image.alt, ...input.alt };
    category.updatedAt = iso(ctx.now);
    return json({ category: wholesaleCategoryView(ctx.db, category) });
  });

  router.delete(`${categories}/:id/image`, MANAGE, (ctx) => {
    const category = categoryById(ctx.db, ctx.params.id ?? "");
    if (!category.image)
      throw fail(404, "IMAGE_NOT_FOUND", "The category has no image.");
    category.image = null;
    category.updatedAt = iso(ctx.now);
    return json({ category: wholesaleCategoryView(ctx.db, category) });
  });

  router.get(`${categories}/:id/products`, READ, (ctx) => {
    const category = categoryById(ctx.db, ctx.params.id ?? "");
    return json({
      items: wholesaleCategoryProducts(ctx.db, category.id).map((product) =>
        wholesaleProductSummary(ctx.db, product),
      ),
    });
  });

  router.put(`${categories}/:id/products/order`, MANAGE, async (ctx) => {
    const category = categoryById(ctx.db, ctx.params.id ?? "");
    const input = await ctx.body(
      z.strictObject({ orderedIds: z.array(zId).min(1).max(1000) }),
    );
    if (new Set(input.orderedIds).size !== input.orderedIds.length) {
      throw validationFailed([
        { field: "orderedIds", problems: ["must not repeat an id"] },
      ]);
    }
    const current = wholesaleCategoryProducts(ctx.db, category.id);
    const expected = current.map((product) => product.id);
    const unknown = input.orderedIds.filter((id) => !expected.includes(id));
    if (unknown.length > 0) {
      throw fail(
        400,
        "WHOLESALE_PRODUCT_ORDER_INVALID",
        "orderedIds names products that are not in this category.",
        { unknown, expected },
      );
    }
    const named = new Set(input.orderedIds);
    const ordered = [
      ...input.orderedIds.map((id) =>
        current.find((product) => product.id === id)!,
      ),
      ...current.filter((product) => !named.has(product.id)),
    ];
    ordered.forEach((product, index) => {
      product.sortOrder = index;
    });
    return json({
      items: ordered.map((product) => wholesaleProductSummary(ctx.db, product)),
    });
  });

  // --- Products (section 4) --------------------------------------------------

  const SORTS = ["newest", "updated", "name", "sku"] as const;

  router.get(products, READ, (ctx) => {
    const status = enumParam(ctx.query, "status", [
      "draft",
      "active",
      "archived",
    ] as const);
    const categoryId = idParam(ctx.query, "categoryId");
    const isAvailable = boolParam(ctx.query, "isAvailable");
    const sort = enumParam(ctx.query, "sort", SORTS) ?? "newest";
    const q = ctx.query.get("q")?.trim();
    if (q !== undefined && q !== "" && (q.length < 2 || q.length > 80)) {
      throw validationFailed([
        { field: "q", problems: ["q must be 2 to 80 characters long"] },
      ]);
    }
    const smallestSku = (product: WholesaleProductRecord) =>
      [...product.skus.map((sku) => sku.sku)].sort()[0] ?? "";
    const rows = ctx.db.wholesaleProducts
      .filter(
        (product) =>
          (!status || product.status === status) &&
          (!categoryId || product.categoryId === categoryId) &&
          (isAvailable === undefined || product.isAvailable === isAvailable) &&
          (!q || matchesSearch(product, q)),
      )
      .sort((a, b) => {
        if (sort === "updated") return a.updatedAt < b.updatedAt ? 1 : -1;
        if (sort === "name") return a.name.en.localeCompare(b.name.en);
        if (sort === "sku") return smallestSku(a).localeCompare(smallestSku(b));
        return a.id < b.id ? 1 : -1;
      });
    const result = page(rows, ctx.query);
    return json({
      ...result,
      items: result.items.map((product) =>
        wholesaleProductSummary(ctx.db, product),
      ),
    });
  });

  router.post(products, MANAGE, async (ctx) => {
    const input = await ctx.body(createProduct);
    const product = createWholesaleProduct(
      ctx.db,
      input,
      ctx.admin.id,
      ctx.now,
    );
    return json({ product: wholesaleProductDetail(ctx.db, product) }, 201);
  });

  // Copy from retail (section 6): a one-time copy, the two are not linked.
  router.post(`${products}/from-retail`, MANAGE, async (ctx) => {
    const input = await ctx.body(fromRetail);
    const retail = ctx.db.products.find(
      (entry) => entry.id === input.productId,
    );
    if (!retail)
      throw fail(404, "PRODUCT_NOT_FOUND", "The product was not found.");
    categoryById(ctx.db, input.categoryId);
    const skus =
      input.skus ??
      retail.variants.map((variant) => ({
        packSize: {
          value: variant.packSize.value,
          unit: variant.packSize.unit,
        },
        unitsPerCarton: 1,
      }));
    const images =
      input.copyImages === false
        ? []
        : retail.images.map((image, index) => ({
            ...image,
            id: newId(ctx.now + index + 1),
            uploadedAt: iso(ctx.now),
          }));
    const product = createWholesaleProduct(
      ctx.db,
      {
        name: retail.name,
        categoryId: input.categoryId,
        skus,
        vatRate: retail.vatRate,
        status: input.status ?? "draft",
        subtitle: retail.subtitle ?? undefined,
        shortDescription: retail.shortDescription ?? undefined,
        description: retail.description ?? undefined,
        highlights: retail.highlights ?? undefined,
        brand: retail.brand,
        isAvailable: retail.isAvailable,
        storageType: retail.storageType ?? "ambient",
        food: retail.food
          ? {
              ingredients: retail.food.ingredients ?? undefined,
              allergens: retail.food.allergens ?? undefined,
              nutrition: retail.food.nutrition ?? undefined,
              storageInstructions: retail.food.storageInstructions ?? undefined,
              origin: retail.food.origin ?? undefined,
              manufacturer: retail.food.manufacturer ?? undefined,
            }
          : undefined,
        searchKeywords: retail.searchKeywords,
      },
      ctx.admin.id,
      ctx.now,
      { retailProductId: retail.id, images },
    );
    return json({ product: wholesaleProductDetail(ctx.db, product) }, 201);
  });

  router.get(`${products}/:id`, READ, (ctx) =>
    json({
      product: wholesaleProductDetail(
        ctx.db,
        productById(ctx.db, ctx.params.id ?? ""),
      ),
    }),
  );

  router.patch(`${products}/:id`, MANAGE, async (ctx) => {
    const input = await ctx.body(updateProduct);
    const product = productById(ctx.db, ctx.params.id ?? "");
    if (input.categoryId !== undefined) categoryById(ctx.db, input.categoryId);
    if (input.slug !== undefined) {
      const slug = {
        en: input.slug.en ?? product.slug.en,
        de: input.slug.de ?? product.slug.de,
      };
      assertProductSlugFree(ctx.db, slug, product.id);
      product.slug = slug;
    }
    if (input.vatRate !== undefined) product.vatRate = input.vatRate;
    if (
      input.categoryId !== undefined &&
      input.categoryId !== product.categoryId
    ) {
      product.categoryId = input.categoryId;
      product.sortOrder =
        input.sortOrder ?? nextWholesalePosition(ctx.db, input.categoryId);
    }
    if (input.status !== undefined) {
      product.status = input.status;
      if (input.status === "active") product.publishedAt ??= iso(ctx.now);
    }
    applyWholesaleProductFields(product, input);
    product.updatedAt = iso(ctx.now);
    return json({ product: wholesaleProductDetail(ctx.db, product) });
  });

  router.delete(`${products}/:id`, MANAGE, (ctx) => {
    const product = productById(ctx.db, ctx.params.id ?? "");
    ctx.db.wholesaleProducts = ctx.db.wholesaleProducts.filter(
      (entry) => entry.id !== product.id,
    );
    return noContent();
  });

  // --- SKUs -------------------------------------------------------------------

  router.post(`${products}/:id/skus`, MANAGE, async (ctx) => {
    const input = await ctx.body(zCreateSku);
    const product = productById(ctx.db, ctx.params.id ?? "");
    assertSkuSet([
      ...product.skus.map((entry) => ({
        packSize: entry.packSize,
        unitsPerCarton: entry.unitsPerCarton,
        sku: entry.sku,
      })),
      input,
    ]);
    createWholesaleSku(ctx.db, product, input, ctx.admin.id, ctx.now);
    product.updatedAt = iso(ctx.now);
    return json({ product: wholesaleProductDetail(ctx.db, product) }, 201);
  });

  router.patch(`${products}/:id/skus/:skuId`, MANAGE, async (ctx) => {
    const input = await ctx.body(zUpdateSku);
    const product = productById(ctx.db, ctx.params.id ?? "");
    const sku = skuById(product, ctx.params.skuId ?? "");
    applyWholesaleSkuPatch(ctx.db, product, sku, input, ctx.now);
    return json({ product: wholesaleProductDetail(ctx.db, product) });
  });

  router.delete(`${products}/:id/skus/:skuId`, MANAGE, (ctx) => {
    const product = productById(ctx.db, ctx.params.id ?? "");
    const sku = skuById(product, ctx.params.skuId ?? "");
    if (product.skus.length === 1) {
      throw fail(
        409,
        "WHOLESALE_SKU_LAST",
        "A product needs at least one SKU. Disable it, or delete the product.",
      );
    }
    product.skus = product.skus.filter((entry) => entry.id !== sku.id);
    product.updatedAt = iso(ctx.now);
    return json({ product: wholesaleProductDetail(ctx.db, product) });
  });

  // --- Stock (section 8) -------------------------------------------------------

  router.put(`${products}/:id/skus/:skuId/stock`, MANAGE, async (ctx) => {
    const input = await ctx.body(stockChange);
    const product = productById(ctx.db, ctx.params.id ?? "");
    const sku = skuById(product, ctx.params.skuId ?? "");
    const hasQuantity = input.quantity !== undefined;
    const hasDelta = input.delta !== undefined;
    if (hasQuantity === hasDelta) {
      throw fail(
        400,
        "STOCK_CHANGE_INVALID",
        "Send quantity or delta, not both and not neither.",
      );
    }
    const delta = hasQuantity ? input.quantity! - sku.stock : input.delta!;
    const movement =
      delta === 0
        ? null
        : recordWholesaleMovement(
            ctx.db,
            product,
            sku,
            "adjustment",
            delta,
            { adminId: ctx.admin.id, note: input.note ?? null },
            ctx.now,
          );
    return json({
      product: wholesaleProductDetail(ctx.db, product),
      sku: skuView(sku),
      movement,
    });
  });

  router.get(`${products}/:id/stock-movements`, READ, (ctx) => {
    const product = productById(ctx.db, ctx.params.id ?? "");
    const skuId = idParam(ctx.query, "skuId");
    const rows = ctx.db.wholesaleStockMovements
      .filter(
        (entry) =>
          entry.productId === product.id && (!skuId || entry.skuId === skuId),
      )
      .sort((a, b) => (a.id < b.id ? 1 : -1));
    return json(page(rows, ctx.query, 25));
  });

  // --- Images (section 5) -------------------------------------------------------

  router.post(`${products}/:id/images`, MANAGE, async (ctx) => {
    const product = productById(ctx.db, ctx.params.id ?? "");
    const files = await uploadedFiles(ctx.request, "files", 10);
    const remaining = 12 - product.images.length;
    if (files.length > remaining) {
      throw fail(
        400,
        "IMAGE_LIMIT_REACHED",
        "A product can have 12 images at most.",
        { maximum: 12, remaining },
      );
    }
    const read = [];
    const refused: Record<string, unknown>[] = [];
    let first: HttpError | null = null;
    for (const file of files) {
      try {
        read.push(await readImage(file));
      } catch (error) {
        if (!(error instanceof HttpError)) throw error;
        first ??= error;
        const measured = (error.details ?? {}) as {
          width?: number;
          height?: number;
        };
        refused.push({
          name: file.name,
          code: error.code,
          bytes: file.size,
          ...(typeof measured.width === "number"
            ? { width: measured.width, height: measured.height }
            : {}),
        });
      }
    }
    if (first) {
      const details =
        typeof first.details === "object" && first.details !== null
          ? (first.details as Record<string, unknown>)
          : {};
      throw fail(first.status, first.code, first.message, {
        ...details,
        files: refused,
      });
    }
    for (const image of read)
      product.images.push(storeImage(ctx.db, image, ctx.now));
    ensurePrimary(product);
    product.updatedAt = iso(ctx.now);
    return json({ product: wholesaleProductDetail(ctx.db, product) }, 201);
  });

  router.put(`${products}/:id/images/order`, MANAGE, async (ctx) => {
    const input = await ctx.body(
      z.strictObject({ orderedIds: z.array(zId).min(1) }),
    );
    const product = productById(ctx.db, ctx.params.id ?? "");
    const expected = product.images.map((image) => image.id);
    const same =
      expected.length === input.orderedIds.length &&
      new Set(input.orderedIds).size === input.orderedIds.length &&
      input.orderedIds.every((id) => expected.includes(id));
    if (!same) {
      throw fail(
        400,
        "IMAGE_ORDER_INVALID",
        "The list must contain every image of the product.",
        { expected },
      );
    }
    product.images = input.orderedIds.map((id) => imageOf(product, id));
    product.updatedAt = iso(ctx.now);
    return json({ product: wholesaleProductDetail(ctx.db, product) });
  });

  router.put(`${products}/:id/images/:imageId`, MANAGE, async (ctx) => {
    const product = productById(ctx.db, ctx.params.id ?? "");
    const image = imageOf(product, ctx.params.imageId ?? "");
    const [file] = await uploadedFiles(ctx.request, "file", 1);
    const stored = storeImage(ctx.db, await readImage(file as File), ctx.now);
    Object.assign(image, {
      url: stored.url,
      sizes: stored.sizes,
      bytes: stored.bytes,
      uploadedAt: stored.uploadedAt,
    });
    product.updatedAt = iso(ctx.now);
    return json({ product: wholesaleProductDetail(ctx.db, product) });
  });

  router.patch(`${products}/:id/images/:imageId`, MANAGE, async (ctx) => {
    const input = await ctx.body(imagePatch);
    const product = productById(ctx.db, ctx.params.id ?? "");
    const image = imageOf(product, ctx.params.imageId ?? "");
    if (input.alt !== undefined) image.alt = { ...image.alt, ...input.alt };
    if (input.isPrimary) {
      for (const entry of product.images)
        entry.isPrimary = entry.id === image.id;
    }
    product.updatedAt = iso(ctx.now);
    return json({ product: wholesaleProductDetail(ctx.db, product) });
  });

  router.delete(`${products}/:id/images/:imageId`, MANAGE, (ctx) => {
    const product = productById(ctx.db, ctx.params.id ?? "");
    const image = imageOf(product, ctx.params.imageId ?? "");
    product.images = product.images.filter((entry) => entry.id !== image.id);
    ensurePrimary(product);
    product.updatedAt = iso(ctx.now);
    return json({ product: wholesaleProductDetail(ctx.db, product) });
  });
}

// --- Seed ----------------------------------------------------------------------

interface SeedProduct {
  name: [string, string];
  brand: string | null;
  category: string;
  /** value, unit, packs per carton, stock in cartons */
  skus: [number, PackUnit, number, number][];
  hue: number;
  status?: ProductStatus;
  available?: boolean;
  storage?: StorageType;
}

const SEED_CATEGORIES: [string, string, string | null, boolean][] = [
  ["Rice", "Reis", "Basmati, sona masoori and idli rice by the carton.", true],
  ["Flour & Atta", "Mehl & Atta", "Wheat, gram and millet flours.", true],
  ["Pulses", "Hülsenfrüchte", "Dals and beans in sacks.", true],
  ["Spices", "Gewürze", null, true],
  ["Coming soon", "Demnächst", null, false],
];

const SEED_PRODUCTS: SeedProduct[] = [
  {
    name: ["Daawat Basmati Rice", "Daawat Basmati Reis"],
    brand: "Daawat",
    category: "Rice",
    skus: [
      [1, "kg", 20, 40],
      [5, "kg", 4, 10],
      [20, "kg", 1, 5],
    ],
    hue: 32,
  },
  {
    name: ["Sona Masoori Rice", "Sona Masoori Reis"],
    brand: "India Gate",
    category: "Rice",
    skus: [
      [5, "kg", 4, 12],
      // Nothing on hand: the accepted quotation of the seed takes it below zero.
      [10, "kg", 2, 0],
    ],
    hue: 48,
  },
  {
    name: ["Idli Rice", "Idli Reis"],
    brand: null,
    category: "Rice",
    skus: [[5, "kg", 4, 0]],
    hue: 60,
    status: "draft",
  },
  {
    name: ["Chakki Atta", "Chakki Atta"],
    brand: "Radhe",
    category: "Flour & Atta",
    skus: [
      [5, "kg", 4, 18],
      [10, "kg", 2, 20],
    ],
    hue: 90,
  },
  {
    name: ["Besan Gram Flour", "Besan Kichererbsenmehl"],
    brand: "Radhe",
    category: "Flour & Atta",
    skus: [
      [1, "kg", 10, 14],
      [5, "kg", 4, 3],
    ],
    hue: 110,
  },
  {
    name: ["Toor Dal", "Toor Dal"],
    brand: "Radhe",
    category: "Pulses",
    skus: [
      [1, "kg", 10, 25],
      [5, "kg", 4, 8],
      [25, "kg", 1, 2],
    ],
    hue: 140,
  },
  {
    name: ["Moong Dal", "Moong Dal"],
    brand: "Radhe",
    category: "Pulses",
    skus: [
      [1, "kg", 10, 30],
      [5, "kg", 4, 6],
    ],
    hue: 160,
  },
  {
    name: ["Chana Dal", "Chana Dal"],
    brand: null,
    category: "Pulses",
    skus: [[5, "kg", 4, 9]],
    hue: 180,
    available: false,
  },
  {
    name: ["Cumin Seeds", "Kreuzkümmel ganz"],
    brand: "Everest",
    category: "Spices",
    skus: [
      [500, "g", 12, 16],
      [1, "kg", 10, 7],
    ],
    hue: 200,
  },
  {
    name: ["Turmeric Powder", "Kurkuma gemahlen"],
    brand: "Everest",
    category: "Spices",
    skus: [
      [500, "g", 12, 22],
      [1, "kg", 10, 11],
    ],
    hue: 220,
  },
  {
    name: ["Kashmiri Chilli Powder", "Kashmiri Chilipulver"],
    brand: "Everest",
    category: "Spices",
    skus: [[500, "g", 12, 15]],
    hue: 240,
    status: "archived",
  },
];

/** A drawn stand-in for a picture, as the demo products of the retail catalogue have it. */
function placeholder(
  publicUrl: string,
  id: string,
  label: string,
  hue: number,
  uploadedAt: string,
  alt: { en?: string | null; de?: string | null },
): AdminImage {
  const url = (size: number) =>
    `${publicUrl}/media/placeholder/${hue}/${size}/${encodeURIComponent(label)}.svg`;
  return {
    id,
    alt,
    isPrimary: false,
    url: url(1600),
    sizes: {
      small: { url: url(320), width: 320, height: 320 },
      medium: { url: url(800), width: 800, height: 800 },
      large: { url: url(1600), width: 1600, height: 1600 },
    },
    bytes: 48_000,
    uploadedAt,
  };
}

/**
 * Five wholesale categories (one hidden) and eleven products with their
 * SKUs and cartons on hand: a draft, an archived one, one not available,
 * and one SKU below zero (a shortage).
 */
export function seedWholesale(db: Db, now: number, adminId: string): void {
  const DAY = 24 * 60 * 60_000;
  const long = now - 90 * DAY;
  const byName = new Map<string, WholesaleCategoryRecord>();
  SEED_CATEGORIES.forEach(([en, de, description, visible], index) => {
    const at = long + index * 60_000;
    const record: WholesaleCategoryRecord = {
      id: newId(at),
      name: { en, de },
      slug: { en: slugify(en), de: slugify(de) },
      description: description ? { en: description, de: null } : null,
      sortOrder: index,
      isVisible: visible,
      image:
        index < 3
          ? {
              ...placeholder(
                db.config.publicUrl,
                newId(at),
                en,
                20 + index * 40,
                iso(at),
                { en, de },
              ),
              isPrimary: true,
            }
          : null,
      createdAt: iso(at),
      updatedAt: iso(at),
    };
    db.wholesaleCategories.push(record);
    byName.set(en, record);
  });

  SEED_PRODUCTS.forEach((item, index) => {
    const category = byName.get(item.category)!;
    const at = long + DAY + index * 3600_000;
    const status = item.status ?? "active";
    const product: WholesaleProductRecord = {
      id: newId(at),
      name: { en: item.name[0], de: item.name[1] },
      slug: { en: slugify(item.name[0]), de: slugify(item.name[1]) },
      subtitle:
        index === 0 ? { en: "Aged two years", de: "Zwei Jahre gereift" } : null,
      shortDescription: {
        en: `${item.name[0]} by the carton for shops and restaurants.`,
        de: `${item.name[1]} kartonweise für Läden und Restaurants.`,
      },
      description: {
        en: `${item.name[0]}${item.brand ? ` by ${item.brand}` : ""}, packed for the trade.`,
        de: null,
      },
      highlights: { en: ["Trade pack", "Imported from India"], de: [] },
      brand: item.brand,
      categoryId: category.id,
      skus: [],
      vatRate: 700,
      status,
      isAvailable: item.available ?? true,
      sortOrder: wholesaleCategoryProducts(db, category.id).length,
      storageType: item.storage ?? "ambient",
      images: [
        {
          ...placeholder(
            db.config.publicUrl,
            newId(at + 1),
            item.name[0],
            item.hue,
            iso(at),
            { en: item.name[0], de: item.name[1] },
          ),
          isPrimary: true,
        },
      ],
      food: {
        ingredients: null,
        allergens: null,
        nutrition: null,
        storageInstructions: {
          en: "Store cool and dry.",
          de: "Kühl und trocken lagern.",
        },
        origin: "India",
        manufacturer: null,
      },
      searchKeywords: [item.name[1]],
      retailProductId: null,
      publishedAt: status === "active" ? iso(at + 3600_000) : null,
      createdAt: iso(at),
      updatedAt: iso(at + 3600_000),
    };
    db.wholesaleProducts.push(product);
    item.skus.forEach(([value, unit, unitsPerCarton, stock], skuIndex) => {
      createWholesaleSku(
        db,
        product,
        { packSize: { value, unit }, unitsPerCarton, stock },
        adminId,
        at + skuIndex * 60_000 + 10,
      );
    });
  });
}
