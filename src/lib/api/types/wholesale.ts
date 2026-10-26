// Section 25: the wholesale catalogue (B2B). doc/WHOLESALE_CATALOG.md has
// the data model, every endpoint, the validation rules and the CSV columns.

import type {
  AdminImage,
  ImagePatch,
  ImageSizes,
  PackUnit,
  ProductStatus,
  StorageType,
} from "./catalog";
import type {
  AdminRef,
  Id,
  IsoDateTime,
  PageQuery,
  Translated,
  TranslatedList,
  TranslatedOptional,
  VatRate,
} from "./common";

export const WHOLESALE_PRODUCT_SORTS = [
  "newest",
  "updated",
  "name",
  "sku",
] as const;
export type WholesaleProductSort = (typeof WHOLESALE_PRODUCT_SORTS)[number];

export const WHOLESALE_RULES = {
  /** `limit` default of the product list. */
  pageLimit: 24,
  skusMax: 20,
  unitsPerCartonMin: 1,
  unitsPerCartonMax: 1000,
  /** Cartons on hand, a count or a change: integers in this range. */
  stockMin: -1_000_000,
  stockMax: 1_000_000,
  stockNoteMax: 500,
  imagesMax: 12,
} as const;

// --- Categories (section 3) -------------------------------------------------

/** A flat, ordered list: no parents, one picture each. */
export interface WholesaleCategory {
  id: Id;
  name: Translated;
  /** Both languages filled in; the German one generated when not given. */
  slug: Translated;
  description: TranslatedOptional | null;
  sortOrder: number;
  /** Hidden: neither the category nor its products are on the wholesale site. */
  isVisible: boolean;
  image: AdminImage | null;
  /** Products of every status in the category. */
  productCount: number;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface WholesaleCategoryInput {
  name: Translated;
  slug?: TranslatedOptional;
  description?: TranslatedOptional;
  sortOrder?: number;
  isVisible?: boolean;
}

export type WholesaleCategoryPatch = Partial<WholesaleCategoryInput>;

// --- Products and SKUs (section 4) ------------------------------------------

/** A pack size of a wholesale product: "1 kg". */
export interface WholesalePackSize {
  value: number;
  unit: PackUnit;
  label: string;
}

/** The carton of a SKU: "20 × 1 kg" holding "20 kg". The API works it out. */
export interface Carton {
  units: number;
  label: string;
  content: { value: number; unit: PackUnit; label: string };
}

/** A SKU: a pack size with its carton, its enabled switch and its stock in cartons. */
export interface WholesaleSku {
  id: Id;
  /** The article number, `RFW-00001` when generated. */
  sku: string;
  packSize: WholesalePackSize;
  unitsPerCarton: number;
  carton: Carton;
  isEnabled: boolean;
  /** Cartons on hand; below zero is a shortage. */
  stock: number;
  createdAt: IsoDateTime;
}

/** The stock of a product over its SKUs: the sum, and how many are below zero. */
export interface WholesaleStockOverview {
  quantity: number;
  shortSkus: number;
}

/** The picture of a product summary: a plain `alt` string, as in the shop. */
export interface WholesaleSummaryImage {
  id: Id;
  alt: string;
  isPrimary: boolean;
  url: string;
  sizes: ImageSizes;
}

export interface WholesaleProductSummary {
  id: Id;
  name: Translated;
  slug: Translated;
  brand: string | null;
  category: { id: Id; name: Translated };
  status: ProductStatus;
  /** `false`: shown as "currently not available", cannot be asked for. */
  isAvailable: boolean;
  /** The position within the category, 0 first. */
  sortOrder: number;
  /** Hundredths of a percent; copied into every quotation line. */
  vatRate: VatRate;
  /** Smallest pack first, then the smaller carton. */
  skus: WholesaleSku[];
  skuCount: number;
  stock: WholesaleStockOverview;
  imageCount: number;
  image: WholesaleSummaryImage | null;
  /** The retail product a copy came from; for reference only. */
  retailProductId: Id | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface WholesaleFood {
  ingredients: TranslatedOptional | null;
  allergens: TranslatedOptional | null;
  nutrition: TranslatedOptional | null;
  storageInstructions: TranslatedOptional | null;
  origin: string | null;
  manufacturer: string | null;
}

export interface WholesaleProductDetail extends WholesaleProductSummary {
  subtitle: TranslatedOptional | null;
  shortDescription: TranslatedOptional | null;
  description: TranslatedOptional | null;
  highlights: { en: string[]; de: string[] };
  categoryId: Id;
  storageType: StorageType;
  food: WholesaleFood | null;
  searchKeywords: string[];
  /** In display order; `isPrimary` on the main one. */
  images: AdminImage[];
  /** The first time the product was active. */
  publishedAt: IsoDateTime | null;
}

export interface WholesaleFoodInput {
  ingredients?: TranslatedOptional;
  allergens?: TranslatedOptional;
  nutrition?: TranslatedOptional;
  storageInstructions?: TranslatedOptional;
  origin?: string;
  manufacturer?: string;
}

/** A SKU as `POST …/products` and `POST …/{id}/skus` take it. */
export interface WholesaleSkuInput {
  /** Generated (`RFW-00001`, …) when left out. */
  sku?: string;
  packSize: { value: number; unit: PackUnit };
  /** 1 to 1000. */
  unitsPerCarton: number;
  /** Default `true`. */
  isEnabled?: boolean;
  /** The opening count in cartons (default 0). Only when the SKU is created. */
  stock?: number;
}

/** `PATCH …/skus/{skuId}`: the stock changes only through the stock endpoint. */
export type WholesaleSkuPatch = Partial<Omit<WholesaleSkuInput, "stock">>;

/** `POST …/products`: the product with its SKUs. */
export interface WholesaleProductInput {
  name: Translated;
  slug?: TranslatedOptional;
  subtitle?: TranslatedOptional;
  shortDescription?: TranslatedOptional;
  description?: TranslatedOptional;
  highlights?: TranslatedList;
  brand?: string | null;
  categoryId: Id;
  /** 1 to 20, one unit family, no pack and carton twice. */
  skus: WholesaleSkuInput[];
  vatRate: VatRate;
  status?: ProductStatus;
  isAvailable?: boolean;
  sortOrder?: number;
  storageType?: StorageType;
  food?: WholesaleFoodInput;
  searchKeywords?: string[];
}

/** `PATCH …/products/{id}`: any field but `skus`; translated fields and `food` replaced whole. */
export type WholesaleProductPatch = Partial<
  Omit<WholesaleProductInput, "skus">
>;

export interface WholesaleProductQuery extends PageQuery {
  status?: ProductStatus;
  categoryId?: Id;
  /** Words of the name, subtitle, brand or keywords, or the start of an article number. */
  q?: string;
  isAvailable?: boolean;
  /** Default `newest`. */
  sort?: WholesaleProductSort;
}

export type WholesaleImagePatch = ImagePatch;

// --- Copy from retail (section 6) -------------------------------------------

export interface WholesaleFromRetailInput {
  /** The retail product. */
  productId: Id;
  categoryId: Id;
  /** Without it, every retail pack size becomes a SKU with one pack per carton. */
  skus?: {
    packSize: { value: number; unit: PackUnit };
    unitsPerCarton: number;
  }[];
  /** Default `draft`. */
  status?: ProductStatus;
  /** Default `true`: the pictures are copied as files of their own. */
  copyImages?: boolean;
}

// --- Stock (section 8) ------------------------------------------------------

export const WHOLESALE_STOCK_REASONS = [
  "adjustment",
  "import",
  "quotation_accepted",
] as const;
export type WholesaleStockReason = (typeof WHOLESALE_STOCK_REASONS)[number];

/** One line of the ledger of a SKU. */
export interface WholesaleStockMovement {
  id: Id;
  productId: Id;
  skuId: Id;
  /** The article number at the time. */
  sku: string;
  reason: WholesaleStockReason;
  /** Cartons in (positive) or out (negative). */
  delta: number;
  quantityBefore: number;
  /** May be below zero. */
  quantityAfter: number;
  quotationId: Id | null;
  quotationNumber: string | null;
  adminId: Id | null;
  admin?: AdminRef | null;
  note: string | null;
  createdAt: IsoDateTime;
}

/** `PUT …/skus/{skuId}/stock`: the exact count, or cartons to add or remove. */
export type WholesaleStockChangeInput =
  { quantity: number; note?: string } | { delta: number; note?: string };

/** `movement` is `null` when the count did not change. */
export interface WholesaleStockChangeResult {
  product: WholesaleProductDetail;
  sku: WholesaleSku;
  movement: WholesaleStockMovement | null;
}

export interface WholesaleStockMovementQuery extends PageQuery {
  skuId?: Id;
}
