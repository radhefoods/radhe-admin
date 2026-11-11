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
import {
  hasErrorCode,
  isSessionError,
  type ApiErrorCode,
} from "@/lib/api/errors";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import {
  IMAGE_LIMITS,
  type AdminImage,
  type Category,
  type CategoryInput,
  type Id,
  type ImageCopyInput,
  type ImagePatch,
  type ListResult,
  type PackUnit,
  type PageResult,
  type ProductDetail,
  type ProductInput,
  type ProductPatch,
  type ProductQuery,
  type ProductSummary,
  type ProductVariant,
  type StockChangeInput,
  type Translated,
  type TranslatedOptional,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import type { Permission } from "@/lib/auth/permissions";
import { reorderSiblings } from "./category-tree";
import type { ProductPlan } from "./product-schema";
import { baseQuantity } from "./variants";

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

/** The prices one pack size had, newest first (8). */
export function usePriceHistory(id: Id, variantId: Id, enabled = true) {
  return useQuery({
    queryKey: queryKeys.products.priceHistory(id, variantId),
    queryFn: async ({ signal }) =>
      (await api.products.priceHistory(id, variantId, signal)).items,
    enabled,
  });
}

const MOVEMENTS_PAGE = 25;

/** The stock history of one pack size, newest first, page by page (8). */
export function useStockMovements(id: Id, variantId: Id, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.products.stockMovements(id, variantId),
    queryFn: ({ pageParam, signal }) =>
      api.products.stockMovements(
        id,
        variantId,
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

/** The pictures chosen for one pack size of a product that does not exist yet. */
export interface RowPictures {
  packSize: { value: number; unit: PackUnit };
  files: File[];
}

export interface CreateWithImagesInput {
  input: ProductInput;
  /** Per pack size, the pictures chosen before the product existed. */
  pictures: RowPictures[];
  onProgress?: (fraction: number) => void;
}

/** What came of the pictures of one pack size. */
export interface PictureUpload {
  /** "5 kg". */
  label: string;
  count: number;
  /** `null` when the pictures are stored; what the API said otherwise. */
  error: unknown;
}

export interface CreateWithImagesResult {
  product: ProductDetail;
  /** One entry per pack size that had pictures chosen. */
  uploads: PictureUpload[];
}

/**
 * Creates a product, then uploads the pictures of each pack size to it: the
 * API takes pictures only for a pack size that exists (8), so they are
 * requests of their own. The pack sizes are found by their pack, not by
 * their place: the API answers them smallest first. A refused upload does
 * not undo the creation, and does not stop the pictures of the other pack
 * sizes: the result says what was stored.
 */
export function useCreateProductWithImages() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      input,
      pictures,
      onProgress,
    }: CreateWithImagesInput): Promise<CreateWithImagesResult> => {
      let product = (await api.products.create(input)).product;
      const chosen = pictures.filter((entry) => entry.files.length > 0);
      const total = chosen.reduce((sum, entry) => sum + entry.files.length, 0);
      const uploads: PictureUpload[] = [];
      let sent = 0;
      for (const { packSize, files } of chosen) {
        const wanted = baseQuantity(packSize.value, packSize.unit);
        const variant = product.variants.find(
          (entry) =>
            baseQuantity(entry.packSize.value, entry.packSize.unit) === wanted,
        );
        const label =
          variant?.packSize.label ?? `${packSize.value} ${packSize.unit}`;
        const before = sent;
        try {
          if (!variant) {
            throw new Error(
              `The API did not answer the pack size ${label}. Add its pictures on the page of the product.`,
            );
          }
          product = (
            await api.products.uploadImages(
              product.id,
              variant.id,
              files,
              (fraction) =>
                onProgress?.((before + fraction * files.length) / total),
            )
          ).product;
          uploads.push({ label, count: files.length, error: null });
        } catch (error) {
          if (isSessionError(error)) throw error;
          uploads.push({ label, count: files.length, error });
        }
        sent += files.length;
        onProgress?.(sent / total);
      }
      return { product, uploads };
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
 * Sets the counted number of a pack size or adds and removes units (8).
 * The answer is the product as it is now, plus the line of the ledger; the
 * history and the low-stock group of the start page are loaded again.
 */
export function useChangeStock(id: Id, variantId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: StockChangeInput) =>
      api.products.changeStock(id, variantId, input),
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

/** One request of saving a product: the product itself, or one of its pack sizes. */
export interface SaveStep {
  kind: "product" | "remove" | "change" | "add";
  /** "the product details", "5 kg", "a new pack size". */
  label: string;
  /** The pack size of a `remove` or `change` step. */
  variantId?: Id;
  /** The row of the form of an `add` step. */
  row?: number;
}

/**
 * What came of saving: the product as the API has it now, the steps that
 * went through, the one that failed and the ones that were not sent.
 */
export interface SaveReport {
  product: ProductDetail;
  done: SaveStep[];
  failed: { step: SaveStep; error: unknown } | null;
  pending: SaveStep[];
}

/**
 * Saves an existing product (8): the product fields in one request, then
 * every pack size that is removed, changed or added in a request of its
 * own, in that order. Every answer is the whole product. The sequence stops
 * at the first refusal; what went through before it stays saved, and the
 * report says what is still to be sent.
 */
export function useSaveProduct(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      product,
      plan,
    }: {
      product: ProductDetail;
      plan: ProductPlan;
    }): Promise<SaveReport> => {
      const steps: { step: SaveStep; run: () => Promise<ProductDetail> }[] = [];
      if (Object.keys(plan.patch).length > 0) {
        steps.push({
          step: { kind: "product", label: "the product details" },
          run: async () => (await api.products.update(id, plan.patch)).product,
        });
      }
      for (const variant of plan.remove) {
        steps.push({
          step: {
            kind: "remove",
            label: variant.packSize.label,
            variantId: variant.id,
          },
          run: async () =>
            (await api.products.removeVariant(id, variant.id)).product,
        });
      }
      for (const { variant, patch } of plan.change) {
        steps.push({
          step: {
            kind: "change",
            label: variant.packSize.label,
            variantId: variant.id,
          },
          run: async () =>
            (await api.products.updateVariant(id, variant.id, patch)).product,
        });
      }
      for (const { row, label, input } of plan.add) {
        steps.push({
          step: { kind: "add", label, row },
          run: async () => (await api.products.addVariant(id, input)).product,
        });
      }
      let latest = product;
      const done: SaveStep[] = [];
      for (const [index, { step, run }] of steps.entries()) {
        try {
          latest = await run();
          done.push(step);
        } catch (error) {
          if (isSessionError(error)) throw error;
          return {
            product: latest,
            done,
            failed: { step, error },
            pending: steps.slice(index + 1).map((entry) => entry.step),
          };
        }
      }
      return { product: latest, done, failed: null, pending: [] };
    },
    onSuccess: ({ product }) => keepProduct(client, product),
    meta: {
      invalidates: [
        queryKeys.products.all,
        queryKeys.categories.all,
        queryKeys.attention,
      ],
      silent: true,
    },
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

// --- Images ---------------------------------------------------------------

/**
 * A record the picture manager works on: a wholesale product, which holds
 * its pictures itself, or a retail product, whose pictures belong to its
 * pack sizes (doc/VARIANT_IMAGES.md).
 */
export interface ImageOwner {
  id: Id;
  name: Translated;
}

type Progress = (fraction: number) => void;

/** The five calls of the pictures of a record (8, 25), as the API client offers them. */
export interface ImageEndpoints<P extends ImageOwner> {
  uploadImages: (
    id: Id,
    files: File[],
    onProgress?: Progress,
    signal?: AbortSignal,
  ) => Promise<{ product: P }>;
  replaceImage: (
    id: Id,
    imageId: Id,
    file: File,
    onProgress?: Progress,
    signal?: AbortSignal,
  ) => Promise<{ product: P }>;
  patchImage: (
    id: Id,
    imageId: Id,
    input: ImagePatch,
  ) => Promise<{ product: P }>;
  removeImage: (id: Id, imageId: Id) => Promise<{ product: P }>;
  reorderImages: (id: Id, orderedIds: Id[]) => Promise<{ product: P }>;
}

/**
 * Where one gallery lives: the endpoints, the query that holds the record,
 * what to load again, who may change the pictures, and, where the record
 * does not hold them itself, where in it they are and how many fit. The
 * pack size of a retail product and the wholesale product share the
 * picture manager through it.
 */
export interface ImageTarget<P extends ImageOwner> {
  id: Id;
  endpoints: ImageEndpoints<P>;
  detailKey: readonly unknown[];
  invalidates: readonly (readonly unknown[])[];
  /** The code the API answers for a record that is gone. */
  notFound: ApiErrorCode;
  permission: Permission;
  /** Where the record is shown: "the shop", "the wholesale site". */
  site: string;
  /**
   * Where the pictures are in the record, and the record with them in
   * another order. Left out: the record holds them itself as `images`.
   */
  gallery?: {
    of: (record: P) => AdminImage[];
    put: (record: P, images: AdminImage[]) => P;
  };
  /** How many pictures fit. Left out: those of a wholesale product. */
  limit?: number;
  /** What holds the pictures, in words: "pack size". Left out: "product". */
  holder?: string;
  /** What holds them, by name: "5 kg". Left out: the name of the record. */
  label?: string;
  /** Further codes that say the holder is gone. */
  gone?: readonly ApiErrorCode[];
}

/** The pictures of a gallery, as the record has them. */
export function imagesOf<P extends ImageOwner>(
  target: ImageTarget<P>,
  record: P,
): AdminImage[] {
  if (target.gallery) return target.gallery.of(record);
  return (record as { images?: AdminImage[] }).images ?? [];
}

function withImages<P extends ImageOwner>(
  target: ImageTarget<P>,
  record: P,
  images: AdminImage[],
): P {
  return target.gallery
    ? target.gallery.put(record, images)
    : { ...record, images };
}

/** How many pictures the gallery holds at most. */
export function imageLimit<P extends ImageOwner>(
  target: ImageTarget<P>,
): number {
  return target.limit ?? IMAGE_LIMITS.wholesaleProduct;
}

/** The codes that say the record, or what holds the pictures in it, is gone. */
export function goneCodes<P extends ImageOwner>(
  target: ImageTarget<P>,
): ApiErrorCode[] {
  return [target.notFound, ...(target.gone ?? [])];
}

/**
 * The pictures of one pack size of a retail product (8): at most 8, with
 * the calls under `…/variants/{variantId}/images`. Every call answers the
 * whole product, which replaces the product of the page.
 */
export function variantImages(
  productId: Id,
  variant: Pick<ProductVariant, "id" | "packSize">,
): ImageTarget<ProductDetail> {
  const variantId = variant.id;
  const { products } = api;
  return {
    id: productId,
    endpoints: {
      uploadImages: (id, files, onProgress, signal) =>
        products.uploadImages(id, variantId, files, onProgress, signal),
      replaceImage: (id, imageId, file, onProgress, signal) =>
        products.replaceImage(id, variantId, imageId, file, onProgress, signal),
      patchImage: (id, imageId, input) =>
        products.patchImage(id, variantId, imageId, input),
      removeImage: (id, imageId) =>
        products.removeImage(id, variantId, imageId),
      reorderImages: (id, orderedIds) =>
        products.reorderImages(id, variantId, orderedIds),
    },
    detailKey: queryKeys.products.detail(productId),
    invalidates: invalidation.catalog,
    notFound: "PRODUCT_NOT_FOUND",
    gone: ["PRODUCT_VARIANT_NOT_FOUND"],
    permission: "catalog.manage",
    site: "the shop",
    gallery: {
      of: (product) =>
        product.variants.find((entry) => entry.id === variantId)?.images ?? [],
      put: (product, images) => ({
        ...product,
        variants: product.variants.map((entry) =>
          entry.id === variantId ? { ...entry, images } : entry,
        ),
        defaultVariant:
          product.defaultVariant.id === variantId
            ? { ...product.defaultVariant, images }
            : product.defaultVariant,
      }),
    },
    limit: IMAGE_LIMITS.variant,
    holder: "pack size",
    label: variant.packSize.label,
  };
}

/**
 * Shows pictures of another pack size of the product on this one too (8).
 * No file is stored twice; each pack size keeps its own order, main
 * picture and descriptions.
 */
export function useCopyImages(productId: Id, variantId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: ImageCopyInput) =>
      (await api.products.copyImages(productId, variantId, input)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: { invalidates: invalidation.catalog, silent: true },
  });
}

export interface UploadInput {
  files: File[];
  onProgress?: Progress;
  signal?: AbortSignal;
}

/** The answer of a change is the record as it is now: the page shows it at once. */
function keepOwner<P extends ImageOwner>(
  client: QueryClient,
  target: ImageTarget<P>,
  product: P,
): void {
  client.setQueryData(target.detailKey, product);
}

/** All-or-nothing: if the API refuses one file, it stores none (8). */
export function useUploadImages<P extends ImageOwner>(target: ImageTarget<P>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ files, onProgress, signal }: UploadInput) =>
      (
        await target.endpoints.uploadImages(
          target.id,
          files,
          onProgress,
          signal,
        )
      ).product,
    onSuccess: (product) => keepOwner(client, target, product),
    meta: { invalidates: target.invalidates, silent: true },
  });
}

export function useReplaceImage<P extends ImageOwner>(target: ImageTarget<P>) {
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
      onProgress?: Progress;
      signal?: AbortSignal;
    }) =>
      (
        await target.endpoints.replaceImage(
          target.id,
          imageId,
          file,
          onProgress,
          signal,
        )
      ).product,
    onSuccess: (product) => keepOwner(client, target, product),
    meta: { invalidates: target.invalidates, silent: true },
  });
}

export function usePatchImage<P extends ImageOwner>(target: ImageTarget<P>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ imageId, ...input }: ImagePatch & { imageId: Id }) =>
      (await target.endpoints.patchImage(target.id, imageId, input)).product,
    onSuccess: (product) => keepOwner(client, target, product),
    meta: { invalidates: target.invalidates, silent: true },
  });
}

export function useRemoveImage<P extends ImageOwner>(target: ImageTarget<P>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (imageId: Id) =>
      (await target.endpoints.removeImage(target.id, imageId)).product,
    onSuccess: (product) => keepOwner(client, target, product),
    meta: { invalidates: target.invalidates, silent: true },
  });
}

/**
 * The new order of the pictures. The grid follows at once; if the pictures
 * changed in the meantime (`IMAGE_ORDER_INVALID`), the record is loaded
 * again and the error says so.
 */
export function useReorderImages<P extends ImageOwner>(target: ImageTarget<P>) {
  const client = useQueryClient();
  const key = target.detailKey;
  return useMutation({
    mutationFn: async (orderedIds: Id[]) =>
      (await target.endpoints.reorderImages(target.id, orderedIds)).product,
    onMutate: async (orderedIds) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<P>(key);
      if (before) {
        const current = imagesOf(target, before);
        const byId = new Map(current.map((image) => [image.id, image]));
        const images = orderedIds.flatMap((imageId) => byId.get(imageId) ?? []);
        if (images.length === current.length) {
          client.setQueryData<P>(key, withImages(target, before, images));
        }
      }
      return { before };
    },
    onError: (_error, _input, context) => {
      if (context?.before) client.setQueryData(key, context.before);
    },
    onSuccess: (product) => keepOwner(client, target, product),
    onSettled: () => {
      for (const queryKey of target.invalidates)
        void client.invalidateQueries({ queryKey });
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

/** The products directly in a category, in display order (7). */
export function useCategoryProducts(id: Id) {
  return useQuery({
    queryKey: queryKeys.categories.products(id),
    queryFn: async ({ signal }) =>
      (await api.categories.products(id, signal)).items,
  });
}

/**
 * The new order of the products of a category (7). The API answers the
 * whole list in its new order, which replaces what the page shows; the
 * product lists are loaded again for their positions.
 */
export function useReorderCategoryProducts(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: Id[]) =>
      (await api.categories.reorderProducts(id, { orderedIds })).items,
    onSuccess: (items) => {
      client.setQueryData(queryKeys.categories.products(id), items);
    },
    meta: { invalidates: [queryKeys.products.all], silent: true },
  });
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

/**
 * Uploads or replaces the picture of a category (7). `id` names another
 * category than the hook's: a category that was created a moment ago.
 */
export function usePutCategoryImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      onProgress,
      signal,
      id: other,
    }: {
      file: File;
      onProgress?: (fraction: number) => void;
      signal?: AbortSignal;
      id?: Id;
    }) =>
      (await api.categories.putImage(other ?? id, file, onProgress, signal))
        .category,
    onSuccess: (category) => keepCategory(client, category),
    meta: { invalidates: [queryKeys.categories.all], silent: true },
  });
}

/** The description of the picture (7); `id` for a category created a moment ago. */
export function usePatchCategoryImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id: other,
      ...alt
    }: TranslatedOptional & { id?: Id }) =>
      (await api.categories.patchImage(other ?? id, alt)).category,
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
