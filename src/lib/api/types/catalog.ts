// Sections 7 (categories) and 8 (products, stock and images).

import type {
  AdminRef,
  Cents,
  CursorQuery,
  Id,
  IsoDateTime,
  PageQuery,
  SortParam,
  Translated,
  TranslatedList,
  TranslatedOptional,
  VatRate,
} from "./common";

// --- Images (8.1) -----------------------------------------------------------

export interface ImageSize {
  url: string;
  width: number;
  height: number;
}

export interface ImageSizes {
  small: ImageSize;
  medium: ImageSize;
  large: ImageSize;
}

/** WebP in three sizes under immutable URLs. The original is not kept. */
export interface AdminImage {
  id: Id;
  alt: TranslatedOptional;
  isPrimary: boolean;
  url: string;
  sizes: ImageSizes;
  bytes: number;
  uploadedAt: IsoDateTime;
}

/** The store-style image of a product summary: a plain `alt` string. */
export interface SummaryImage {
  id: Id;
  alt: string;
  isPrimary: boolean;
  url: string;
  sizes: ImageSizes;
}

export const IMAGE_RULES = {
  acceptedTypes: ["image/jpeg", "image/png", "image/webp"],
  acceptedFormats: ["jpeg", "png", "webp"],
  maxBytes: 10 * 1024 * 1024,
  minSidePx: 200,
  maxFilesPerRequest: 10,
  maxImagesPerProduct: 12,
} as const;

// --- Categories (7) ---------------------------------------------------------

export interface CategorySeo {
  title: TranslatedOptional | null;
  description: TranslatedOptional | null;
}

/**
 * How the shop lists the products of a category on its page (7.1,
 * doc/PRODUCT_DISPLAY_ORDER.md): one card per product with a size chooser,
 * one card per pack size with the sizes of a product together, or one card
 * per pack size in rounds (the smallest size of every product first).
 */
export type ListingView =
  "product" | "variants_by_product" | "variants_by_size";
export const LISTING_VIEWS: readonly ListingView[] = [
  "product",
  "variants_by_product",
  "variants_by_size",
];
export const DEFAULT_LISTING_VIEW: ListingView = "variants_by_size";

/** 7.1. A tree of at most three levels, returned as a flat list in order. */
export interface Category {
  id: Id;
  name: Translated;
  slug: Translated;
  tagline: TranslatedOptional | null;
  description: TranslatedOptional | null;
  parentId: Id | null;
  ancestorIds: Id[];
  level: 1 | 2 | 3;
  sortOrder: number;
  isVisible: boolean;
  listingView: ListingView;
  image: AdminImage | null;
  /** Every product (all statuses; a product with several pack sizes counts once) in the category and below. */
  productCount: number;
  seo: CategorySeo | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CategoryInput {
  name: Translated;
  slug?: TranslatedOptional;
  tagline?: TranslatedOptional;
  description?: TranslatedOptional;
  parentId?: Id | null;
  sortOrder?: number;
  isVisible?: boolean;
  listingView?: ListingView;
  seo?: { title?: TranslatedOptional; description?: TranslatedOptional };
}

export interface CategoryOrderInput {
  parentId: Id | null;
  orderedIds: Id[];
}

/**
 * `PUT /categories/{id}/products/order` (7): the products named come
 * first, in this order; every other product of the category follows in
 * the order it had.
 */
export interface CategoryProductOrderInput {
  orderedIds: Id[];
}

// --- Products (8) -----------------------------------------------------------

export type ProductStatus = "draft" | "active" | "archived";
export type PackUnit = "g" | "kg" | "ml" | "l" | "pcs";
export type StorageType = "ambient" | "chilled" | "frozen";
export type ProductSort =
  "newest" | "updated" | "name" | "sku" | "price_asc" | "price_desc";

export interface PackSize {
  value: number;
  unit: PackUnit;
  /** English, e.g. "5 kg". */
  label: string;
}

export interface PriceView {
  currency: "EUR";
  price: Cents;
  regularPrice: Cents;
  salePrice: Cents | null;
  onSale: boolean;
  discountPercent: number | null;
  discountAmount: Cents | null;
  vatIncluded: boolean;
  vatRate: VatRate;
  vatPercent: number;
  vatAmount: Cents;
  basePrice: { amount: Cents; per: "kg" | "l" | "pcs" } | null;
}

/**
 * The stock of one pack size (8). `isLow` is true when a threshold is set
 * and the quantity is at or below it; a pack size without a threshold is
 * never low. Quantity 0 is sold out in the shop.
 */
export interface ProductStock {
  quantity: number;
  lowStockThreshold: number | null;
  isLow: boolean;
}

/**
 * The stock of a product over its pack sizes (8.1): the sum, the number of
 * pack sizes at or below their threshold, and whether there is at least one.
 */
export interface ProductStockOverview {
  quantity: number;
  lowVariants: number;
  isLow: boolean;
}

/**
 * A pack size of a product (8.1): its own article number, barcode, pack,
 * URL, prices, enabled switch and stock. `isDefault` marks the one that
 * stands for the product in lists; the API computes it.
 */
/**
 * A carton of a pack size, for wholesale quotations (24, `doc/QUOTATIONS.md`):
 * "20 × 1 kg" holding "20 kg". The API works it out from `unitsPerCarton`.
 */
export interface Carton {
  units: number;
  label: string;
  content: { value: number; unit: PackUnit; label: string };
}

export interface ProductVariant {
  id: Id;
  sku: string;
  gtin: string | null;
  /** Packs in a carton, 1 to 1000; `null`: not offered on the wholesale site. */
  unitsPerCarton: number | null;
  carton: Carton | null;
  packSize: PackSize;
  /** The URL of this pack size in each language: the base slug plus the pack. */
  slug: Translated;
  /** What customers see for it: "Basmati Rice (1 kg)". */
  displayName: Translated;
  pricing: PriceView;
  /** `false`: not listed, not orderable, its URL answers 404. */
  isEnabled: boolean;
  isDefault: boolean;
  stock: ProductStock;
  createdAt: IsoDateTime;
}

export interface ProductSummary {
  id: Id;
  name: Translated;
  /** The base of the URLs; each pack size adds its pack to it. */
  slug: Translated;
  brand: string | null;
  category: { id: Id; name: Translated };
  status: ProductStatus;
  isAvailable: boolean;
  isFeatured: boolean;
  /** The position among the products of its category, 0 first. */
  sortOrder: number;
  /** The same for every pack size. */
  vatRate: VatRate;
  /** The selling price of the default pack size. */
  priceFrom: Cents;
  defaultVariant: ProductVariant;
  /** Every pack size, smallest first, disabled ones included. */
  variants: ProductVariant[];
  variantCount: number;
  stock: ProductStockOverview;
  imageCount: number;
  image: SummaryImage | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface ProductFood {
  ingredients: TranslatedOptional | null;
  allergens: TranslatedOptional | null;
  nutrition: TranslatedOptional | null;
  storageInstructions: TranslatedOptional | null;
  origin: string | null;
  manufacturer: string | null;
}

export interface ProductSeo {
  title?: TranslatedOptional | null;
  description?: TranslatedOptional | null;
}

export interface ProductDetail extends ProductSummary {
  /** Whether `DELETE` would succeed now; the reason when it would not. */
  deletable?: boolean;
  notDeletableReason?: {
    code: "PRODUCT_IS_ACTIVE" | "PRODUCT_IN_USE";
    message: string;
  } | null;
  subtitle: TranslatedOptional | null;
  shortDescription: TranslatedOptional | null;
  description: TranslatedOptional | null;
  highlights: TranslatedList | null;
  uses: TranslatedList | null;
  categoryId: Id;
  minOrderQuantity: number;
  maxOrderQuantity: number | null;
  storageType: StorageType | null;
  food: ProductFood | null;
  tags: string[];
  searchKeywords: string[];
  seo: ProductSeo | null;
  /** In the admin's order; shown for every pack size. */
  images: AdminImage[];
  publishedAt: IsoDateTime | null;
}

// --- Stock (8) ----------------------------------------------------------------

export const STOCK_MOVEMENT_REASONS = [
  "restock",
  "adjustment",
  "import",
  "order",
  "cancel",
  "return",
  "release",
] as const;
export type StockMovementReason = (typeof STOCK_MOVEMENT_REASONS)[number];

/** One line of the stock history of a pack size (8.1): `delta` positive for units that came in. */
export interface StockMovement {
  id: Id;
  variantId: Id;
  sku: string;
  reason: StockMovementReason;
  delta: number;
  quantityAfter: number;
  orderId: Id | null;
  orderNumber: string | null;
  adminId: Id | null;
  admin?: AdminRef | null;
  note: string | null;
  createdAt: IsoDateTime;
}

/** `POST …/variants/{variantId}/stock`: the counted number, or units to add or remove. */
export type StockChangeInput =
  { quantity: number; note?: string } | { delta: number; note?: string };

/** `movement` is `null` when nothing changed (the same count again). */
export interface StockChangeResult {
  product: ProductDetail;
  movement: StockMovement | null;
}

export interface StockMovementQuery extends CursorQuery {
  /** Default newest first. */
  sort?: SortParam<"createdAt">;
}

// --- Import and export of the catalogue (8.2) ---------------------------------

/** One row of a sheet: the header names as keys, the cells as the parser gives them. */
export type ImportRow = Record<string, string | number | boolean>;
export type ImportSheetType = "categories" | "products";
/** What happens to a row that matches a record: left alone, or changed. */
export type ImportExisting = "skip" | "update";
export type ImportAction = "create" | "update" | "skip" | "unchanged" | "error";
/** At most this many rows per sheet and request. */
export const IMPORT_MAX_ROWS = 2000;

export interface ImportBody {
  categories?: ImportRow[];
  products?: ImportRow[];
  existing?: ImportExisting;
}

export interface ImportRowResult {
  /** 1 for the first data row of the file. */
  row: number;
  key: string;
  name: string;
  action: ImportAction;
  /** The record the row matched, or after an import the record it created: the category, or the product. */
  id: Id | null;
  /** Product rows: the pack size the row matched, or after an import the one it created. */
  variantId?: Id | null;
  /** The fields an update changes; `variant` for a pack size added to a product. */
  changes: string[];
  /** Why the row is not written. */
  problems: string[];
}

export interface ImportSummary {
  total: number;
  create: number;
  update: number;
  skip: number;
  unchanged: number;
  error: number;
}

export interface ImportSheetResult {
  summary: ImportSummary;
  rows: ImportRowResult[];
  /** Headers of the file the import ignores. */
  unknownColumns: string[];
}

export interface ImportResult {
  categories?: ImportSheetResult;
  products?: ImportSheetResult;
  applied: boolean;
  /** The row that failed while writing; the rows before it are written. */
  stoppedAt: { type: ImportSheetType; row: number } | null;
}

/** Every cell a string in the writing of the import. */
export interface ExportResult {
  type: ImportSheetType;
  columns: string[];
  rows: Record<string, string>[];
}

export interface ProductQuery extends PageQuery {
  status?: ProductStatus;
  /** Sub-categories included. */
  categoryId?: Id;
  /** 2 to 80 characters; every article number of a product counts. */
  q?: string;
  isAvailable?: boolean;
  /** `true`: products with a reduced enabled pack size. */
  onSale?: boolean;
  /** `true`: only products with a pack size at or below its threshold. */
  lowStock?: boolean;
  /** `sku` by the smallest article number, the prices by `priceFrom`. */
  sort?: ProductSort;
}

export interface ProductFoodInput {
  ingredients?: TranslatedOptional;
  allergens?: TranslatedOptional;
  nutrition?: TranslatedOptional;
  storageInstructions?: TranslatedOptional;
  origin?: string;
  manufacturer?: string;
}

/** A pack size as `POST /products` and `POST …/variants` take it (8). */
export interface VariantInput {
  /** Generated (`RF-00001`, …) when left out. */
  sku?: string;
  gtin?: string | null;
  /** 1 to 1000 packs; `null` removes the carton. */
  unitsPerCarton?: number | null;
  packSize: { value: number; unit: PackUnit };
  regularPrice: Cents;
  /** Below `regularPrice`; `null` ends a sale. Not together with `discountPercent`. */
  salePrice?: Cents | null;
  discountPercent?: number | null;
  /** Default `true`. */
  isEnabled?: boolean;
  /** The opening stock, 0 to 1,000,000 (default 0). Only when the pack size is created. */
  stockQuantity?: number;
  /** The admin is warned at or below this count; `null` removes it. */
  lowStockThreshold?: number | null;
}

/** `PATCH …/variants/{variantId}`: the count itself changes only through the stock endpoint. */
export type VariantPatch = Partial<Omit<VariantInput, "stockQuantity">>;

/** `POST /products`: the product with its pack sizes. */
export interface ProductInput {
  name: Translated;
  /** The base of the URLs; generated from the name when left out. */
  slug?: TranslatedOptional;
  subtitle?: TranslatedOptional;
  shortDescription?: TranslatedOptional;
  description?: TranslatedOptional;
  highlights?: TranslatedList;
  uses?: TranslatedList;
  brand?: string | null;
  categoryId: Id;
  /** 1 to 20, all of one unit family, no pack twice. */
  variants: VariantInput[];
  /** The same for every pack size. */
  vatRate: VatRate;
  status?: ProductStatus;
  isAvailable?: boolean;
  isFeatured?: boolean;
  sortOrder?: number;
  minOrderQuantity?: number;
  maxOrderQuantity?: number | null;
  storageType?: StorageType;
  food?: ProductFoodInput;
  tags?: string[];
  searchKeywords?: string[];
  seo?: { title?: TranslatedOptional; description?: TranslatedOptional };
}

/** `PATCH /products/{id}`: the product fields only; the pack sizes have endpoints of their own. */
export type ProductPatch = Partial<Omit<ProductInput, "variants">>;

export interface PriceChange {
  regularPrice: Cents;
  salePrice: Cents | null;
  price: Cents;
  vatRate: VatRate;
  changedBy: Id | null;
  changedAt: IsoDateTime;
}

export interface ImagePatch {
  alt?: TranslatedOptional;
  /** May only be `true`. */
  isPrimary?: true;
}
