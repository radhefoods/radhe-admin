import { z } from "zod";
import {
  FAMILY_LABEL,
  UNIT_FAMILY,
  baseQuantity,
  packLabelOf,
} from "@/features/catalogue/variants";
import { hasErrorCode } from "@/lib/api/errors";
import {
  WHOLESALE_RULES,
  type PackUnit,
  type ProductStatus,
  type StorageType,
  type Translated,
  type TranslatedOptional,
  type WholesaleFoodInput,
  type WholesaleProductDetail,
  type WholesaleProductInput,
  type WholesaleProductPatch,
  type WholesaleSku,
  type WholesaleSkuInput,
  type WholesaleSkuPatch,
} from "@/lib/api/types";
import { parseVatRate, rateToInput } from "@/lib/format/money";
import {
  translatedDefaults,
  zInt,
  zOptionalInt,
  zVatRate,
} from "@/lib/validation";

// The rules of the API for a wholesale product and its SKUs (25, sections
// 4 and 10), mirrored one to one. The form holds what the admin typed;
// the functions at the end make of it what the API gets: `POST …/products`
// with `skus[]` for a new product, and for an existing one a plan of the
// product patch and the SKUs to add, change and remove.

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

export const LIMITS = {
  name: 160,
  short: 300,
  long: 20000,
  brand: 80,
  slug: 120,
  listEntries: 20,
  listEntry: 200,
  origin: 120,
  manufacturer: 500,
  keywords: 30,
  keywordMin: 2,
  keywordMax: 60,
  packMin: 0.001,
  packMax: 1_000_000,
  sortOrderMax: 1_000_000,
  skus: WHOLESALE_RULES.skusMax,
  cartonMin: WHOLESALE_RULES.unitsPerCartonMin,
  cartonMax: WHOLESALE_RULES.unitsPerCartonMax,
  stockMin: WHOLESALE_RULES.stockMin,
  stockMax: WHOLESALE_RULES.stockMax,
} as const;

const SKU = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// --- Reading what was typed ----------------------------------------------------

/** The entries of a list typed one per line; empty lines do not count. */
export function linesOf(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** A pack size as typed: `5`, `0.5`, `0,5`, `1.250`. At most three decimals. */
export function parsePackValue(text: string): number | null {
  const match = /^(\d{1,7})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(`${match[1]}.${match[2] ?? "0"}`);
}

// --- The schema ------------------------------------------------------------------

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

/** One row of the SKU table: a pack size with its carton (section 4). */
const skuRowFields = z.object({
  /** The id of the SKU; empty for one that is not saved yet. */
  skuId: z.string(),
  sku: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || SKU.test(value.toUpperCase()),
      "2 to 40 characters: letters, digits, dot, underscore or hyphen, starting with a letter or a digit.",
    ),
  packSize: packSizeFields,
  /** Packs in a carton, 1 to 1000. */
  unitsPerCarton: following(
    zInt({ min: LIMITS.cartonMin, max: LIMITS.cartonMax }),
  ),
  isEnabled: z.boolean(),
  /** The opening count of a new SKU; a saved one changes it in the stock dialog. */
  stock: following(
    zOptionalInt({ min: LIMITS.stockMin, max: LIMITS.stockMax }),
  ),
  /** Marked for removal: deleted when the product is saved. */
  removed: z.boolean(),
});

export type SkuRowValues = z.input<typeof skuRowFields>;

const productFields = z.object({
  name: z.object({
    en: text(LIMITS.name).min(1, "The English name is required."),
    de: text(LIMITS.name),
  }),
  slug: z.object({ en: slug, de: slug }),
  subtitle: translated(LIMITS.short),
  shortDescription: translated(LIMITS.short),
  description: translated(LIMITS.long),
  highlights: z.object({ en: lines, de: lines }),
  brand: text(LIMITS.brand),
  categoryId: z.string().regex(/^[0-9a-f]{24}$/, "Choose a category."),
  skus: z.array(skuRowFields),
  vatRate: following(zVatRate),
  status: z.enum(PRODUCT_STATUSES),
  isAvailable: z.boolean(),
  /** The position in its category, 0 first; empty on a new product: the last position. */
  sortOrder: following(zOptionalInt({ min: 0, max: LIMITS.sortOrderMax })),
  storageType: z.enum(STORAGE_TYPES),
  food: z.object({
    ingredients: translated(LIMITS.long),
    allergens: translated(LIMITS.long),
    nutrition: translated(LIMITS.long),
    storageInstructions: translated(LIMITS.long),
    origin: text(LIMITS.origin),
    manufacturer: text(LIMITS.manufacturer),
  }),
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
});

export type ProductFormValues = z.input<typeof productFields>;

export interface RowProblem {
  /** The row, or `-1` for the table as a whole. */
  index: number;
  field: "packSize.value" | "packSize.unit" | "sku" | "unitsPerCarton" | "root";
  message: string;
}

/**
 * The problems the API would refuse the SKUs for (section 10): one unit
 * family, no pack size with the same carton twice, no article number
 * twice, 1 to 20 of them. Rows marked for removal do not count.
 */
export function rowProblems(rows: readonly SkuRowValues[]): RowProblem[] {
  const problems: RowProblem[] = [];
  const live = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.removed);
  if (live.length === 0) {
    return [
      {
        index: -1,
        field: "root",
        message: "A product needs at least one SKU.",
      },
    ];
  }
  if (live.length > LIMITS.skus) {
    problems.push({
      index: -1,
      field: "root",
      message: `A product has at most ${LIMITS.skus} SKUs.`,
    });
  }
  const family = UNIT_FAMILY[live[0]!.row.packSize.unit];
  const seenCartons = new Map<string, number>();
  const seenSkus = new Map<string, number>();
  for (const { row, index } of live) {
    if (UNIT_FAMILY[row.packSize.unit] !== family) {
      problems.push({
        index,
        field: "packSize.unit",
        message: `All SKUs of a product are of one unit family. The first one is ${FAMILY_LABEL[family]}.`,
      });
    }
    const value = parsePackValue(row.packSize.value);
    const units = row.unitsPerCarton.trim();
    if (
      value !== null &&
      /^\d+$/.test(units) &&
      UNIT_FAMILY[row.packSize.unit] === family
    ) {
      const key = `${baseQuantity(value, row.packSize.unit)}×${Number(units)}`;
      const earlier = seenCartons.get(key);
      if (earlier !== undefined) {
        problems.push({
          index,
          field: "unitsPerCarton",
          message: `The same pack size with the same carton as row ${earlier + 1}. The same pack in another carton is fine.`,
        });
      } else seenCartons.set(key, index);
    }
    const sku = row.sku.trim().toUpperCase();
    if (sku !== "") {
      const earlier = seenSkus.get(sku);
      if (earlier !== undefined) {
        problems.push({
          index,
          field: "sku",
          message: `The same article number as row ${earlier + 1}.`,
        });
      } else seenSkus.set(sku, index);
    }
  }
  return problems;
}

/**
 * The schema of the product form. A new product may leave the article
 * numbers and the address empty (the API generates them); an existing one
 * keeps its address, and a saved SKU keeps its article number.
 */
export function productSchema(options: { creating: boolean }) {
  return productFields.superRefine((value, context) => {
    if (!options.creating && value.slug.en.trim() === "") {
      context.addIssue({
        code: "custom",
        path: ["slug", "en"],
        message: "A product keeps its address. Type one.",
      });
    }
    value.skus.forEach((row, index) => {
      if (row.removed) return;
      if (row.skuId !== "" && row.sku.trim() === "") {
        context.addIssue({
          code: "custom",
          path: ["skus", index, "sku"],
          message: "A SKU keeps its article number. Type one.",
        });
      }
    });
    for (const problem of rowProblems(value.skus)) {
      context.addIssue({
        code: "custom",
        path:
          problem.index < 0
            ? ["skus"]
            : ["skus", problem.index, ...problem.field.split(".")],
        message: problem.message,
      });
    }
  });
}

// --- What the form starts with ----------------------------------------------------

/** A row of the table for a SKU the product has. */
export function skuRow(sku: WholesaleSku): SkuRowValues {
  return {
    skuId: sku.id,
    sku: sku.sku,
    packSize: { value: String(sku.packSize.value), unit: sku.packSize.unit },
    unitsPerCarton: String(sku.unitsPerCarton),
    isEnabled: sku.isEnabled,
    stock: "",
    removed: false,
  };
}

/** An empty row for a SKU that is typed now; the unit follows the others. */
export function emptySkuRow(unit: PackUnit = "kg"): SkuRowValues {
  return {
    skuId: "",
    sku: "",
    packSize: { value: "", unit },
    unitsPerCarton: "",
    isEnabled: true,
    stock: "0",
    removed: false,
  };
}

function listDefaults(
  list: { en?: string[]; de?: string[] } | null | undefined,
): { en: string; de: string } {
  return { en: (list?.en ?? []).join("\n"), de: (list?.de ?? []).join("\n") };
}

export function productDefaults(
  product?: WholesaleProductDetail,
): ProductFormValues {
  return {
    name: translatedDefaults(product?.name),
    slug: translatedDefaults(product?.slug),
    subtitle: translatedDefaults(product?.subtitle),
    shortDescription: translatedDefaults(product?.shortDescription),
    description: translatedDefaults(product?.description),
    highlights: listDefaults(product?.highlights),
    brand: product?.brand ?? "",
    categoryId: product?.categoryId ?? "",
    skus: product ? product.skus.map(skuRow) : [emptySkuRow()],
    vatRate: rateToInput(product?.vatRate),
    status: product?.status ?? "draft",
    isAvailable: product?.isAvailable ?? true,
    sortOrder: product ? String(product.sortOrder) : "",
    storageType: product?.storageType ?? "ambient",
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
    searchKeywords: [...(product?.searchKeywords ?? [])],
  };
}

/** The words for a row: "5 kg × 4", or "a new SKU". */
export function rowLabel(
  row: Pick<SkuRowValues, "packSize" | "unitsPerCarton">,
): string {
  const pack = packLabelOf(row.packSize.value, row.packSize.unit);
  if (!pack) return "a new SKU";
  const units = row.unitsPerCarton.trim();
  return units ? `${units} × ${pack}` : pack;
}

// --- What the API gets ---------------------------------------------------------------

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
 * translated field, a list and `food` replace what was there.
 */
interface Complete {
  name: Translated;
  slug: TranslatedOptional;
  subtitle: TranslatedOptional;
  shortDescription: TranslatedOptional;
  description: TranslatedOptional;
  highlights: { en: string[]; de: string[] };
  brand: string | null;
  categoryId: string;
  vatRate: number;
  status: ProductStatus;
  isAvailable: boolean;
  sortOrder: number | null;
  storageType: StorageType;
  food: WholesaleFoodInput;
  searchKeywords: string[];
}

function integer(text: string): number {
  return Number.parseInt(text.trim(), 10);
}

function complete(values: ProductFormValues): Complete {
  const food: WholesaleFoodInput = {
    ingredients: optional(values.food.ingredients),
    allergens: optional(values.food.allergens),
    nutrition: optional(values.food.nutrition),
    storageInstructions: optional(values.food.storageInstructions),
  };
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
    brand: values.brand.trim() || null,
    categoryId: values.categoryId,
    vatRate: parseVatRate(values.vatRate) ?? Number.NaN,
    status: values.status,
    isAvailable: values.isAvailable,
    sortOrder:
      values.sortOrder.trim() === "" ? null : integer(values.sortOrder),
    storageType: values.storageType,
    food,
    searchKeywords: values.searchKeywords
      .map((keyword) => keyword.trim())
      .filter(Boolean),
  };
}

/** A row as `POST …/products` and `POST …/skus` take it: what is empty is left out. */
export function toSkuInput(row: SkuRowValues): WholesaleSkuInput {
  const input: WholesaleSkuInput = {
    packSize: {
      value: parsePackValue(row.packSize.value) ?? Number.NaN,
      unit: row.packSize.unit,
    },
    unitsPerCarton: integer(row.unitsPerCarton),
  };
  const sku = row.sku.trim().toUpperCase();
  if (sku) input.sku = sku;
  if (!row.isEnabled) input.isEnabled = false;
  // The opening count, when it is not the default of 0.
  const stock = row.stock.trim();
  if (stock !== "" && integer(stock) !== 0) input.stock = integer(stock);
  return input;
}

/** What `PATCH …/skus/{skuId}` gets: only what changed; never the stock. */
export function toSkuPatch(
  row: SkuRowValues,
  sku: WholesaleSku,
): WholesaleSkuPatch {
  const patch: WholesaleSkuPatch = {};
  const code = row.sku.trim().toUpperCase();
  if (code && code !== sku.sku) patch.sku = code;
  const value = parsePackValue(row.packSize.value) ?? Number.NaN;
  if (value !== sku.packSize.value || row.packSize.unit !== sku.packSize.unit) {
    patch.packSize = { value, unit: row.packSize.unit };
  }
  const units = integer(row.unitsPerCarton);
  if (units !== sku.unitsPerCarton) patch.unitsPerCarton = units;
  if (row.isEnabled !== sku.isEnabled) patch.isEnabled = row.isEnabled;
  return patch;
}

function presentFood(food: WholesaleFoodInput): WholesaleFoodInput {
  const result: WholesaleFoodInput = {};
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

/** What `POST …/products` gets: the product with its SKUs; what is empty is left out. */
export function toProductInput(
  values: ProductFormValues,
): WholesaleProductInput {
  const all = complete(values);
  const input: WholesaleProductInput = {
    name: all.name,
    categoryId: all.categoryId,
    skus: values.skus.filter((row) => !row.removed).map(toSkuInput),
    vatRate: all.vatRate,
    status: all.status,
    isAvailable: all.isAvailable,
    storageType: all.storageType,
  };
  if (all.sortOrder !== null) input.sortOrder = all.sortOrder;
  if (Object.keys(all.slug).length > 0) input.slug = all.slug;
  for (const key of ["subtitle", "shortDescription", "description"] as const) {
    if (!isEmpty(all[key])) input[key] = all[key];
  }
  if (all.highlights.en.length > 0 || all.highlights.de.length > 0) {
    input.highlights = all.highlights;
  }
  if (all.brand) input.brand = all.brand;
  const food = presentFood(all.food);
  if (Object.keys(food).length > 0) input.food = food;
  if (all.searchKeywords.length > 0) input.searchKeywords = all.searchKeywords;
  return input;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/**
 * What `PATCH …/products/{id}` gets: only the product fields that changed
 * against the product the form was opened with. The SKUs are not part of
 * it: they have endpoints of their own.
 */
export function toProductPatch(
  values: ProductFormValues,
  product: WholesaleProductDetail,
): WholesaleProductPatch {
  const next = complete(values);
  const before = complete(productDefaults(product));
  const patch: WholesaleProductPatch = {};
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
  if (changed("brand")) patch.brand = next.brand;
  if (changed("categoryId")) patch.categoryId = next.categoryId;
  if (changed("vatRate")) patch.vatRate = next.vatRate;
  if (changed("status")) patch.status = next.status;
  if (changed("isAvailable")) patch.isAvailable = next.isAvailable;
  if (changed("sortOrder") && next.sortOrder !== null)
    patch.sortOrder = next.sortOrder;
  if (changed("storageType")) patch.storageType = next.storageType;
  if (changed("food")) patch.food = next.food;
  if (changed("searchKeywords")) patch.searchKeywords = next.searchKeywords;
  return patch;
}

/** What saving an existing product sends: the patch, then the SKUs to remove, change and add. */
export interface ProductPlan {
  patch: WholesaleProductPatch;
  remove: WholesaleSku[];
  change: { sku: WholesaleSku; patch: WholesaleSkuPatch }[];
  /** `row` is the index of the row in the form. */
  add: { row: number; label: string; input: WholesaleSkuInput }[];
}

export function planOf(
  values: ProductFormValues,
  product: WholesaleProductDetail,
): ProductPlan {
  const byId = new Map(product.skus.map((entry) => [entry.id, entry]));
  const plan: ProductPlan = {
    patch: toProductPatch(values, product),
    remove: [],
    change: [],
    add: [],
  };
  values.skus.forEach((row, index) => {
    const sku = byId.get(row.skuId);
    if (!sku) {
      if (row.skuId === "" && !row.removed) {
        plan.add.push({
          row: index,
          label: rowLabel(row),
          input: toSkuInput(row),
        });
      }
      return;
    }
    if (row.removed) {
      plan.remove.push(sku);
      return;
    }
    const patch = toSkuPatch(row, sku);
    if (Object.keys(patch).length > 0) plan.change.push({ sku, patch });
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

// --- Errors of the API that belong to a field -------------------------------------

export type ProductErrorField = "slug.en" | "categoryId" | "sku" | "skus";

/**
 * The field a documented refusal belongs to, or `null` when it belongs to
 * none of the form. `sku` is a field of a row (the caller knows which);
 * `skus` is the table as a whole (the SKUs do not fit together).
 */
export function productErrorField(error: unknown): ProductErrorField | null {
  if (hasErrorCode(error, "WHOLESALE_SKU_TAKEN")) return "sku";
  if (hasErrorCode(error, "WHOLESALE_SKU_INVALID")) return "skus";
  if (hasErrorCode(error, "WHOLESALE_PRODUCT_SLUG_TAKEN")) return "slug.en";
  if (hasErrorCode(error, "WHOLESALE_CATEGORY_NOT_FOUND")) return "categoryId";
  return null;
}

/**
 * The row a refusal of `POST …/products` is about, when it can be told:
 * the API names the article number or the pack of a refused SKU in
 * `details`; with one live row, that one.
 */
export function skuErrorRow(
  error: unknown,
  rows: readonly SkuRowValues[],
): number | null {
  const live = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => !row.removed);
  if (live.length === 1) return live[0]!.index;
  if (hasErrorCode(error, "WHOLESALE_SKU_INVALID")) {
    const d = error.details;
    if (d?.sku) {
      const hits = live.filter(
        ({ row }) => row.sku.trim().toUpperCase() === d.sku,
      );
      return hits.at(-1)?.index ?? null;
    }
    if (typeof d?.baseQuantity === "number") {
      const hits = live.filter(({ row }) => {
        const value = parsePackValue(row.packSize.value);
        return (
          value !== null &&
          baseQuantity(value, row.packSize.unit) === d.baseQuantity
        );
      });
      return hits.at(-1)?.index ?? null;
    }
  }
  return null;
}

/** The API names list entries by their place (`searchKeywords.3`); the form shows a list as one field. */
export const PRODUCT_FIELD_ALIASES: Record<string, string> = (() => {
  const aliases: Record<string, string> = {};
  const lists: [string, number][] = [
    ["searchKeywords", LIMITS.keywords],
    ["highlights.en", LIMITS.listEntries],
    ["highlights.de", LIMITS.listEntries],
  ];
  for (const [field, length] of lists) {
    for (let index = 0; index <= length; index += 1) {
      aliases[`${field}.${index}`] = field;
    }
  }
  return aliases;
})();

/** The fields of a SKU as the API names them, mapped to one row of the form. */
export function skuFieldAliases(row: number): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const field of [
    "sku",
    "packSize.value",
    "packSize.unit",
    "unitsPerCarton",
    "isEnabled",
    "stock",
  ]) {
    aliases[field] = `skus.${row}.${field}`;
    aliases[`skus.${row}.${field}`] = `skus.${row}.${field}`;
  }
  return aliases;
}
