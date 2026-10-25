import { z } from "zod";
import { hasErrorCode } from "@/lib/api/errors";
import type {
  Cents,
  PackUnit,
  ProductDetail,
  ProductFoodInput,
  ProductInput,
  ProductPatch,
  ProductStatus,
  ProductVariant,
  StorageType,
  Translated,
  TranslatedOptional,
  VariantInput,
  VariantPatch,
} from "@/lib/api/types";
import {
  centsToInput,
  formatMoney,
  parseEuros,
  parseVatRate,
  rateToInput,
} from "@/lib/format/money";
import {
  translatedDefaults,
  zEuros,
  zInt,
  zOptionalInt,
  zVatRate,
} from "@/lib/validation";
import { VARIANTS_MAX, packLabelOf, rowProblems } from "./variants";

// The rules of the API for a product and its pack sizes (documentation,
// 8), mirrored one to one. The form holds what the admin typed; the
// functions at the end make of it what the API gets: `POST /products` with
// `variants[]` for a new product, and for an existing one a plan of the
// product patch and the pack sizes to add, change and remove.

export const PACK_UNITS = [
  "g",
  "kg",
  "ml",
  "l",
  "pcs",
] as const satisfies readonly PackUnit[];
export const PRODUCT_STATUSES = [
  "draft",
  "active",
  "archived",
] as const satisfies readonly ProductStatus[];
export const STORAGE_TYPES = [
  "ambient",
  "chilled",
  "frozen",
] as const satisfies readonly StorageType[];
/** A sale is given EITHER as a price OR as a percentage, never both. */
export const SALE_MODES = ["none", "price", "percent"] as const;
export type SaleMode = (typeof SALE_MODES)[number];

export const LIMITS = {
  name: 160,
  short: 300,
  long: 20000,
  brand: 80,
  slug: 120,
  listEntries: 20,
  listEntry: 300,
  origin: 120,
  manufacturer: 500,
  tags: 20,
  tag: 40,
  keywords: 30,
  keywordMin: 2,
  keywordMax: 60,
  priceMin: 1,
  priceMax: 10_000_000,
  /** Packs in a carton (24). */
  cartonMax: 1000,
  packMin: 0.001,
  packMax: 1_000_000,
  sortOrderMax: 1_000_000,
  quantityMax: 10_000,
  stockMax: 1_000_000,
  variants: VARIANTS_MAX,
} as const;

const SKU = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
const GTIN = /^(\d{8}|\d{12,14})$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// --- Reading what was typed --------------------------------------------------

/** The entries of a list typed one per line; empty lines do not count. */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/**
 * A pack size as typed: `5`, `0.5`, `0,5`, `1.250`. At most three decimals;
 * `null` when it is not a number.
 */
export function parsePackValue(text: string): number | null {
  const match = /^(\d{1,7})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(`${match[1]}.${match[2] ?? "0"}`);
}

/** `Gluten Free` becomes `gluten-free`: tags are lower-case words joined by hyphens. */
export function toTag(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.tag)
    .replace(/-+$/g, "");
}

// --- The schema ---------------------------------------------------------------

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `At most ${max.toLocaleString("en")} characters.`);
const translated = (max: number) => z.object({ en: text(max), de: text(max) });

/** A typed value that must satisfy one of the shared rules; it stays text. */
function following(rule: z.ZodType<unknown, string>) {
  return z.string().superRefine((value, context) => {
    const result = rule.safeParse(value);
    if (result.success) return;
    for (const issue of result.error.issues) {
      context.addIssue({ code: "custom", message: issue.message });
    }
  });
}

const price = () => zEuros({ min: LIMITS.priceMin, max: LIMITS.priceMax });

const packSizeFields = z.object({
  value: z.string().superRefine((value, context) => {
    const parsed = parsePackValue(value);
    if (parsed === null) {
      context.addIssue({
        code: "custom",
        message:
          value.trim() === ""
            ? "Enter the pack size."
            : "A number with at most three decimals. Example: 0.5",
      });
    } else if (parsed < LIMITS.packMin || parsed > LIMITS.packMax) {
      context.addIssue({
        code: "custom",
        message: "Between 0.001 and 1,000,000.",
      });
    }
  }),
  unit: z.enum(PACK_UNITS),
});

const slug = z
  .string()
  .trim()
  .max(LIMITS.slug, `At most ${LIMITS.slug} characters.`)
  .refine(
    (value) => value === "" || SLUG.test(value),
    "Lower-case letters, digits and single hyphens. Example: basmati-rice",
  );

const lines = z.string().superRefine((value, context) => {
  const entries = linesOf(value);
  if (entries.length > LIMITS.listEntries) {
    context.addIssue({
      code: "custom",
      message: `At most ${LIMITS.listEntries} entries, one per line. There are ${entries.length}.`,
    });
  }
  if (entries.some((entry) => entry.length > LIMITS.listEntry)) {
    context.addIssue({
      code: "custom",
      message: `An entry has at most ${LIMITS.listEntry} characters.`,
    });
  }
});

const saleFields = {
  regularPrice: following(price()),
  saleMode: z.enum(SALE_MODES),
  salePrice: z.string(),
  discountPercent: z.string(),
};

type SaleValues = {
  regularPrice: string;
  saleMode: SaleMode;
  salePrice: string;
  discountPercent: string;
};

/** The sale price lies below the regular price; a percentage is 1 to 99. */
function checkSale(
  value: SaleValues,
  context: z.RefinementCtx,
  path: (string | number)[] = [],
): void {
  if (value.saleMode === "price") {
    const result = price().safeParse(value.salePrice);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        path: [...path, "salePrice"],
        message:
          value.salePrice.trim() === ""
            ? "Enter the sale price, or choose “No sale”."
            : (result.error.issues[0]?.message ?? "This is not an amount."),
      });
      return;
    }
    const regular = parseEuros(value.regularPrice);
    if (regular !== null && result.data >= regular) {
      context.addIssue({
        code: "custom",
        path: [...path, "salePrice"],
        message: `The sale price must be below the regular price (${formatMoney(regular)}).`,
      });
    }
  }
  if (value.saleMode === "percent") {
    const result = zInt({ min: 1, max: 99 }).safeParse(value.discountPercent);
    if (!result.success) {
      context.addIssue({
        code: "custom",
        path: [...path, "discountPercent"],
        message:
          value.discountPercent.trim() === ""
            ? "Enter the discount, or choose “No sale”."
            : "A whole number from 1 to 99.",
      });
    }
  }
}

/** One row of the pack-size table: a pack size of the product (8). */
const variantRowFields = z.object({
  /** The id of the pack size; empty for one that is not saved yet. */
  variantId: z.string(),
  sku: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || SKU.test(value.toUpperCase()),
      "2 to 40 characters: letters, digits, dot, underscore or hyphen, starting with a letter or a digit.",
    ),
  gtin: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || GTIN.test(value),
      "8, 12, 13 or 14 digits.",
    ),
  packSize: packSizeFields,
  /** Packs in a carton for wholesale quotations; empty: no carton. */
  unitsPerCarton: following(zOptionalInt({ min: 1, max: LIMITS.cartonMax })),
  ...saleFields,
  isEnabled: z.boolean(),
  /** Empty: no threshold, never warned. */
  lowStockThreshold: following(zOptionalInt({ min: 0, max: LIMITS.stockMax })),
  /** The opening stock of a new pack size; a saved one changes it in the stock dialog. */
  stockQuantity: following(zOptionalInt({ min: 0, max: LIMITS.stockMax })),
  /** Marked for removal: deleted when the product is saved. */
  removed: z.boolean(),
});

export type VariantRowValues = z.input<typeof variantRowFields>;

const productFields = z.object({
  name: z.object({
    en: text(LIMITS.name).min(1, "The English name is required."),
    de: text(LIMITS.name),
  }),
  subtitle: translated(LIMITS.short),
  brand: text(LIMITS.brand),
  categoryId: z.string().regex(/^[0-9a-f]{24}$/, "Choose a category."),
  variants: z.array(variantRowFields),
  vatRate: following(zVatRate),
  status: z.enum(PRODUCT_STATUSES),
  isAvailable: z.boolean(),
  isFeatured: z.boolean(),
  /** The position in its category, 0 first; empty on a new product: the last position. */
  sortOrder: following(zOptionalInt({ min: 0, max: LIMITS.sortOrderMax })),
  minOrderQuantity: following(zInt({ min: 1, max: LIMITS.quantityMax })),
  maxOrderQuantity: following(
    zOptionalInt({ min: 1, max: LIMITS.quantityMax }),
  ),
  storageType: z.enum(STORAGE_TYPES).or(z.literal("")),
  shortDescription: translated(LIMITS.short),
  description: translated(LIMITS.long),
  highlights: z.object({ en: lines, de: lines }),
  uses: z.object({ en: lines, de: lines }),
  food: z.object({
    ingredients: translated(LIMITS.long),
    allergens: translated(LIMITS.long),
    nutrition: translated(LIMITS.long),
    storageInstructions: translated(LIMITS.long),
    origin: text(LIMITS.origin),
    manufacturer: text(LIMITS.manufacturer),
  }),
  tags: z
    .array(z.string())
    .max(LIMITS.tags, `At most ${LIMITS.tags} tags.`)
    .refine(
      (tags) => tags.every((tag) => tag.length <= LIMITS.tag && SLUG.test(tag)),
      `A tag is made of lower-case letters, digits and hyphens, ${LIMITS.tag} characters at most.`,
    )
    .refine(
      (tags) => new Set(tags).size === tags.length,
      "Each tag only once.",
    ),
  searchKeywords: z
    .array(z.string())
    .max(LIMITS.keywords, `At most ${LIMITS.keywords} keywords.`)
    .refine(
      (keywords) =>
        keywords.every(
          (keyword) =>
            keyword.trim().length >= LIMITS.keywordMin &&
            keyword.trim().length <= LIMITS.keywordMax,
        ),
      `A keyword has ${LIMITS.keywordMin} to ${LIMITS.keywordMax} characters.`,
    ),
  seo: z.object({
    title: translated(LIMITS.short),
    description: translated(LIMITS.short),
  }),
  slug: z.object({ en: slug, de: slug }),
});

export type ProductFormValues = z.input<typeof productFields>;

/**
 * The schema of the product form. A new product may leave the article
 * numbers and the address empty (the API generates them); an existing one
 * keeps its address, and a saved pack size keeps its article number. The
 * rules of the pack sizes among themselves are checked here as well.
 */
export function productSchema(options: { creating: boolean }) {
  return productFields.superRefine((value, context) => {
    const min = Number(value.minOrderQuantity.trim());
    const max = value.maxOrderQuantity.trim();
    if (
      max !== "" &&
      /^\d+$/.test(max) &&
      Number.isInteger(min) &&
      Number(max) < min
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxOrderQuantity"],
        message: `Must not be below the smallest quantity (${min}).`,
      });
    }
    if (!options.creating && value.slug.en.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["slug", "en"],
        message: "A product keeps its address. Type one.",
      });
    }
    value.variants.forEach((row, index) => {
      if (row.removed) return;
      checkSale(row, context, ["variants", index]);
      if (row.variantId !== "" && row.sku.trim() === "") {
        context.addIssue({
          code: "custom",
          path: ["variants", index, "sku"],
          message: "A pack size keeps its article number. Type one.",
        });
      }
    });
    for (const problem of rowProblems(value.variants)) {
      context.addIssue({
        code: "custom",
        path:
          problem.index < 0
            ? ["variants"]
            : ["variants", problem.index, ...problem.field.split(".")],
        message: problem.message,
      });
    }
  });
}

// --- What the form starts with ------------------------------------------------

/** A row of the table for a pack size the product has. */
export function variantRow(variant: ProductVariant): VariantRowValues {
  const sale = variant.pricing.salePrice;
  return {
    variantId: variant.id,
    sku: variant.sku,
    gtin: variant.gtin ?? "",
    unitsPerCarton:
      variant.unitsPerCarton === null ? "" : String(variant.unitsPerCarton),
    packSize: {
      value: String(variant.packSize.value),
      unit: variant.packSize.unit,
    },
    regularPrice: centsToInput(variant.pricing.regularPrice),
    // The API stores a sale as a price; a percentage is a way to type it.
    saleMode: sale === null ? "none" : "price",
    salePrice: centsToInput(sale),
    discountPercent: "",
    isEnabled: variant.isEnabled,
    lowStockThreshold:
      variant.stock.lowStockThreshold === null
        ? ""
        : String(variant.stock.lowStockThreshold),
    stockQuantity: "",
    removed: false,
  };
}

/** An empty row for a pack size that is typed now; the unit follows the others. */
export function emptyVariantRow(unit: PackUnit = "g"): VariantRowValues {
  return {
    variantId: "",
    sku: "",
    gtin: "",
    unitsPerCarton: "",
    packSize: { value: "", unit },
    regularPrice: "",
    saleMode: "none",
    salePrice: "",
    discountPercent: "",
    isEnabled: true,
    lowStockThreshold: "",
    stockQuantity: "0",
    removed: false,
  };
}

export function productDefaults(product?: ProductDetail): ProductFormValues {
  return {
    name: translatedDefaults(product?.name),
    subtitle: translatedDefaults(product?.subtitle),
    brand: product?.brand ?? "",
    categoryId: product?.categoryId ?? "",
    variants: product ? product.variants.map(variantRow) : [emptyVariantRow()],
    vatRate: rateToInput(product?.vatRate),
    status: product?.status ?? "draft",
    isAvailable: product?.isAvailable ?? true,
    isFeatured: product?.isFeatured ?? false,
    sortOrder: product ? String(product.sortOrder) : "",
    minOrderQuantity: String(product?.minOrderQuantity ?? 1),
    maxOrderQuantity:
      product?.maxOrderQuantity === null ||
      product?.maxOrderQuantity === undefined
        ? ""
        : String(product.maxOrderQuantity),
    storageType: product ? (product.storageType ?? "") : "ambient",
    shortDescription: translatedDefaults(product?.shortDescription),
    description: translatedDefaults(product?.description),
    highlights: listDefaults(product?.highlights),
    uses: listDefaults(product?.uses),
    food: {
      ingredients: translatedDefaults(product?.food?.ingredients),
      allergens: translatedDefaults(product?.food?.allergens),
      nutrition: translatedDefaults(product?.food?.nutrition),
      storageInstructions: translatedDefaults(
        product?.food?.storageInstructions,
      ),
      origin: product?.food?.origin ?? "",
      manufacturer: product?.food?.manufacturer ?? "",
    },
    tags: [...(product?.tags ?? [])],
    searchKeywords: [...(product?.searchKeywords ?? [])],
    seo: {
      title: translatedDefaults(product?.seo?.title),
      description: translatedDefaults(product?.seo?.description),
    },
    slug: translatedDefaults(product?.slug),
  };
}

function listDefaults(
  list: { en?: string[]; de?: string[] } | null | undefined,
): { en: string; de: string } {
  return { en: (list?.en ?? []).join("\n"), de: (list?.de ?? []).join("\n") };
}

/** The words for a row: its pack as typed, or "a new pack size". */
export function rowLabel(row: Pick<VariantRowValues, "packSize">): string {
  return (
    packLabelOf(row.packSize.value, row.packSize.unit) || "a new pack size"
  );
}

// --- What the API gets ---------------------------------------------------------

type Both = { en: string; de: string };

/** Both languages named: an empty one is `null`, which clears it. */
function optional(value: Both): TranslatedOptional {
  return { en: value.en.trim() || null, de: value.de.trim() || null };
}

function isEmpty(value: TranslatedOptional): boolean {
  return !value.en && !value.de;
}

/** Only the languages that are filled: an address cannot be cleared. */
function filled(value: Both): TranslatedOptional {
  const result: TranslatedOptional = {};
  if (value.en.trim()) result.en = value.en.trim();
  if (value.de.trim()) result.de = value.de.trim();
  return result;
}

/**
 * Every product field of the form as the API takes it on `PATCH`, where a
 * translated field, a list and `food` replace what was there: nothing is
 * left out, an empty value is sent as what clears it.
 */
interface Complete {
  name: Translated;
  slug: TranslatedOptional;
  subtitle: TranslatedOptional;
  shortDescription: TranslatedOptional;
  description: TranslatedOptional;
  highlights: { en: string[]; de: string[] };
  uses: { en: string[]; de: string[] };
  brand: string | null;
  categoryId: string;
  vatRate: number;
  status: ProductStatus;
  isAvailable: boolean;
  isFeatured: boolean;
  sortOrder: number | null;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  storageType: StorageType | "";
  food: ProductFoodInput;
  tags: string[];
  searchKeywords: string[];
  seo: { title: TranslatedOptional; description: TranslatedOptional };
}

function integer(text: string): number {
  return Number.parseInt(text.trim(), 10);
}

function complete(values: ProductFormValues): Complete {
  const food: ProductFoodInput = {
    ingredients: optional(values.food.ingredients),
    allergens: optional(values.food.allergens),
    nutrition: optional(values.food.nutrition),
    storageInstructions: optional(values.food.storageInstructions),
  };
  // Plain texts of `food` have no `null`: left out, they are cleared with
  // the rest of the object.
  if (values.food.origin.trim()) food.origin = values.food.origin.trim();
  if (values.food.manufacturer.trim()) {
    food.manufacturer = values.food.manufacturer.trim();
  }
  return {
    name: { en: values.name.en.trim(), de: values.name.de.trim() || null },
    slug: filled(values.slug),
    subtitle: optional(values.subtitle),
    shortDescription: optional(values.shortDescription),
    description: optional(values.description),
    highlights: {
      en: linesOf(values.highlights.en),
      de: linesOf(values.highlights.de),
    },
    uses: { en: linesOf(values.uses.en), de: linesOf(values.uses.de) },
    brand: values.brand.trim() || null,
    categoryId: values.categoryId,
    vatRate: parseVatRate(values.vatRate) ?? Number.NaN,
    status: values.status,
    isAvailable: values.isAvailable,
    isFeatured: values.isFeatured,
    sortOrder:
      values.sortOrder.trim() === "" ? null : integer(values.sortOrder),
    minOrderQuantity: integer(values.minOrderQuantity),
    maxOrderQuantity:
      values.maxOrderQuantity.trim() === ""
        ? null
        : integer(values.maxOrderQuantity),
    storageType: values.storageType,
    food,
    tags: values.tags.map((tag) => tag.trim()).filter(Boolean),
    searchKeywords: values.searchKeywords
      .map((keyword) => keyword.trim())
      .filter(Boolean),
    seo: {
      title: optional(values.seo.title),
      description: optional(values.seo.description),
    },
  };
}

/**
 * The sale of a request: a price OR a percentage, never both. `current` is
 * the sale price the pack size has now (`undefined` for a new one).
 * Sending neither keeps the sale; `salePrice: null` ends it.
 */
export function saleOf(
  values: SaleValues,
  current?: Cents | null,
): Pick<VariantPatch, "salePrice" | "discountPercent"> {
  if (values.saleMode === "percent") {
    return { discountPercent: integer(values.discountPercent) };
  }
  if (values.saleMode === "price") {
    const salePrice = parseEuros(values.salePrice) ?? Number.NaN;
    return current !== undefined && current === salePrice ? {} : { salePrice };
  }
  // No sale: nothing to say for a new pack size, an end for one that is on sale.
  return current === null || current === undefined ? {} : { salePrice: null };
}

/** A row as `POST /products` and `POST …/variants` take it: what is empty is left out. */
export function toVariantInput(row: VariantRowValues): VariantInput {
  const input: VariantInput = {
    packSize: {
      value: parsePackValue(row.packSize.value) ?? Number.NaN,
      unit: row.packSize.unit,
    },
    regularPrice: parseEuros(row.regularPrice) ?? Number.NaN,
    ...saleOf(row),
  };
  const sku = row.sku.trim().toUpperCase();
  if (sku) input.sku = sku;
  const gtin = row.gtin.trim();
  if (gtin) input.gtin = gtin;
  const carton = row.unitsPerCarton.trim();
  if (carton !== "") input.unitsPerCarton = integer(carton);
  if (!row.isEnabled) input.isEnabled = false;
  // The opening stock (default 0) and the threshold, where the API takes them.
  const stock = row.stockQuantity.trim();
  if (stock !== "" && integer(stock) > 0) input.stockQuantity = integer(stock);
  const threshold = row.lowStockThreshold.trim();
  if (threshold !== "") input.lowStockThreshold = integer(threshold);
  return input;
}

/** What `PATCH …/variants/{variantId}` gets: only what changed against the pack size. */
export function toVariantPatch(
  row: VariantRowValues,
  variant: ProductVariant,
): VariantPatch {
  const patch: VariantPatch = {};
  const sku = row.sku.trim().toUpperCase();
  if (sku && sku !== variant.sku) patch.sku = sku;
  const gtin = row.gtin.trim() || null;
  if (gtin !== variant.gtin) patch.gtin = gtin;
  const carton =
    row.unitsPerCarton.trim() === "" ? null : integer(row.unitsPerCarton);
  if (carton !== variant.unitsPerCarton) patch.unitsPerCarton = carton;
  const value = parsePackValue(row.packSize.value) ?? Number.NaN;
  if (
    value !== variant.packSize.value ||
    row.packSize.unit !== variant.packSize.unit
  ) {
    patch.packSize = { value, unit: row.packSize.unit };
  }
  const regularPrice = parseEuros(row.regularPrice) ?? Number.NaN;
  if (regularPrice !== variant.pricing.regularPrice) {
    patch.regularPrice = regularPrice;
  }
  if (row.isEnabled !== variant.isEnabled) patch.isEnabled = row.isEnabled;
  // `null` removes the threshold; the count itself is not part of a patch.
  const threshold =
    row.lowStockThreshold.trim() === "" ? null : integer(row.lowStockThreshold);
  if (threshold !== variant.stock.lowStockThreshold) {
    patch.lowStockThreshold = threshold;
  }
  return { ...patch, ...saleOf(row, variant.pricing.salePrice) };
}

/** What `POST /products` gets: the product with its pack sizes; what is empty is left out. */
export function toProductInput(values: ProductFormValues): ProductInput {
  const all = complete(values);
  const input: ProductInput = {
    name: all.name,
    categoryId: all.categoryId,
    variants: values.variants.filter((row) => !row.removed).map(toVariantInput),
    vatRate: all.vatRate,
    status: all.status,
    isAvailable: all.isAvailable,
    isFeatured: all.isFeatured,
    minOrderQuantity: all.minOrderQuantity,
  };
  // Without a position the API puts the product last in its category (7).
  if (all.sortOrder !== null) input.sortOrder = all.sortOrder;
  if (Object.keys(all.slug).length > 0) input.slug = all.slug;
  for (const key of ["subtitle", "shortDescription", "description"] as const) {
    if (!isEmpty(all[key])) input[key] = all[key];
  }
  for (const key of ["highlights", "uses"] as const) {
    if (all[key].en.length > 0 || all[key].de.length > 0) input[key] = all[key];
  }
  if (all.brand) input.brand = all.brand;
  if (all.maxOrderQuantity !== null)
    input.maxOrderQuantity = all.maxOrderQuantity;
  if (all.storageType) input.storageType = all.storageType;
  const food = presentFood(all.food);
  if (Object.keys(food).length > 0) input.food = food;
  if (all.tags.length > 0) input.tags = all.tags;
  if (all.searchKeywords.length > 0) input.searchKeywords = all.searchKeywords;
  const seo: NonNullable<ProductInput["seo"]> = {};
  if (!isEmpty(all.seo.title)) seo.title = all.seo.title;
  if (!isEmpty(all.seo.description)) seo.description = all.seo.description;
  if (Object.keys(seo).length > 0) input.seo = seo;
  return input;
}

function presentFood(food: ProductFoodInput): ProductFoodInput {
  const result: ProductFoodInput = {};
  for (const key of [
    "ingredients",
    "allergens",
    "nutrition",
    "storageInstructions",
  ] as const) {
    const value = food[key];
    if (value && !isEmpty(value)) result[key] = value;
  }
  if (food.origin) result.origin = food.origin;
  if (food.manufacturer) result.manufacturer = food.manufacturer;
  return result;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * What `PATCH /products/{id}` gets: only the product fields that changed
 * against the product the form was opened with. A translated field, a list
 * and `food` are sent whole, because the API replaces them as a whole; a
 * field that was emptied is sent as the value that clears it. The pack
 * sizes are not part of it: they have endpoints of their own.
 */
export function toProductPatch(
  values: ProductFormValues,
  product: ProductDetail,
): ProductPatch {
  const next = complete(values);
  const before = complete(productDefaults(product));
  const patch: ProductPatch = {};
  const changed = <K extends keyof Complete>(key: K) =>
    !same(next[key], before[key]);

  if (changed("name")) patch.name = next.name;
  if (changed("slug") && Object.keys(next.slug).length > 0)
    patch.slug = next.slug;
  if (changed("subtitle")) patch.subtitle = next.subtitle;
  if (changed("shortDescription"))
    patch.shortDescription = next.shortDescription;
  if (changed("description")) patch.description = next.description;
  if (changed("highlights")) patch.highlights = next.highlights;
  if (changed("uses")) patch.uses = next.uses;
  if (changed("brand")) patch.brand = next.brand;
  if (changed("categoryId")) patch.categoryId = next.categoryId;
  if (changed("vatRate")) patch.vatRate = next.vatRate;
  if (changed("status")) patch.status = next.status;
  if (changed("isAvailable")) patch.isAvailable = next.isAvailable;
  if (changed("isFeatured")) patch.isFeatured = next.isFeatured;
  if (changed("sortOrder") && next.sortOrder !== null)
    patch.sortOrder = next.sortOrder;
  if (changed("minOrderQuantity"))
    patch.minOrderQuantity = next.minOrderQuantity;
  if (changed("maxOrderQuantity"))
    patch.maxOrderQuantity = next.maxOrderQuantity;
  if (changed("storageType") && next.storageType)
    patch.storageType = next.storageType;
  if (changed("food")) patch.food = next.food;
  if (changed("tags")) patch.tags = next.tags;
  if (changed("searchKeywords")) patch.searchKeywords = next.searchKeywords;
  if (changed("seo")) patch.seo = next.seo;
  return patch;
}

/**
 * What saving an existing product sends (8): the product patch, then the
 * pack sizes to remove, to change (each with only what changed) and to add.
 */
export interface ProductPlan {
  patch: ProductPatch;
  remove: ProductVariant[];
  change: { variant: ProductVariant; patch: VariantPatch }[];
  /** `row` is the index of the row in the form. */
  add: { row: number; label: string; input: VariantInput }[];
}

export function planOf(
  values: ProductFormValues,
  product: ProductDetail,
): ProductPlan {
  const byId = new Map(product.variants.map((entry) => [entry.id, entry]));
  const plan: ProductPlan = {
    patch: toProductPatch(values, product),
    remove: [],
    change: [],
    add: [],
  };
  values.variants.forEach((row, index) => {
    const variant = byId.get(row.variantId);
    if (!variant) {
      if (row.variantId === "" && !row.removed) {
        plan.add.push({
          row: index,
          label: rowLabel(row),
          input: toVariantInput(row),
        });
      }
      return;
    }
    if (row.removed) {
      plan.remove.push(variant);
      return;
    }
    const patch = toVariantPatch(row, variant);
    if (Object.keys(patch).length > 0) plan.change.push({ variant, patch });
  });
  return plan;
}

export function planIsEmpty(plan: ProductPlan): boolean {
  return (
    Object.keys(plan.patch).length === 0 &&
    plan.remove.length === 0 &&
    plan.change.length === 0 &&
    plan.add.length === 0
  );
}

// --- Before saving: what the sale will look like -------------------------------

export interface SalePreview {
  /** What customers pay, in cents. */
  price: Cents;
  /** How much less than the regular price, in whole percent. */
  percent: number;
}

/**
 * The sale as typed, for showing it next to the fields. The API sets the
 * exact sale price of a percentage; this is the same arithmetic, rounded to
 * the cent, and is shown as an estimate.
 */
export function salePreview(values: SaleValues): SalePreview | null {
  const regular = parseEuros(values.regularPrice);
  if (regular === null || regular <= 0) return null;
  if (values.saleMode === "price") {
    const price = parseEuros(values.salePrice);
    if (price === null || price <= 0 || price >= regular) return null;
    return { price, percent: Math.round((1 - price / regular) * 100) };
  }
  if (values.saleMode === "percent") {
    const text = values.discountPercent.trim();
    if (!/^\d{1,2}$/.test(text)) return null;
    const percent = Number(text);
    if (percent < 1 || percent > 99) return null;
    return { price: Math.round((regular * (100 - percent)) / 100), percent };
  }
  return null;
}

// --- Errors of the API that belong to a field -----------------------------------

/** The fields of the product a documented refusal belongs to. */
export type ProductLevelField = "maxOrderQuantity" | "slug.en" | "categoryId";
/** The fields of a row of the pack-size table a documented refusal belongs to. */
export type VariantLevelField =
  "regularPrice" | "salePrice" | "discountPercent" | "sku" | "packSize.value";
export type ProductErrorField = ProductLevelField | VariantLevelField;

/**
 * The field a documented refusal of the API belongs to, or `null` when it
 * belongs to none of the form (shown above the buttons then). The fields of
 * a pack size are named as in a row; the caller knows which row.
 */
export function productErrorField(
  error: unknown,
  saleMode: SaleMode,
): ProductErrorField | null {
  if (hasErrorCode(error, "PRODUCT_PRICE_INVALID")) {
    if (saleMode === "percent") return "discountPercent";
    return saleMode === "price" ? "salePrice" : "regularPrice";
  }
  if (hasErrorCode(error, "PRODUCT_QUANTITY_INVALID"))
    return "maxOrderQuantity";
  if (hasErrorCode(error, "PRODUCT_SKU_TAKEN")) return "sku";
  if (hasErrorCode(error, "PRODUCT_VARIANT_INVALID")) return "packSize.value";
  if (hasErrorCode(error, "PRODUCT_SLUG_TAKEN")) return "slug.en";
  if (hasErrorCode(error, "CATEGORY_NOT_FOUND")) return "categoryId";
  return null;
}

/** Whether a refusal is about a pack size rather than the product. */
export function isVariantError(
  field: ProductErrorField | null,
): field is VariantLevelField {
  return (
    field === "regularPrice" ||
    field === "salePrice" ||
    field === "discountPercent" ||
    field === "sku" ||
    field === "packSize.value"
  );
}

/**
 * The row a refusal of `POST /products` is about, when it can be told:
 * the API names the article number or the pack of a refused pack size in
 * `details`; a price refusal names the prices.
 */
export function variantErrorRow(
  error: unknown,
  rows: readonly VariantRowValues[],
): number | null {
  const live = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.removed);
  if (live.length === 1) return live[0]!.index;
  if (hasErrorCode(error, "PRODUCT_VARIANT_INVALID")) {
    const d = error.details;
    if (d?.sku) {
      const hit = live.find(
        ({ row }) => row.sku.trim().toUpperCase() === d.sku,
      );
      if (hit) return hit.index;
    }
    if (typeof d?.baseQuantity === "number") {
      const hits = live.filter(({ row }) => {
        const value = parsePackValue(row.packSize.value);
        if (value === null) return false;
        const factor =
          row.packSize.unit === "kg" || row.packSize.unit === "l" ? 1000 : 1;
        return Math.round(value * factor * 1000) / 1000 === d.baseQuantity;
      });
      // The second of the same pack is the one to change.
      return hits.at(-1)?.index ?? null;
    }
  }
  if (hasErrorCode(error, "PRODUCT_PRICE_INVALID")) {
    const d = error.details;
    if (typeof d?.regularPrice === "number") {
      const hit = live.find(
        ({ row }) => parseEuros(row.regularPrice) === d.regularPrice,
      );
      if (hit) return hit.index;
    }
  }
  return null;
}

/**
 * The API names list entries by their place (`tags.3`, `highlights.en.0`);
 * the form shows a list as one field.
 */
export const PRODUCT_FIELD_ALIASES: Record<string, string> = (() => {
  const aliases: Record<string, string> = {};
  const lists: [string, number][] = [
    ["tags", LIMITS.tags],
    ["searchKeywords", LIMITS.keywords],
    ["highlights.en", LIMITS.listEntries],
    ["highlights.de", LIMITS.listEntries],
    ["uses.en", LIMITS.listEntries],
    ["uses.de", LIMITS.listEntries],
  ];
  for (const [field, length] of lists) {
    for (let index = 0; index <= length; index += 1) {
      aliases[`${field}.${index}`] = field;
    }
  }
  return aliases;
})();

/** The fields of a pack size as the API names them, mapped to one row of the form. */
export function variantFieldAliases(row: number): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const field of [
    "sku",
    "gtin",
    "unitsPerCarton",
    "packSize.value",
    "packSize.unit",
    "regularPrice",
    "salePrice",
    "discountPercent",
    "isEnabled",
    "stockQuantity",
    "lowStockThreshold",
  ]) {
    aliases[field] = `variants.${row}.${field}`;
    // On `POST /products` the API names them inside `variants[]`.
    aliases[`variants.${row}.${field}`] = `variants.${row}.${field}`;
  }
  return aliases;
}
