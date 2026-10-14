// Sections 7 (categories) and 8 (products and images).

import type {
  Cents,
  Id,
  IsoDateTime,
  PageQuery,
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
  image: AdminImage | null;
  /** Every product (all statuses and pack sizes) in the category and below. */
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
  seo?: { title?: TranslatedOptional; description?: TranslatedOptional };
}

export interface CategoryOrderInput {
  parentId: Id | null;
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

export interface ProductSummary {
  id: Id;
  sku: string;
  name: Translated;
  slug: Translated;
  brand: string | null;
  category: { id: Id; name: Translated };
  packSize: PackSize;
  pricing: PriceView;
  status: ProductStatus;
  isAvailable: boolean;
  isFeatured: boolean;
  sortOrder: number;
  /** `null` for a product without other pack sizes. */
  variantGroupId: Id | null;
  isDefaultVariant: boolean;
  packSizeCount: number;
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

/** A member of the variant group, smallest first. */
export interface ProductPackSizeEntry {
  id: Id;
  sku: string;
  packSize: PackSize;
  pricing: PriceView;
  status: ProductStatus;
  isAvailable: boolean;
  isDefault: boolean;
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
  gtin: string | null;
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
  /** In the admin's order. */
  images: AdminImage[];
  /** `[]` for a product without a group. */
  packSizes: ProductPackSizeEntry[];
  publishedAt: IsoDateTime | null;
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
  /** The record the row matched, or after an import the record it created. */
  id: Id | null;
  /** The fields an update changes. */
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
  /** 2 to 80 characters. */
  q?: string;
  isAvailable?: boolean;
  onSale?: boolean;
  variantGroupId?: Id;
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

/** `POST /products`; every field optional on `PATCH`. */
export interface ProductInput {
  sku?: string;
  gtin?: string | null;
  name: Translated;
  slug?: TranslatedOptional;
  subtitle?: TranslatedOptional;
  shortDescription?: TranslatedOptional;
  description?: TranslatedOptional;
  highlights?: TranslatedList;
  uses?: TranslatedList;
  brand?: string | null;
  categoryId: Id;
  packSize: { value: number; unit: PackUnit };
  /** Id of any pack size of the product to join; `null` separates. */
  variantOf?: Id | null;
  regularPrice: Cents;
  /** Below `regularPrice`; `null` ends a sale. Not together with `discountPercent`. */
  salePrice?: Cents | null;
  discountPercent?: number | null;
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

export type ProductPatch = Partial<ProductInput>;

export interface DuplicateProductInput {
  sku?: string;
  packSize: { value: number; unit: PackUnit };
  regularPrice: Cents;
  salePrice?: Cents | null;
  discountPercent?: number | null;
  /** Default `true`: the copy joins the pack sizes of the product. */
  asVariant?: boolean;
  /** Default `true`. */
  copyImages?: boolean;
}

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
