// Sections 7 (categories) and 8 (products and images).

import { z } from "zod";
import type { AdminImage } from "../../src/lib/api/types/index.ts";
import type { CategoryRecord, Db, ProductRecord } from "../db.ts";
import {
  ancestorsOf,
  categoryView,
  descendantIds,
  orderedCategories,
  packLabel,
  productDetail,
  productSummary,
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

const productFields = {
  sku: z.string().optional(),
  gtin: z
    .string()
    .regex(/^(\d{8}|\d{12,14})$/, "gtin must have 8, 12, 13 or 14 digits")
    .nullish(),
  slug: zSlug.optional(),
  subtitle: zTranslatedOptional(300).optional(),
  shortDescription: zTranslatedOptional(300).optional(),
  description: zTranslatedOptional(20000).optional(),
  highlights: zList.optional(),
  uses: zList.optional(),
  brand: z.string().max(80).nullish(),
  variantOf: zId.nullish(),
  salePrice: zCents(1).nullish(),
  discountPercent: z.number().int().min(1).max(99).nullish(),
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
  packSize: zPack,
  regularPrice: zCents(1),
  vatRate: z.number().int().min(0).max(10000),
  ...productFields,
});
const updateProduct = z.strictObject({
  name: zTranslated(160).optional(),
  categoryId: zId.optional(),
  packSize: zPack.optional(),
  regularPrice: zCents(1).optional(),
  vatRate: z.number().int().min(0).max(10000).optional(),
  ...productFields,
});
const duplicateProduct = z.strictObject({
  sku: z.string().optional(),
  packSize: zPack,
  regularPrice: zCents(1),
  salePrice: zCents(1).nullish(),
  discountPercent: z.number().int().min(1).max(99).nullish(),
  asVariant: z.boolean().optional(),
  copyImages: z.boolean().optional(),
});
const imagePatch = z.strictObject({
  alt: zTranslatedOptional(300).optional(),
  isPrimary: z.literal(true, "isPrimary may only be true").optional(),
});

export type ProductInput = z.output<typeof updateProduct>;

function productById(db: Db, id: string): ProductRecord {
  const product = db.products.find((entry) => entry.id === id);
  if (!product)
    throw fail(404, "PRODUCT_NOT_FOUND", "The product was not found.");
  return product;
}

export function normalSku(
  db: Db,
  sku: string | undefined,
  exceptId?: string,
): string {
  if (sku === undefined) {
    do {
      db.counters.sku += 1;
    } while (
      db.products.some(
        (entry) =>
          entry.sku === `RF-${String(db.counters.sku).padStart(5, "0")}`,
      )
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
  if (
    db.products.some((entry) => entry.id !== exceptId && entry.sku === upper)
  ) {
    throw fail(409, "PRODUCT_SKU_TAKEN", "Another product has this SKU.");
  }
  return upper;
}

export function assertProductSlugFree(
  db: Db,
  slug: { en: string; de?: string | null },
  exceptId?: string,
): void {
  const taken = db.products.some(
    (entry) =>
      entry.id !== exceptId &&
      (entry.slug.en === slug.en || (slug.de && entry.slug.de === slug.de)),
  );
  if (taken)
    throw fail(409, "PRODUCT_SLUG_TAKEN", "Another product uses this slug.");
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

/** Joins the pack sizes of another product, or leaves the group (`null`). */
export function applyVariantOf(
  db: Db,
  product: ProductRecord,
  variantOf: string | null,
): void {
  const oldGroup = product.variantGroupId;
  if (variantOf === null) {
    product.variantGroupId = null;
    product.isDefaultVariant = true;
  } else {
    const target = db.products.find((entry) => entry.id === variantOf);
    if (!target || target.id === product.id) {
      throw fail(
        400,
        "PRODUCT_VARIANT_INVALID",
        "variantOf is the product itself or unknown.",
      );
    }
    if (!target.variantGroupId) {
      target.variantGroupId = newId();
      target.isDefaultVariant = true;
    }
    product.variantGroupId = target.variantGroupId;
    product.isDefaultVariant = false;
  }
  if (oldGroup && oldGroup !== product.variantGroupId) {
    const left = db.products.filter(
      (entry) => entry.variantGroupId === oldGroup,
    );
    if (left.length === 1 && left[0]) {
      left[0].variantGroupId = null;
      left[0].isDefaultVariant = true;
    } else if (
      left.length > 1 &&
      !left.some((entry) => entry.isDefaultVariant) &&
      left[0]
    ) {
      left[0].isDefaultVariant = true;
    }
  }
}

export function logPrice(
  db: Db,
  product: ProductRecord,
  adminId: string,
  now: number,
): void {
  const history = db.priceChanges.get(product.id) ?? [];
  history.unshift({
    regularPrice: product.regularPrice,
    salePrice: product.salePrice,
    price: product.salePrice ?? product.regularPrice,
    vatRate: product.vatRate,
    changedBy: adminId,
    changedAt: iso(now),
  });
  db.priceChanges.set(product.id, history.slice(0, 200));
}

export function applyProductFields(
  product: ProductRecord,
  input: ProductInput,
): void {
  if (input.gtin !== undefined) product.gtin = input.gtin;
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
  const haystack = [
    product.name.en,
    product.name.de ?? "",
    product.subtitle?.en ?? "",
    product.sku,
    product.brand ?? "",
    ...product.searchKeywords,
    ...product.tags,
  ]
    .join(" ")
    .toLowerCase()
    .split(/[\s-]+/);
  return (
    product.sku.toLowerCase().startsWith(q.toLowerCase()) ||
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
    const variantGroupId = idParam(ctx.query, "variantGroupId");
    const isAvailable = boolParam(ctx.query, "isAvailable");
    const onSale = boolParam(ctx.query, "onSale");
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
    const price = (product: ProductRecord) =>
      product.salePrice ?? product.regularPrice;
    const rows = ctx.db.products
      .filter(
        (product) =>
          (!status || product.status === status) &&
          (!inside || inside.has(product.categoryId)) &&
          (!variantGroupId || product.variantGroupId === variantGroupId) &&
          (isAvailable === undefined || product.isAvailable === isAvailable) &&
          (onSale === undefined || (product.salePrice !== null) === onSale) &&
          (!q || matchesSearch(product, q)),
      )
      .sort((a, b) => {
        if (sort === "updated") return a.updatedAt < b.updatedAt ? 1 : -1;
        if (sort === "name")
          return (
            a.name.en.localeCompare(b.name.en) ||
            a.packSize.value - b.packSize.value
          );
        if (sort === "sku") return a.sku.localeCompare(b.sku);
        if (sort === "price_asc") return price(a) - price(b);
        if (sort === "price_desc") return price(b) - price(a);
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
    const salePrice = resolveSale(input.regularPrice, input, null);
    const min = input.minOrderQuantity ?? 1;
    const max = input.maxOrderQuantity ?? null;
    assertQuantities(min, max);
    const sku = normalSku(ctx.db, input.sku);
    const label = packLabel(input.packSize.value, input.packSize.unit);
    const slug = {
      en: input.slug?.en ?? slugify(`${input.name.en} ${label}`),
      de:
        input.slug?.de ??
        (input.name.de ? slugify(`${input.name.de} ${label}`) : null),
    };
    assertProductSlugFree(ctx.db, slug);
    const status = input.status ?? "draft";
    const product: ProductRecord = {
      id: newId(ctx.now),
      sku,
      gtin: null,
      name: input.name,
      slug,
      brand: null,
      packSize: { ...input.packSize, label },
      regularPrice: input.regularPrice,
      salePrice,
      vatRate: input.vatRate,
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
      categoryId: input.categoryId,
      minOrderQuantity: min,
      maxOrderQuantity: max,
      storageType: "ambient",
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
    ctx.db.products.push(product);
    if (input.variantOf) applyVariantOf(ctx.db, product, input.variantOf);
    logPrice(ctx.db, product, ctx.admin.id, ctx.now);
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
      const regularPrice = input.regularPrice ?? product.regularPrice;
      const salePrice = resolveSale(regularPrice, input, product.salePrice);
      const min = input.minOrderQuantity ?? product.minOrderQuantity;
      const max =
        input.maxOrderQuantity === undefined
          ? product.maxOrderQuantity
          : input.maxOrderQuantity;
      assertQuantities(min, max);
      const sku =
        input.sku === undefined
          ? product.sku
          : normalSku(ctx.db, input.sku, product.id);
      if (input.slug !== undefined) {
        const slug = {
          en: input.slug.en ?? product.slug.en,
          de: input.slug.de ?? product.slug.de ?? null,
        };
        assertProductSlugFree(ctx.db, slug, product.id);
        product.slug = slug;
      }
      if (input.variantOf !== undefined)
        applyVariantOf(ctx.db, product, input.variantOf);

      const vatRate = input.vatRate ?? product.vatRate;
      const priceChanged =
        regularPrice !== product.regularPrice ||
        salePrice !== product.salePrice ||
        vatRate !== product.vatRate;
      product.sku = sku;
      product.regularPrice = regularPrice;
      product.salePrice = salePrice;
      product.vatRate = vatRate;
      product.minOrderQuantity = min;
      product.maxOrderQuantity = max;
      if (input.categoryId !== undefined) product.categoryId = input.categoryId;
      if (input.packSize !== undefined) {
        product.packSize = {
          ...input.packSize,
          label: packLabel(input.packSize.value, input.packSize.unit),
        };
      }
      if (input.status !== undefined) {
        product.status = input.status;
        if (input.status === "active") product.publishedAt ??= iso(ctx.now);
      }
      applyProductFields(product, input);
      product.updatedAt = iso(ctx.now);
      if (priceChanged) logPrice(ctx.db, product, ctx.admin.id, ctx.now);
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
    if (ctx.db.cargoProducts.some((entry) => entry.productId === product.id)) {
      throw fail(
        409,
        "PRODUCT_IN_USE",
        "The product is part of a cargo. Archive it instead.",
      );
    }
    if (product.variantGroupId) applyVariantOf(ctx.db, product, null);
    ctx.db.products = ctx.db.products.filter(
      (entry) => entry.id !== product.id,
    );
    return noContent();
  });

  router.post(
    `${products}/:id/duplicate`,
    { permission: "catalog.manage" },
    async (ctx) => {
      const input = await ctx.body(duplicateProduct);
      const source = productById(ctx.db, ctx.params.id ?? "");
      const salePrice = resolveSale(input.regularPrice, input, null);
      const sku = normalSku(ctx.db, input.sku);
      const label = packLabel(input.packSize.value, input.packSize.unit);
      const slug = {
        en: slugify(`${source.name.en} ${label}`),
        de: source.name.de ? slugify(`${source.name.de} ${label}`) : null,
      };
      assertProductSlugFree(ctx.db, slug);
      const copy: ProductRecord = {
        ...structuredClone(source),
        id: newId(ctx.now),
        sku,
        slug,
        packSize: { ...input.packSize, label },
        regularPrice: input.regularPrice,
        salePrice,
        status: "draft",
        variantGroupId: null,
        isDefaultVariant: true,
        images:
          input.copyImages === false
            ? []
            : source.images.map((image) => ({
                ...structuredClone(image),
                id: newId(ctx.now),
              })),
        publishedAt: null,
        createdAt: iso(ctx.now),
        updatedAt: iso(ctx.now),
      };
      ctx.db.products.push(copy);
      if (input.asVariant !== false) applyVariantOf(ctx.db, copy, source.id);
      logPrice(ctx.db, copy, ctx.admin.id, ctx.now);
      return json({ product: productDetail(ctx.db, copy) }, 201);
    },
  );

  router.post(
    `${products}/:id/make-default`,
    { permission: "catalog.manage" },
    (ctx) => {
      const product = productById(ctx.db, ctx.params.id ?? "");
      if (!product.variantGroupId) {
        throw fail(
          400,
          "PRODUCT_VARIANT_INVALID",
          "The product has no other pack sizes.",
        );
      }
      for (const entry of ctx.db.products) {
        if (entry.variantGroupId === product.variantGroupId) {
          entry.isDefaultVariant = entry.id === product.id;
        }
      }
      return json({ product: productDetail(ctx.db, product) });
    },
  );

  router.get(
    `${products}/:id/price-history`,
    { permission: "catalog.read" },
    (ctx) => {
      const product = productById(ctx.db, ctx.params.id ?? "");
      return json({ items: ctx.db.priceChanges.get(product.id) ?? [] });
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
