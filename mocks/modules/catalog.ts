// Sections 7 (categories) and 8 (products, stock and images).

import { z } from "zod";
import type { AdminImage, PackUnit } from "../../src/lib/api/types/index.ts";
import type {
  CategoryRecord,
  Db,
  ProductRecord,
  VariantRecord,
} from "../db.ts";
import {
  UNIT_FAMILY,
  ancestorsOf,
  baseQuantity,
  categoryView,
  defaultVariantOf,
  descendantIds,
  orderedCategories,
  packLabel,
  productDetail,
  productInUse,
  productSummary,
  stockOverview,
  variantInUse,
  variantSlug,
} from "../domain.ts";
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
  zCents,
  zId,
  zTranslated,
  zTranslatedOptional,
} from "../http.ts";
import { readImage, storeImage, uploadedFiles } from "../media.ts";
import type { Router } from "../router.ts";
import { iso } from "../time.ts";
import { recordMovement } from "./stock.ts";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
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

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

// --- Categories -------------------------------------------------------------

const categoryFields = {
  slug: zSlug.optional(),
  tagline: zTranslatedOptional(300).optional(),
  description: zTranslatedOptional(20000).optional(),
  parentId: zId.nullish(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  isVisible: z.boolean().optional(),
  seo: z
    .strictObject({
      title: zTranslatedOptional(300).optional(),
      description: zTranslatedOptional(300).optional(),
    })
    .optional(),
};
const createCategory = z.strictObject({
  name: zTranslated(160),
  ...categoryFields,
});
const updateCategory = z.strictObject({
  name: zTranslated(160).optional(),
  ...categoryFields,
});

function categoryById(db: Db, id: string): CategoryRecord {
  const category = db.categories.find((entry) => entry.id === id);
  if (!category)
    throw fail(404, "CATEGORY_NOT_FOUND", "The category was not found.");
  return category;
}

function depthBelow(db: Db, id: string): number {
  const children = db.categories.filter((entry) => entry.parentId === id);
  return children.length === 0
    ? 0
    : 1 + Math.max(...children.map((child) => depthBelow(db, child.id)));
}

export function assertParent(
  db: Db,
  parentId: string | null,
  moving?: CategoryRecord,
): void {
  if (parentId === null) return;
  const parent = db.categories.find((entry) => entry.id === parentId);
  if (!parent)
    throw fail(
      400,
      "CATEGORY_PARENT_INVALID",
      "The parent category does not exist.",
    );
  if (moving && descendantIds(db, moving.id).includes(parentId)) {
    throw fail(
      400,
      "CATEGORY_PARENT_INVALID",
      "A category cannot be moved into itself or below itself.",
    );
  }
  const level = ancestorsOf(db, parent).length + 2;
  if (level + (moving ? depthBelow(db, moving.id) : 0) > 3) {
    throw fail(
      400,
      "CATEGORY_TOO_DEEP",
      "Categories can be three levels deep at most.",
    );
  }
}

export function assertCategorySlugFree(
  db: Db,
  slug: { en: string; de?: string | null },
  exceptId?: string,
): void {
  const taken = db.categories.some(
    (entry) =>
      entry.id !== exceptId &&
      (entry.slug.en === slug.en || (slug.de && entry.slug.de === slug.de)),
  );
  if (taken)
    throw fail(409, "CATEGORY_SLUG_TAKEN", "Another category uses this slug.");
}

export function lastPosition(db: Db, parentId: string | null): number {
  const siblings = db.categories.filter((entry) => entry.parentId === parentId);
  return siblings.length === 0
    ? 0
    : Math.max(...siblings.map((entry) => entry.sortOrder)) + 1;
}

// --- Products ---------------------------------------------------------------

export const PACK_UNITS = ["g", "kg", "ml", "l", "pcs"] as const;
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
const zList = z.strictObject({
  en: z.array(z.string().min(1).max(300)).max(20).optional(),
  de: z.array(z.string().min(1).max(300)).max(20).optional(),
});
const zTags = z
  .array(
    z
      .string()
      .max(40)
      .regex(SLUG, "each tag must use lower-case letters, digits and hyphens"),
  )
  .max(20)
  .refine((tags) => new Set(tags).size === tags.length, "tags must be unique");

/** The fields of a pack size (8): the same on create and on `POST …/variants`. */
const variantFields = {
  sku: z.string().optional(),
  gtin: z
    .string()
    .regex(/^(\d{8}|\d{12,14})$/, "gtin must have 8, 12, 13 or 14 digits")
    .nullish(),
  salePrice: zCents(1).nullish(),
  discountPercent: z.number().int().min(1).max(99).nullish(),
  isEnabled: z.boolean().optional(),
  lowStockThreshold: z.number().int().min(0).max(1_000_000).nullish(),
};
const zCreateVariant = z.strictObject({
  packSize: zPack,
  regularPrice: zCents(1),
  /** The opening stock; only when the pack size is created (8). */
  stockQuantity: z.number().int().min(0).max(1_000_000).optional(),
  ...variantFields,
});
const zUpdateVariant = z.strictObject({
  packSize: zPack.optional(),
  regularPrice: zCents(1).optional(),
  ...variantFields,
});

const productFields = {
  slug: zSlug.optional(),
  subtitle: zTranslatedOptional(300).optional(),
  shortDescription: zTranslatedOptional(300).optional(),
  description: zTranslatedOptional(20000).optional(),
  highlights: zList.optional(),
  uses: zList.optional(),
  brand: z.string().max(80).nullish(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  isAvailable: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1_000_000).optional(),
  minOrderQuantity: z.number().int().min(1).max(10000).optional(),
  maxOrderQuantity: z.number().int().min(1).max(10000).nullish(),
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
  tags: zTags.optional(),
  searchKeywords: z.array(z.string().min(2).max(60)).max(30).optional(),
  seo: z
    .strictObject({
      title: zTranslatedOptional(300).optional(),
      description: zTranslatedOptional(300).optional(),
    })
    .optional(),
};
const createProduct = z.strictObject({
  name: zTranslated(160),
  categoryId: zId,
  variants: z.array(zCreateVariant).min(1).max(20),
  vatRate: z.number().int().min(0).max(10000),
  ...productFields,
});
const updateProduct = z.strictObject({
  name: zTranslated(160).optional(),
  categoryId: zId.optional(),
  vatRate: z.number().int().min(0).max(10000).optional(),
  ...productFields,
});
const imagePatch = z.strictObject({
  alt: zTranslatedOptional(300).optional(),
  isPrimary: z.literal(true, "isPrimary may only be true").optional(),
});

export type ProductInput = z.output<typeof updateProduct>;
export type VariantInput = z.output<typeof zCreateVariant>;
export type VariantPatch = z.output<typeof zUpdateVariant>;

function productById(db: Db, id: string): ProductRecord {
  const product = db.products.find((entry) => entry.id === id);
  if (!product)
    throw fail(404, "PRODUCT_NOT_FOUND", "The product was not found.");
  return product;
}

function variantById(product: ProductRecord, id: string): VariantRecord {
  const variant = product.variants.find((entry) => entry.id === id);
  if (!variant)
    throw fail(
      404,
      "PRODUCT_VARIANT_NOT_FOUND",
      "The pack size was not found.",
    );
  return variant;
}

/** Every pack size of the shop, with its product. */
function allVariants(
  db: Db,
): { product: ProductRecord; variant: VariantRecord }[] {
  return db.products.flatMap((product) =>
    product.variants.map((variant) => ({ product, variant })),
  );
}

/** The pack size an article number belongs to, if any. */
export function variantBySku(
  db: Db,
  sku: string,
): { product: ProductRecord; variant: VariantRecord } | undefined {
  return allVariants(db).find((entry) => entry.variant.sku === sku);
}

/**
 * The article number as the API stores it: upper-cased, checked, free
 * across the shop (8). Left out, the next generated one.
 */
export function normalSku(
  db: Db,
  sku: string | undefined,
  exceptVariantId?: string,
): string {
  if (sku === undefined) {
    do {
      db.counters.sku += 1;
    } while (
      variantBySku(db, `RF-${String(db.counters.sku).padStart(5, "0")}`)
    );
    return `RF-${String(db.counters.sku).padStart(5, "0")}`;
  }
  const upper = sku.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(upper)) {
    throw validationFailed([
      {
        field: "sku",
        problems: ["sku must match ^[A-Z0-9][A-Z0-9._-]{1,39}$"],
      },
    ]);
  }
  const taken = variantBySku(db, upper);
  if (taken && taken.variant.id !== exceptVariantId) {
    throw fail(409, "PRODUCT_SKU_TAKEN", "Another product has this SKU.");
  }
  return upper;
}

/**
 * The base slug and the URLs of the pack sizes must be free of other
 * products (8): `PRODUCT_SLUG_TAKEN` otherwise.
 */
export function assertProductSlugFree(
  db: Db,
  slug: { en: string; de?: string | null },
  packs: { value: number; unit: PackUnit }[],
  exceptId?: string,
): void {
  const mine = new Set<string>([slug.en, ...(slug.de ? [slug.de] : [])]);
  for (const pack of packs) {
    const url = variantSlug(slug, pack);
    mine.add(url.en);
    if (url.de) mine.add(url.de);
  }
  for (const other of db.products) {
    if (other.id === exceptId) continue;
    const theirs = new Set<string>([
      other.slug.en,
      ...(other.slug.de ? [other.slug.de] : []),
    ]);
    for (const variant of other.variants) {
      const url = variantSlug(other.slug, variant.packSize);
      theirs.add(url.en);
      if (url.de) theirs.add(url.de);
    }
    for (const entry of mine) {
      if (theirs.has(entry)) {
        throw fail(
          409,
          "PRODUCT_SLUG_TAKEN",
          "Another product uses this slug, or the URL of one of its pack sizes.",
        );
      }
    }
  }
}

/**
 * The rules of the pack sizes (8): one unit family, no pack twice, no
 * article number twice, at most 20.
 */
export function assertPackSizes(
  packs: { value: number; unit: PackUnit }[],
  skus: (string | undefined)[],
): void {
  if (packs.length > 20) {
    throw validationFailed([
      { field: "variants", problems: ["a product has at most 20 pack sizes"] },
    ]);
  }
  const families = [...new Set(packs.map((pack) => UNIT_FAMILY[pack.unit]))];
  if (families.length > 1) {
    throw fail(
      400,
      "PRODUCT_VARIANT_INVALID",
      "The pack sizes of a product must be of one unit family.",
      { families },
    );
  }
  const seen = new Set<number>();
  for (const pack of packs) {
    const base = baseQuantity(pack);
    if (seen.has(base)) {
      throw fail(
        400,
        "PRODUCT_VARIANT_INVALID",
        "The same pack appears twice.",
        { baseQuantity: base },
      );
    }
    seen.add(base);
  }
  const named = skus.filter((sku): sku is string => sku !== undefined);
  const twice = named.find((sku, index) => named.indexOf(sku) !== index);
  if (twice) {
    throw fail(
      400,
      "PRODUCT_VARIANT_INVALID",
      "The same article number appears twice.",
      { sku: twice },
    );
  }
}

/** The sale price that follows from the input, or the documented refusal. */
export function resolveSale(
  regularPrice: number,
  input: { salePrice?: number | null; discountPercent?: number | null },
  current: number | null,
): number | null {
  const hasSale = input.salePrice !== undefined && input.salePrice !== null;
  const hasPercent =
    input.discountPercent !== undefined && input.discountPercent !== null;
  if (hasSale && hasPercent) {
    throw fail(
      400,
      "PRODUCT_PRICE_INVALID",
      "Send salePrice or discountPercent, not both.",
      {
        regularPrice,
        salePrice: input.salePrice,
      },
    );
  }
  let sale = current;
  if (hasPercent)
    sale = Math.round(
      (regularPrice * (100 - (input.discountPercent ?? 0))) / 100,
    );
  else if (input.salePrice !== undefined) sale = input.salePrice;
  else if (input.discountPercent === null) sale = null;
  if (sale !== null && sale >= regularPrice) {
    throw fail(
      400,
      "PRODUCT_PRICE_INVALID",
      "The sale price must be below the regular price.",
      {
        regularPrice,
        salePrice: sale,
      },
    );
  }
  return sale;
}

export function assertQuantities(min: number, max: number | null): void {
  if (max !== null && max < min) {
    throw fail(
      400,
      "PRODUCT_QUANTITY_INVALID",
      "maxOrderQuantity must not be below minOrderQuantity.",
    );
  }
}

/** One entry of the price history of a pack size (8). */
export function logPrice(
  db: Db,
  product: ProductRecord,
  variant: VariantRecord,
  adminId: string,
  now: number,
): void {
  const history = db.priceChanges.get(variant.id) ?? [];
  history.unshift({
    regularPrice: variant.regularPrice,
    salePrice: variant.salePrice,
    price: variant.salePrice ?? variant.regularPrice,
    vatRate: product.vatRate,
    changedBy: adminId,
    changedAt: iso(now),
  });
  db.priceChanges.set(variant.id, history.slice(0, 200));
}

/**
 * A new pack size of a product (8): its article number, its first price
 * and, with an opening stock, the first line of its stock history.
 */
export function createVariant(
  db: Db,
  product: ProductRecord,
  input: VariantInput,
  adminId: string,
  now: number,
): VariantRecord {
  const salePrice = resolveSale(input.regularPrice, input, null);
  const sku = normalSku(db, input.sku);
  const variant: VariantRecord = {
    id: newId(now + product.variants.length),
    sku,
    gtin: input.gtin ?? null,
    packSize: {
      ...input.packSize,
      label: packLabel(input.packSize.value, input.packSize.unit),
    },
    regularPrice: input.regularPrice,
    salePrice,
    isEnabled: input.isEnabled ?? true,
    stock: { quantity: 0, lowStockThreshold: input.lowStockThreshold ?? null },
    createdAt: iso(now),
  };
  product.variants.push(variant);
  logPrice(db, product, variant, adminId, now);
  // The opening stock starts the history with a restock (8).
  if (input.stockQuantity) {
    recordMovement(
      db,
      product,
      variant,
      "restock",
      input.stockQuantity,
      { adminId, note: "Opening stock" },
      now,
    );
  }
  return variant;
}

/** Changes a pack size; the price history and the URL follow (8). */
export function applyVariantPatch(
  db: Db,
  product: ProductRecord,
  variant: VariantRecord,
  input: VariantPatch,
  adminId: string,
  now: number,
): void {
  const regularPrice = input.regularPrice ?? variant.regularPrice;
  const salePrice = resolveSale(regularPrice, input, variant.salePrice);
  const sku =
    input.sku === undefined
      ? variant.sku
      : normalSku(db, input.sku, variant.id);
  const packSize = input.packSize
    ? {
        ...input.packSize,
        label: packLabel(input.packSize.value, input.packSize.unit),
      }
    : variant.packSize;
  if (input.packSize || input.sku !== undefined) {
    const others = product.variants.filter((entry) => entry.id !== variant.id);
    assertPackSizes(
      [...others.map((entry) => entry.packSize), packSize],
      [...others.map((entry) => entry.sku), sku],
    );
  }
  if (input.packSize) {
    assertProductSlugFree(db, product.slug, [packSize], product.id);
  }
  const priceChanged =
    regularPrice !== variant.regularPrice || salePrice !== variant.salePrice;
  variant.sku = sku;
  variant.packSize = packSize;
  variant.regularPrice = regularPrice;
  variant.salePrice = salePrice;
  if (input.gtin !== undefined) variant.gtin = input.gtin;
  if (input.isEnabled !== undefined) variant.isEnabled = input.isEnabled;
  if (input.lowStockThreshold !== undefined)
    variant.stock.lowStockThreshold = input.lowStockThreshold;
  product.updatedAt = iso(now);
  if (priceChanged) logPrice(db, product, variant, adminId, now);
}

export function applyProductFields(
  product: ProductRecord,
  input: ProductInput,
): void {
  if (input.name !== undefined) product.name = input.name;
  if (input.subtitle !== undefined) product.subtitle = input.subtitle;
  if (input.shortDescription !== undefined)
    product.shortDescription = input.shortDescription;
  if (input.description !== undefined) product.description = input.description;
  if (input.highlights !== undefined) product.highlights = input.highlights;
  if (input.uses !== undefined) product.uses = input.uses;
  if (input.brand !== undefined) product.brand = input.brand;
  if (input.isAvailable !== undefined) product.isAvailable = input.isAvailable;
  if (input.isFeatured !== undefined) product.isFeatured = input.isFeatured;
  if (input.sortOrder !== undefined) product.sortOrder = input.sortOrder;
  if (input.storageType !== undefined) product.storageType = input.storageType;
  if (input.tags !== undefined) product.tags = input.tags;
  if (input.searchKeywords !== undefined)
    product.searchKeywords = input.searchKeywords;
  if (input.seo !== undefined) product.seo = input.seo;
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

function matchesSearch(product: ProductRecord, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const skus = product.variants.map((variant) => variant.sku);
  const haystack = [
    product.name.en,
    product.name.de ?? "",
    product.subtitle?.en ?? "",
    ...skus,
    product.brand ?? "",
    ...product.searchKeywords,
    ...product.tags,
  ]
    .join(" ")
    .toLowerCase()
    .split(/[\s-]+/);
  return (
    skus.some((sku) => sku.toLowerCase().startsWith(q.toLowerCase())) ||
    words.every((word) => haystack.some((token) => token.startsWith(word)))
  );
}

function imageOf(product: ProductRecord, imageId: string): AdminImage {
  const image = product.images.find((entry) => entry.id === imageId);
  if (!image) throw fail(404, "IMAGE_NOT_FOUND", "The image was not found.");
  return image;
}

function ensurePrimary(product: ProductRecord): void {
  if (
    product.images.length > 0 &&
    !product.images.some((image) => image.isPrimary)
  ) {
    product.images[0]!.isPrimary = true;
  }
}

export function registerCatalog(router: Router): void {
  const categories = "/v1/admin/categories";

  router.get(categories, { permission: "catalog.read" }, (ctx) =>
    json({
      items: orderedCategories(ctx.db).map((entry) =>
        categoryView(ctx.db, entry),
      ),
    }),
  );

  router.post(categories, { permission: "catalog.manage" }, async (ctx) => {
    const input = await ctx.body(createCategory);
    const parentId = input.parentId ?? null;
    assertParent(ctx.db, parentId);
    const slug = {
      en: input.slug?.en ?? slugify(input.name.en),
      de: input.slug?.de ?? (input.name.de ? slugify(input.name.de) : null),
    };
    assertCategorySlugFree(ctx.db, slug);
    const category: CategoryRecord = {
      id: newId(ctx.now),
      name: input.name,
      slug,
      tagline: input.tagline ?? null,
      description: input.description ?? null,
      parentId,
      sortOrder: input.sortOrder ?? lastPosition(ctx.db, parentId),
      isVisible: input.isVisible ?? true,
      image: null,
      seo: input.seo
        ? {
            title: input.seo.title ?? null,
            description: input.seo.description ?? null,
          }
        : null,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    ctx.db.categories.push(category);
    return json({ category: categoryView(ctx.db, category) }, 201);
  });

  router.put(
    `${categories}/order`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({
          parentId: zId.nullable(),
          orderedIds: z.array(zId).min(1).max(500),
        }),
      );
      const expected = ctx.db.categories
        .filter((entry) => entry.parentId === input.parentId)
        .map((entry) => entry.id);
      const same =
        expected.length === input.orderedIds.length &&
        new Set(input.orderedIds).size === input.orderedIds.length &&
        input.orderedIds.every((id) => expected.includes(id));
      if (!same) {
        throw fail(
          400,
          "CATEGORY_ORDER_INVALID",
          "The list must contain exactly the categories of that parent.",
          { expected },
        );
      }
      input.orderedIds.forEach((id, index) => {
        categoryById(ctx.db, id).sortOrder = index;
      });
      return noContent();
    },
  );

  router.get(`${categories}/:id`, { permission: "catalog.read" }, (ctx) =>
    json({
      category: categoryView(ctx.db, categoryById(ctx.db, ctx.params.id ?? "")),
    }),
  );

  router.patch(
    `${categories}/:id`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(updateCategory);
      const category = categoryById(ctx.db, ctx.params.id ?? "");
      if (
        input.parentId !== undefined &&
        (input.parentId ?? null) !== category.parentId
      ) {
        const parentId = input.parentId ?? null;
        assertParent(ctx.db, parentId, category);
        category.parentId = parentId;
        category.sortOrder = lastPosition(ctx.db, parentId);
      }
      if (input.name !== undefined) category.name = input.name;
      if (input.slug !== undefined) {
        const slug = {
          en: input.slug.en ?? category.slug.en,
          de: input.slug.de ?? category.slug.de ?? null,
        };
        assertCategorySlugFree(ctx.db, slug, category.id);
        category.slug = slug;
      }
      if (input.tagline !== undefined) category.tagline = input.tagline;
      if (input.description !== undefined)
        category.description = input.description;
      if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
      if (input.isVisible !== undefined) category.isVisible = input.isVisible;
      if (input.seo !== undefined) {
        category.seo = {
          title: input.seo.title ?? null,
          description: input.seo.description ?? null,
        };
      }
      category.updatedAt = iso(ctx.now);
      return json({ category: categoryView(ctx.db, category) });
    },
  );

  router.delete(
    `${categories}/:id`,
    { permission: "catalog.manage" },
    (ctx) => {
      const category = categoryById(ctx.db, ctx.params.id ?? "");
      if (ctx.db.categories.some((entry) => entry.parentId === category.id)) {
        throw fail(
          409,
          "CATEGORY_HAS_CHILDREN",
          "The category has sub-categories.",
        );
      }
      if (
        ctx.db.products.some((product) => product.categoryId === category.id)
      ) {
        throw fail(409, "CATEGORY_HAS_PRODUCTS", "The category has products.");
      }
      ctx.db.categories = ctx.db.categories.filter(
        (entry) => entry.id !== category.id,
      );
      return noContent();
    },
  );

  router.put(
    `${categories}/:id/image`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const category = categoryById(ctx.db, ctx.params.id ?? "");
      const [file] = await uploadedFiles(ctx.request, "file", 1);
      const image = storeImage(ctx.db, await readImage(file as File), ctx.now);
      category.image = {
        ...image,
        alt: category.image?.alt ?? image.alt,
        isPrimary: true,
      };
      category.updatedAt = iso(ctx.now);
      return json({ category: categoryView(ctx.db, category) });
    },
  );

  router.patch(
    `${categories}/:id/image`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(
        z.strictObject({ alt: zTranslatedOptional(300) }),
      );
      const category = categoryById(ctx.db, ctx.params.id ?? "");
      if (!category.image)
        throw fail(404, "IMAGE_NOT_FOUND", "The category has no image.");
      category.image.alt = { ...category.image.alt, ...input.alt };
      return json({ category: categoryView(ctx.db, category) });
    },
  );

  router.delete(
    `${categories}/:id/image`,
    { permission: "catalog.manage" },
    (ctx) => {
      const category = categoryById(ctx.db, ctx.params.id ?? "");
      if (!category.image)
        throw fail(404, "IMAGE_NOT_FOUND", "The category has no image.");
      category.image = null;
      return json({ category: categoryView(ctx.db, category) });
    },
  );

  // --- Products -------------------------------------------------------------
  const products = "/v1/admin/products";
  const SORTS = [
    "newest",
    "updated",
    "name",
    "sku",
    "price_asc",
    "price_desc",
  ] as const;

  router.get(products, { permission: "catalog.read" }, (ctx) => {
    const status = enumParam(ctx.query, "status", [
      "draft",
      "active",
      "archived",
    ] as const);
    const categoryId = idParam(ctx.query, "categoryId");
    const isAvailable = boolParam(ctx.query, "isAvailable");
    const onSale = boolParam(ctx.query, "onSale");
    const lowStock = boolParam(ctx.query, "lowStock");
    const sort = enumParam(ctx.query, "sort", SORTS) ?? "newest";
    const q = ctx.query.get("q")?.trim();
    if (q !== undefined && q !== "" && (q.length < 2 || q.length > 80)) {
      throw validationFailed([
        { field: "q", problems: ["q must be 2 to 80 characters long"] },
      ]);
    }
    const inside = categoryId
      ? new Set(descendantIds(ctx.db, categoryId))
      : null;
    const priceFrom = (product: ProductRecord) => {
      const variant = defaultVariantOf(product);
      return variant.salePrice ?? variant.regularPrice;
    };
    const smallestSku = (product: ProductRecord) =>
      [...product.variants.map((variant) => variant.sku)].sort()[0] ?? "";
    const rows = ctx.db.products
      .filter(
        (product) =>
          (!status || product.status === status) &&
          (!inside || inside.has(product.categoryId)) &&
          (isAvailable === undefined || product.isAvailable === isAvailable) &&
          (onSale === undefined ||
            product.variants.some(
              (variant) => variant.isEnabled && variant.salePrice !== null,
            ) === onSale) &&
          (lowStock === undefined ||
            stockOverview(product).isLow === lowStock) &&
          (!q || matchesSearch(product, q)),
      )
      .sort((a, b) => {
        if (sort === "updated") return a.updatedAt < b.updatedAt ? 1 : -1;
        if (sort === "name") return a.name.en.localeCompare(b.name.en);
        if (sort === "sku") return smallestSku(a).localeCompare(smallestSku(b));
        if (sort === "price_asc") return priceFrom(a) - priceFrom(b);
        if (sort === "price_desc") return priceFrom(b) - priceFrom(a);
        return a.id < b.id ? 1 : -1;
      });
    const result = page(rows, ctx.query);
    return json({
      ...result,
      items: result.items.map((product) => productSummary(ctx.db, product)),
    });
  });

  router.post(products, { permission: "catalog.manage" }, async (ctx) => {
    const input = await ctx.body(createProduct);
    if (!ctx.db.categories.some((entry) => entry.id === input.categoryId)) {
      throw fail(404, "CATEGORY_NOT_FOUND", "The category was not found.");
    }
    const min = input.minOrderQuantity ?? 1;
    const max = input.maxOrderQuantity ?? null;
    assertQuantities(min, max);
    assertPackSizes(
      input.variants.map((variant) => variant.packSize),
      input.variants.map((variant) => variant.sku?.toUpperCase()),
    );
    const slug = {
      en: input.slug?.en ?? slugify(input.name.en),
      de: input.slug?.de ?? (input.name.de ? slugify(input.name.de) : null),
    };
    assertProductSlugFree(
      ctx.db,
      slug,
      input.variants.map((variant) => variant.packSize),
    );
    const status = input.status ?? "draft";
    const product: ProductRecord = {
      id: newId(ctx.now),
      name: input.name,
      slug,
      brand: null,
      vatRate: input.vatRate,
      status,
      isAvailable: true,
      isFeatured: false,
      sortOrder: 0,
      subtitle: null,
      shortDescription: null,
      description: null,
      highlights: null,
      uses: null,
      categoryId: input.categoryId,
      minOrderQuantity: min,
      maxOrderQuantity: max,
      storageType: "ambient",
      variants: [],
      food: null,
      tags: [],
      searchKeywords: [],
      seo: null,
      images: [],
      publishedAt: status === "active" ? iso(ctx.now) : null,
      createdAt: iso(ctx.now),
      updatedAt: iso(ctx.now),
    };
    applyProductFields(product, input);
    // The article numbers and the prices are checked before anything is kept.
    for (const variant of input.variants) {
      createVariant(ctx.db, product, variant, ctx.admin.id, ctx.now);
    }
    ctx.db.products.push(product);
    return json({ product: productDetail(ctx.db, product) }, 201);
  });

  router.get(`${products}/:id`, { permission: "catalog.read" }, (ctx) =>
    json({
      product: productDetail(ctx.db, productById(ctx.db, ctx.params.id ?? "")),
    }),
  );

  router.patch(
    `${products}/:id`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(updateProduct);
      const product = productById(ctx.db, ctx.params.id ?? "");
      if (
        input.categoryId !== undefined &&
        !ctx.db.categories.some((entry) => entry.id === input.categoryId)
      ) {
        throw fail(404, "CATEGORY_NOT_FOUND", "The category was not found.");
      }
      const min = input.minOrderQuantity ?? product.minOrderQuantity;
      const max =
        input.maxOrderQuantity === undefined
          ? product.maxOrderQuantity
          : input.maxOrderQuantity;
      assertQuantities(min, max);
      if (input.slug !== undefined) {
        // A new base slug renames the URL of every pack size (8).
        const slug = {
          en: input.slug.en ?? product.slug.en,
          de: input.slug.de ?? product.slug.de ?? null,
        };
        assertProductSlugFree(
          ctx.db,
          slug,
          product.variants.map((variant) => variant.packSize),
          product.id,
        );
        product.slug = slug;
      }
      const vatRate = input.vatRate ?? product.vatRate;
      const vatChanged = vatRate !== product.vatRate;
      product.vatRate = vatRate;
      product.minOrderQuantity = min;
      product.maxOrderQuantity = max;
      if (input.categoryId !== undefined) product.categoryId = input.categoryId;
      if (input.status !== undefined) {
        product.status = input.status;
        if (input.status === "active") product.publishedAt ??= iso(ctx.now);
      }
      applyProductFields(product, input);
      product.updatedAt = iso(ctx.now);
      // A new VAT rate is an entry in the price history of every pack size (8).
      if (vatChanged) {
        for (const variant of product.variants)
          logPrice(ctx.db, product, variant, ctx.admin.id, ctx.now);
      }
      return json({ product: productDetail(ctx.db, product) });
    },
  );

  router.delete(`${products}/:id`, { permission: "catalog.manage" }, (ctx) => {
    const product = productById(ctx.db, ctx.params.id ?? "");
    if (product.status === "active") {
      throw fail(
        409,
        "PRODUCT_IS_ACTIVE",
        "Archive the product before deleting it.",
      );
    }
    const orders = productInUse(ctx.db, product.id);
    if (orders > 0) {
      throw fail(
        409,
        "PRODUCT_IN_USE",
        `The product cannot be deleted. It is part of ${orders} order(s). Archive it instead.`,
      );
    }
    ctx.db.products = ctx.db.products.filter(
      (entry) => entry.id !== product.id,
    );
    return noContent();
  });

  // --- The pack sizes of a product --------------------------------------------

  router.post(
    `${products}/:id/variants`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(zCreateVariant);
      const product = productById(ctx.db, ctx.params.id ?? "");
      if (product.variants.length >= 20) {
        throw fail(
          400,
          "PRODUCT_VARIANT_INVALID",
          "The product has 20 pack sizes already.",
        );
      }
      assertPackSizes(
        [...product.variants.map((entry) => entry.packSize), input.packSize],
        [
          ...product.variants.map((entry) => entry.sku),
          input.sku?.toUpperCase(),
        ],
      );
      assertProductSlugFree(ctx.db, product.slug, [input.packSize], product.id);
      createVariant(ctx.db, product, input, ctx.admin.id, ctx.now);
      product.updatedAt = iso(ctx.now);
      return json({ product: productDetail(ctx.db, product) }, 201);
    },
  );

  router.patch(
    `${products}/:id/variants/:variantId`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(zUpdateVariant);
      const product = productById(ctx.db, ctx.params.id ?? "");
      const variant = variantById(product, ctx.params.variantId ?? "");
      applyVariantPatch(ctx.db, product, variant, input, ctx.admin.id, ctx.now);
      return json({ product: productDetail(ctx.db, product) });
    },
  );

  router.delete(
    `${products}/:id/variants/:variantId`,
    { permission: "catalog.manage" },
    (ctx) => {
      const product = productById(ctx.db, ctx.params.id ?? "");
      const variant = variantById(product, ctx.params.variantId ?? "");
      if (product.variants.length === 1) {
        throw fail(
          409,
          "PRODUCT_VARIANT_LAST",
          "A product needs at least one pack size. Disable it, or delete the product.",
        );
      }
      const orders = variantInUse(ctx.db, variant.id);
      if (orders > 0) {
        throw fail(
          409,
          "PRODUCT_VARIANT_IN_USE",
          `The pack size cannot be removed. It is part of ${orders} order(s). Disable it instead.`,
        );
      }
      // The price history goes with it; the stock history is kept (8).
      product.variants = product.variants.filter(
        (entry) => entry.id !== variant.id,
      );
      ctx.db.priceChanges.delete(variant.id);
      product.updatedAt = iso(ctx.now);
      return json({ product: productDetail(ctx.db, product) });
    },
  );

  router.get(
    `${products}/:id/variants/:variantId/price-history`,
    { permission: "catalog.read" },
    (ctx) => {
      const product = productById(ctx.db, ctx.params.id ?? "");
      const variant = variantById(product, ctx.params.variantId ?? "");
      return json({ items: ctx.db.priceChanges.get(variant.id) ?? [] });
    },
  );

  // --- Images of a product --------------------------------------------------

  router.post(
    `${products}/:id/images`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const product = productById(ctx.db, ctx.params.id ?? "");
      const files = await uploadedFiles(ctx.request, "files", 10);
      const remaining = 12 - product.images.length;
      if (files.length > remaining) {
        throw fail(
          400,
          "IMAGE_LIMIT_REACHED",
          "A product can have 12 images at most.",
          {
            maximum: 12,
            remaining,
          },
        );
      }
      // All or nothing: every file is checked before one is stored, and
      // the error names every refused file (8).
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
      return json({ product: productDetail(ctx.db, product) }, 201);
    },
  );

  router.put(
    `${products}/:id/images/order`,
    { permission: "catalog.manage" },
    async (ctx) => {
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
      return json({ product: productDetail(ctx.db, product) });
    },
  );

  router.put(
    `${products}/:id/images/:imageId`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const product = productById(ctx.db, ctx.params.id ?? "");
      const image = imageOf(product, ctx.params.imageId ?? "");
      const [file] = await uploadedFiles(ctx.request, "file", 1);
      const stored = storeImage(ctx.db, await readImage(file as File), ctx.now);
      // Position, description and main-image setting are kept.
      Object.assign(image, {
        url: stored.url,
        sizes: stored.sizes,
        bytes: stored.bytes,
        uploadedAt: stored.uploadedAt,
      });
      product.updatedAt = iso(ctx.now);
      return json({ product: productDetail(ctx.db, product) });
    },
  );

  router.patch(
    `${products}/:id/images/:imageId`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(imagePatch);
      const product = productById(ctx.db, ctx.params.id ?? "");
      const image = imageOf(product, ctx.params.imageId ?? "");
      if (input.alt !== undefined) image.alt = { ...image.alt, ...input.alt };
      if (input.isPrimary) {
        for (const entry of product.images)
          entry.isPrimary = entry.id === image.id;
      }
      product.updatedAt = iso(ctx.now);
      return json({ product: productDetail(ctx.db, product) });
    },
  );

  router.delete(
    `${products}/:id/images/:imageId`,
    { permission: "catalog.manage" },
    (ctx) => {
      const product = productById(ctx.db, ctx.params.id ?? "");
      const image = imageOf(product, ctx.params.imageId ?? "");
      product.images = product.images.filter((entry) => entry.id !== image.id);
      ensurePrimary(product);
      product.updatedAt = iso(ctx.now);
      return json({ product: productDetail(ctx.db, product) });
    },
  );
}
