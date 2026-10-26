// Section 25: the wholesale catalogue, apart from the retail one.

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  ExportResult,
  Id,
  ImportBody,
  ImportResult,
  ImportSheetType,
  ListResult,
  PageResult,
  TranslatedOptional,
  WholesaleCategory,
  WholesaleCategoryInput,
  WholesaleCategoryPatch,
  WholesaleFromRetailInput,
  WholesaleImagePatch,
  WholesaleProductDetail,
  WholesaleProductInput,
  WholesaleProductPatch,
  WholesaleProductQuery,
  WholesaleProductSummary,
  WholesaleSkuInput,
  WholesaleSkuPatch,
  WholesaleStockChangeInput,
  WholesaleStockChangeResult,
  WholesaleStockMovement,
  WholesaleStockMovementQuery,
} from "../types";

type Progress = (fraction: number) => void;

function oneFile(file: File): FormData {
  const form = new FormData();
  form.append("file", file);
  return form;
}

type Category = { category: WholesaleCategory };
type Product = { product: WholesaleProductDetail };

export function wholesaleCategoriesApi({ request, upload }: SessionTransport) {
  const base = "/v1/admin/wholesale/categories";
  return {
    /** Every category in display order, with its product count. */
    list: (signal?: AbortSignal) =>
      request<ListResult<WholesaleCategory>>(base, { signal }),
    get: (id: Id, signal?: AbortSignal) =>
      request<Category>(`${base}/${id}`, { signal }),
    create: (input: WholesaleCategoryInput) =>
      request<Category>(base, { method: "POST", body: input }),
    update: (id: Id, input: WholesaleCategoryPatch) =>
      request<Category>(`${base}/${id}`, { method: "PATCH", body: input }),
    /** `204`; `409 WHOLESALE_CATEGORY_HAS_PRODUCTS` while products are in it. */
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
    /** The named come first, the others keep their order; the answer is the whole list. */
    reorder: (orderedIds: Id[]) =>
      request<ListResult<WholesaleCategory>>(`${base}/order`, {
        method: "PUT",
        body: { orderedIds },
      }),
    /** The products of the category, every status, in display order. */
    products: (id: Id, signal?: AbortSignal) =>
      request<ListResult<WholesaleProductSummary>>(`${base}/${id}/products`, {
        signal,
      }),
    /** The new order of the products; may be partial; the answer is the whole list. */
    reorderProducts: (id: Id, orderedIds: Id[]) =>
      request<ListResult<WholesaleProductSummary>>(
        `${base}/${id}/products/order`,
        { method: "PUT", body: { orderedIds } },
      ),
    putImage: (
      id: Id,
      file: File,
      onProgress?: Progress,
      signal?: AbortSignal,
    ) =>
      upload<Category>(`${base}/${id}/image`, {
        method: "PUT",
        formData: oneFile(file),
        onProgress,
        signal,
      }),
    patchImage: (id: Id, alt: TranslatedOptional) =>
      request<Category>(`${base}/${id}/image`, {
        method: "PATCH",
        body: { alt },
      }),
    removeImage: (id: Id) =>
      request<Category>(`${base}/${id}/image`, { method: "DELETE" }),
  };
}

export function wholesaleProductsApi({ request, upload }: SessionTransport) {
  const base = "/v1/admin/wholesale/products";
  return {
    list: (query: WholesaleProductQuery = {}, signal?: AbortSignal) =>
      request<PageResult<WholesaleProductSummary>>(base, {
        query: query as Query,
        signal,
      }),
    get: (id: Id, signal?: AbortSignal) =>
      request<Product>(`${base}/${id}`, { signal }),
    create: (input: WholesaleProductInput) =>
      request<Product>(base, { method: "POST", body: input }),
    update: (id: Id, input: WholesaleProductPatch) =>
      request<Product>(`${base}/${id}`, { method: "PATCH", body: input }),
    /** `204`, allowed in every status: quotations keep their own copy of every line. */
    remove: (id: Id) => request<void>(`${base}/${id}`, { method: "DELETE" }),
    /** A one-time copy of a retail product with the cartons given (section 6). */
    fromRetail: (input: WholesaleFromRetailInput) =>
      request<Product>(`${base}/from-retail`, { method: "POST", body: input }),
    /** Adds a SKU, with an opening stock if given; the answer is the whole product. */
    addSku: (id: Id, input: WholesaleSkuInput) =>
      request<Product>(`${base}/${id}/skus`, { method: "POST", body: input }),
    /** Changes a SKU; never its stock (the API refuses it). */
    updateSku: (id: Id, skuId: Id, input: WholesaleSkuPatch) =>
      request<Product>(`${base}/${id}/skus/${skuId}`, {
        method: "PATCH",
        body: input,
      }),
    /** `200` with the product; `409 WHOLESALE_SKU_LAST` for the last one. */
    removeSku: (id: Id, skuId: Id) =>
      request<Product>(`${base}/${id}/skus/${skuId}`, { method: "DELETE" }),
    /** Sets or adjusts the cartons on hand through the ledger (section 8). */
    setStock: (id: Id, skuId: Id, input: WholesaleStockChangeInput) =>
      request<WholesaleStockChangeResult>(`${base}/${id}/skus/${skuId}/stock`, {
        method: "PUT",
        body: input,
      }),
    /** The ledger of the product, newest first, by page; `skuId` narrows it. */
    stockMovements: (
      id: Id,
      query: WholesaleStockMovementQuery = {},
      signal?: AbortSignal,
    ) =>
      request<PageResult<WholesaleStockMovement>>(
        `${base}/${id}/stock-movements`,
        { query: query as Query, signal },
      ),
    /** All-or-nothing, as for retail products. */
    uploadImages: (
      id: Id,
      files: File[],
      onProgress?: Progress,
      signal?: AbortSignal,
    ) => {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      return upload<Product>(`${base}/${id}/images`, {
        method: "POST",
        formData: form,
        onProgress,
        signal,
      });
    },
    reorderImages: (id: Id, orderedIds: Id[]) =>
      request<Product>(`${base}/${id}/images/order`, {
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
      upload<Product>(`${base}/${id}/images/${imageId}`, {
        method: "PUT",
        formData: oneFile(file),
        onProgress,
        signal,
      }),
    patchImage: (id: Id, imageId: Id, input: WholesaleImagePatch) =>
      request<Product>(`${base}/${id}/images/${imageId}`, {
        method: "PATCH",
        body: input,
      }),
    removeImage: (id: Id, imageId: Id) =>
      request<Product>(`${base}/${id}/images/${imageId}`, {
        method: "DELETE",
      }),
  };
}

/** Section 7: CSV import and export of the wholesale catalogue, the flow of the retail one. */
export function wholesaleSheetsApi({ request }: SessionTransport) {
  const base = "/v1/admin/wholesale";
  return {
    preview: (body: ImportBody, signal?: AbortSignal) =>
      request<ImportResult>(`${base}/import/preview`, {
        method: "POST",
        body,
        signal,
      }),
    run: (body: ImportBody) =>
      request<ImportResult>(`${base}/import`, { method: "POST", body }),
    export: (type: ImportSheetType, signal?: AbortSignal) =>
      request<ExportResult>(`${base}/export`, { query: { type }, signal }),
  };
}
