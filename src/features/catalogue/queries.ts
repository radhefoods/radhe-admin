"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { hasErrorCode } from "@/lib/api/errors";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type {
  Category,
  CategoryInput,
  DuplicateProductInput,
  Id,
  ImagePatch,
  ListResult,
  PageResult,
  ProductDetail,
  ProductInput,
  ProductPatch,
  ProductQuery,
  ProductSummary,
  StockChangeInput,
  TranslatedOptional,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import { reorderSiblings } from "./category-tree";

// --- Reading ----------------------------------------------------------------

export function useProducts(query: ProductQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.products.list(query),
    queryFn: ({ signal }) => api.products.list(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * One product. `enabled: false` keeps what is loaded without asking again:
 * a product that is being deleted is not fetched once more.
 */
export function useProduct(id: Id, enabled = true) {
  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: async ({ signal }) => (await api.products.get(id, signal)).product,
    enabled,
  });
}

export function usePriceHistory(id: Id, enabled = true) {
  return useQuery({
    queryKey: queryKeys.products.priceHistory(id),
    queryFn: async ({ signal }) =>
      (await api.products.priceHistory(id, signal)).items,
    enabled,
  });
}

const MOVEMENTS_PAGE = 25;

/** The stock history of a product, newest first, page by page (8). */
export function useStockMovements(id: Id, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.products.stockMovements(id),
    queryFn: ({ pageParam, signal }) =>
      api.products.stockMovements(
        id,
        { limit: MOVEMENTS_PAGE, cursor: pageParam },
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
  });
}

/** Every category, flat and in display order (the list is small and whole). */
export function useCategories() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.categories.list(),
    queryFn: ({ signal }) => api.categories.list(signal),
    enabled: can("catalog.read"),
  });
}

// --- Products ---------------------------------------------------------------

/** The answer of a change is the product as it is now: the page shows it at once. */
function keepProduct(client: QueryClient, product: ProductDetail): void {
  client.setQueryData(queryKeys.products.detail(product.id), product);
}

export function useCreateProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductInput) =>
      (await api.products.create(input)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

export interface CreateWithImagesInput {
  input: ProductInput;
  /** The pictures chosen before the product existed; uploaded right after. */
  files: File[];
  onProgress?: (fraction: number) => void;
}

export interface CreateWithImagesResult {
  product: ProductDetail;
  /** `null` when every picture is stored; what the API said otherwise. */
  upload: unknown;
}

/**
 * Creates a product, then uploads its pictures: the API takes pictures only
 * for a product that exists (8), so they are two requests. A refused upload
 * does not undo the creation: the product is there, without pictures, and
 * the result says so.
 */
export function useCreateProductWithImages() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      input,
      files,
      onProgress,
    }: CreateWithImagesInput): Promise<CreateWithImagesResult> => {
      const created = (await api.products.create(input)).product;
      if (files.length === 0) return { product: created, upload: null };
      try {
        const withImages = (
          await api.products.uploadImages(created.id, files, onProgress)
        ).product;
        return { product: withImages, upload: null };
      } catch (error) {
        return { product: created, upload: error };
      }
    },
    onSuccess: ({ product }) => keepProduct(client, product),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

export function useUpdateProduct(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProductPatch) =>
      (await api.products.update(id, input)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

/**
 * Sets the counted number or adds and removes units (8). The answer is the
 * product as it is now, plus the line of the ledger; the history and the
 * low-stock group of the start page are loaded again.
 */
export function useChangeStock(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: StockChangeInput) =>
      api.products.changeStock(id, input),
    onSuccess: ({ product }) => keepProduct(client, product),
    meta: { invalidates: invalidation.stock, silent: true },
  });
}

export function useDeleteProduct() {
  return useMutation({
    mutationFn: (id: Id) => api.products.remove(id),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

export function useDuplicateProduct(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: DuplicateProductInput) =>
      (await api.products.duplicate(id, input)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

/** Makes one pack size the one shown in listings. */
export function useMakeDefault() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (id: Id) => (await api.products.makeDefault(id)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: { invalidates: [queryKeys.products.all] },
  });
}

type ProductPage = PageResult<ProductSummary>;

/**
 * The "available" switch of the list. It answers at once and steps back if
 * the API refuses: harmless, because nothing else depends on the answer.
 */
export function useSetAvailable() {
  const client = useQueryClient();
  const lists = [...queryKeys.products.all, "list"] as const;
  return useMutation({
    mutationFn: async ({ id, isAvailable }: { id: Id; isAvailable: boolean }) =>
      (await api.products.update(id, { isAvailable })).product,
    onMutate: async ({ id, isAvailable }) => {
      await client.cancelQueries({ queryKey: lists });
      const before = client.getQueriesData<ProductPage>({ queryKey: lists });
      client.setQueriesData<ProductPage>({ queryKey: lists }, (page) =>
        page
          ? {
              ...page,
              items: page.items.map((row) =>
                row.id === id ? { ...row, isAvailable } : row,
              ),
            }
          : page,
      );
      return { before };
    },
    onError: (_error, _input, context) => {
      for (const [queryKey, data] of context?.before ?? []) {
        client.setQueryData(queryKey, data);
      }
    },
    onSuccess: (product) => keepProduct(client, product),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}

// --- Images of a product ----------------------------------------------------

export interface UploadInput {
  files: File[];
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** All-or-nothing: if the API refuses one file, it stores none (8). */
export function useUploadImages(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, onProgress, signal }: UploadInput) =>
      (await api.products.uploadImages(id, files, onProgress, signal)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

export function useReplaceImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      imageId,
      file,
      onProgress,
      signal,
    }: {
      imageId: Id;
      file: File;
      onProgress?: (fraction: number) => void;
      signal?: AbortSignal;
    }) =>
      (await api.products.replaceImage(id, imageId, file, onProgress, signal))
        .product,
    onSuccess: (product) => keepProduct(client, product),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

export function usePatchImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ imageId, ...input }: ImagePatch & { imageId: Id }) =>
      (await api.products.patchImage(id, imageId, input)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

export function useRemoveImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: Id) =>
      (await api.products.removeImage(id, imageId)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

/**
 * The new order of the pictures. The grid follows at once; if the pictures
 * changed in the meantime (`IMAGE_ORDER_INVALID`), the product is loaded
 * again and the error says so.
 */
export function useReorderImages(id: Id) {
  const client = useQueryClient();
  const key = queryKeys.products.detail(id);
  return useMutation({
    mutationFn: async (orderedIds: Id[]) =>
      (await api.products.reorderImages(id, orderedIds)).product,
    onMutate: async (orderedIds) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<ProductDetail>(key);
      if (before) {
        const byId = new Map(before.images.map((image) => [image.id, image]));
        const images = orderedIds.flatMap((imageId) => byId.get(imageId) ?? []);
        if (images.length === before.images.length) {
          client.setQueryData<ProductDetail>(key, { ...before, images });
        }
      }
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before) client.setQueryData(key, context.before);
    },
    onSuccess: (product) => keepProduct(client, product),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.products.all });
    },
  });
}

// --- Categories -------------------------------------------------------------

type CategoryList = ListResult<Category>;

/** The answer of a change is the category as it is now: the tree shows it at once. */
function keepCategory(client: QueryClient, category: Category): void {
  client.setQueryData<CategoryList>(queryKeys.categories.list(), (list) =>
    list
      ? {
          ...list,
          items: list.items.map((entry) =>
            // Its place in the tree may have changed; the list is loaded again for that.
            entry.id === category.id
              ? { ...category, parentId: entry.parentId, level: entry.level }
              : entry,
          ),
        }
      : list,
  );
}

export function useCreateCategory() {
  return useMutation({
    mutationFn: async (input: CategoryInput) =>
      (await api.categories.create(input)).category,
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

export function useUpdateCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<CategoryInput> & { id: Id }) =>
      (await api.categories.update(id, input)).category,
    onSuccess: (category) => keepCategory(client, category),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

export function useDeleteCategory() {
  return useMutation({
    mutationFn: (id: Id) => api.categories.remove(id),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

/**
 * The new order of the categories of one parent. The API wants every child
 * of that parent; when the list changed in the meantime
 * (`CATEGORY_ORDER_INVALID`) the tree is loaded again and the error says so.
 */
export function useReorderCategories() {
  const client = useQueryClient();
  const key = queryKeys.categories.list();
  return useMutation({
    mutationFn: (input: { parentId: Id | null; orderedIds: Id[] }) =>
      api.categories.reorder(input),
    onMutate: async ({ parentId, orderedIds }) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<CategoryList>(key);
      if (before) {
        client.setQueryData<CategoryList>(key, {
          ...before,
          items: reorderSiblings(before.items, parentId, orderedIds),
        });
      }
      return { before };
    },
    onError: (error, _input, context) => {
      // The order the API has is the truth; the stale list is not put back
      // when the API said that it changed.
      if (context?.before && !hasErrorCode(error, "CATEGORY_ORDER_INVALID")) {
        client.setQueryData(key, context.before);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.categories.all });
    },
  });
}

export function usePutCategoryImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
      signal,
    }: {
      file: File;
      onProgress?: (fraction: number) => void;
      signal?: AbortSignal;
    }) =>
      (await api.categories.putImage(id, file, onProgress, signal)).category,
    onSuccess: (category) => keepCategory(client, category),
    meta: { invalidates: [queryKeys.categories.all], silent: true },
  });
}

export function usePatchCategoryImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (alt: TranslatedOptional) =>
      (await api.categories.patchImage(id, alt)).category,
    onSuccess: (category) => keepCategory(client, category),
    meta: { invalidates: [queryKeys.categories.all], silent: true },
  });
}

export function useRemoveCategoryImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => (await api.categories.removeImage(id)).category,
    onSuccess: (category) => keepCategory(client, category),
    meta: { invalidates: [queryKeys.categories.all], silent: true },
  });
}
