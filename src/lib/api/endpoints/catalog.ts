// Sections 7 (categories) and 8 (products and images).

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  Category,
  CategoryInput,
  CategoryOrderInput,
  DuplicateProductInput,
  ExportResult,
  Id,
  ImportBody,
  ImportResult,
  ImportSheetType,
  ImagePatch,
  ListResult,
  PageResult,
  PriceChange,
  ProductDetail,
  ProductInput,
  ProductPatch,
  ProductQuery,
  ProductSummary,
  TranslatedOptional,
} from "../types";

type Progress = (fraction: number) => void;

function oneFile(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

export function categoriesApi({ request, upload }: SessionTransport) {
  const base = "/v1/admin/categories";
  return {
    /** A flat list in display order: each parent followed by its children. */
    list: (signal?: AbortSignal) =>
      request<ListResult<Category>>(base, { signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ category: Category }>(`${base}/${id}`, { signal }),
    create: (input: CategoryInput) =>
      request<{ category: Category }>(base, { method: "POST", body: input }),
    update: (id: Id, input: Partial<CategoryInput>) =>
      request<{ category: Category }>(`${base}/${id}`, {
        method: "PATCH",
        body: input,
      }),
    reorder: (input: CategoryOrderInput) =>
      request<void>(`${base}/order`, { method: "PUT", body: input }),
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
    putImage: (
      id: Id,
      file: File,
      onProgress?: Progress,
      signal?: AbortSignal,
    ) =>
      upload<{ category: Category }>(`${base}/${id}/image`, {
        method: "PUT",
        formData: oneFile(file),
        onProgress,
        signal,
      }),
    patchImage: (id: Id, alt: TranslatedOptional) =>
      request<{ category: Category }>(`${base}/${id}/image`, {
        method: "PATCH",
        body: { alt },
      }),
    removeImage: (id: Id) =>
      request<{ category: Category }>(`${base}/${id}/image`, {
        method: "DELETE",
      }),
  };
}

export function productsApi({ request, upload }: SessionTransport) {
  const base = "/v1/admin/products";
  return {
    list: (query: ProductQuery = {}, signal?: AbortSignal) =>
      request<PageResult<ProductSummary>>(base, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<{ product: ProductDetail }>(`${base}/${id}`, { signal }),
    create: (input: ProductInput) =>
      request<{ product: ProductDetail }>(base, {
        method: "POST",
        body: input,
      }),
    update: (id: Id, input: ProductPatch) =>
      request<{ product: ProductDetail }>(`${base}/${id}`, {
        method: "PATCH",
        body: input,
      }),
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
    duplicate: (id: Id, input: DuplicateProductInput) =>
      request<{ product: ProductDetail }>(`${base}/${id}/duplicate`, {
        method: "POST",
        body: input,
      }),
    makeDefault: (id: Id) =>
      request<{ product: ProductDetail }>(`${base}/${id}/make-default`, {
        method: "POST",
      }),
    priceHistory: (id: Id, signal?: AbortSignal) =>
      request<ListResult<PriceChange>>(`${base}/${id}/price-history`, {
        signal,
      }),
    /** All-or-nothing: if one file is refused, nothing is stored. */
    uploadImages: (
      id: Id,
      files: File[],
      onProgress?: Progress,
      signal?: AbortSignal,
    ) => {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      return upload<{ product: ProductDetail }>(`${base}/${id}/images`, {
        method: "POST",
        formData: form,
        onProgress,
        signal,
      });
    },
    reorderImages: (id: Id, orderedIds: Id[]) =>
      request<{ product: ProductDetail }>(`${base}/${id}/images/order`, {
        method: "PUT",
        body: { orderedIds },
      }),
    replaceImage: (
      id: Id,
      imageId: Id,
      file: File,
      onProgress?: Progress,
      signal?: AbortSignal,
    ) =>
      upload<{ product: ProductDetail }>(`${base}/${id}/images/${imageId}`, {
        method: "PUT",
        formData: oneFile(file),
        onProgress,
        signal,
      }),
    patchImage: (id: Id, imageId: Id, input: ImagePatch) =>
      request<{ product: ProductDetail }>(`${base}/${id}/images/${imageId}`, {
        method: "PATCH",
        body: input,
      }),
    removeImage: (id: Id, imageId: Id) =>
      request<{ product: ProductDetail }>(`${base}/${id}/images/${imageId}`, {
        method: "DELETE",
      }),
  };
}

/** 8.2: CSV import and Excel export of the catalogue. */
export function catalogSheetsApi({ request }: SessionTransport) {
  const base = "/v1/admin/catalog";
  return {
    /** What an import would do, row by row. Nothing is written. */
    preview: (body: ImportBody, signal?: AbortSignal) =>
      request<ImportResult>(`${base}/import/preview`, {
        method: "POST",
        body,
        signal,
      }),
    /** Writes the rows; stops at the first row that fails while writing. */
    run: (body: ImportBody) =>
      request<ImportResult>(`${base}/import`, { method: "POST", body }),
    /** Every category or product as flat rows in the columns of the import. */
    export: (type: ImportSheetType, signal?: AbortSignal) =>
      request<ExportResult>(`${base}/export`, { query: { type }, signal }),
  };
}
