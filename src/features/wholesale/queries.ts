"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { ImageTarget } from "@/features/catalogue/queries";
import { api } from "@/lib/api/client";
import { hasErrorCode, isSessionError } from "@/lib/api/errors";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type {
  Id,
  ListResult,
  PageResult,
  TranslatedOptional,
  WholesaleCategory,
  WholesaleCategoryInput,
  WholesaleCategoryPatch,
  WholesaleFromRetailInput,
  WholesaleProductDetail,
  WholesaleProductInput,
  WholesaleProductQuery,
  WholesaleProductSummary,
  WholesaleStockChangeInput,
  WholesaleStockMovementQuery,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";
import type { ProductPlan } from "./product-schema";

// The wholesale catalogue (25): every read and every change, each change
// loading again what it makes stale. The quotation pages show the stock
// of the SKUs, so they are loaded again too (`invalidation.wholesale`).

const META = { invalidates: invalidation.wholesale, silent: true } as const;

// --- Reading -------------------------------------------------------------------

/** Every wholesale category, in display order (the list is small and whole). */
export function useWholesaleCategories() {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.wholesale.categories(),
    queryFn: ({ signal }) => api.wholesaleCategories.list(signal),
    enabled: can("wholesale.read"),
  });
}

/** The products of a category, every status, in display order. */
export function useWholesaleCategoryProducts(id: Id, enabled = true) {
  return useQuery({
    queryKey: queryKeys.wholesale.categoryProducts(id),
    queryFn: async ({ signal }) =>
      (await api.wholesaleCategories.products(id, signal)).items,
    enabled,
  });
}

export function useWholesaleProducts(query: WholesaleProductQuery) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.wholesale.products(query),
    queryFn: ({ signal }) => api.wholesaleProducts.list(query, signal),
    placeholderData: keepPreviousData,
    enabled: can("wholesale.read"),
  });
}

/** One product. `enabled: false` keeps what is loaded: a product being deleted is not asked for again. */
export function useWholesaleProduct(id: Id, enabled = true) {
  return useQuery({
    queryKey: queryKeys.wholesale.product(id),
    queryFn: async ({ signal }) =>
      (await api.wholesaleProducts.get(id, signal)).product,
    enabled,
  });
}

/** The stock ledger of a product, newest first, by page (section 8). */
export function useWholesaleStockMovements(
  id: Id,
  query: WholesaleStockMovementQuery,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.wholesale.stockMovements(id, query),
    queryFn: ({ signal }) =>
      api.wholesaleProducts.stockMovements(id, query, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

// --- Categories ------------------------------------------------------------------

type CategoryList = ListResult<WholesaleCategory>;

/** The answer of a change is the category as it is now: the list shows it at once. */
function keepCategory(client: QueryClient, category: WholesaleCategory): void {
  client.setQueryData<CategoryList>(queryKeys.wholesale.categories(), (list) =>
    list
      ? {
          ...list,
          items: list.items.map((entry) =>
            entry.id === category.id ? category : entry,
          ),
        }
      : list,
  );
}

export function useCreateWholesaleCategory() {
  return useMutation({
    mutationFn: async (input: WholesaleCategoryInput) =>
      (await api.wholesaleCategories.create(input)).category,
    meta: META,
  });
}

export function useUpdateWholesaleCategory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: WholesaleCategoryPatch & { id: Id }) =>
      (await api.wholesaleCategories.update(id, input)).category,
    onSuccess: (category) => keepCategory(client, category),
    meta: META,
  });
}

export function useDeleteWholesaleCategory() {
  return useMutation({
    mutationFn: (id: Id) => api.wholesaleCategories.remove(id),
    meta: META,
  });
}

/**
 * The new order of the categories. The list follows at once; when it
 * changed in the meantime (`WHOLESALE_CATEGORY_ORDER_INVALID`) the API's
 * list is the truth and the error says so.
 */
export function useReorderWholesaleCategories() {
  const client = useQueryClient();
  const key = queryKeys.wholesale.categories();
  return useMutation({
    mutationFn: (orderedIds: Id[]) =>
      api.wholesaleCategories.reorder(orderedIds),
    onMutate: async (orderedIds) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<CategoryList>(key);
      if (before) {
        const byId = new Map(before.items.map((entry) => [entry.id, entry]));
        const named = orderedIds.flatMap((id) => byId.get(id) ?? []);
        const rest = before.items.filter(
          (entry) => !orderedIds.includes(entry.id),
        );
        client.setQueryData<CategoryList>(key, {
          ...before,
          items: [...named, ...rest],
        });
      }
      return { before };
    },
    onSuccess: (list) => client.setQueryData(key, list),
    onError: (error, _input, context) => {
      if (
        context?.before &&
        !hasErrorCode(error, "WHOLESALE_CATEGORY_ORDER_INVALID")
      ) {
        client.setQueryData(key, context.before);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * The new order of the products of a category. The API answers the whole
 * list in its new order, which replaces what the page shows.
 */
export function useReorderWholesaleCategoryProducts(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (orderedIds: Id[]) =>
      (await api.wholesaleCategories.reorderProducts(id, orderedIds)).items,
    onSuccess: (items) => {
      client.setQueryData(queryKeys.wholesale.categoryProducts(id), items);
    },
    meta: META,
  });
}

/** Uploads or replaces the picture; `id` for a category created a moment ago. */
export function usePutWholesaleCategoryImage(id: Id) {
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
      (
        await api.wholesaleCategories.putImage(
          other ?? id,
          file,
          onProgress,
          signal,
        )
      ).category,
    onSuccess: (category) => keepCategory(client, category),
    meta: META,
  });
}

export function usePatchWholesaleCategoryImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id: other,
      ...alt
    }: TranslatedOptional & { id?: Id }) =>
      (await api.wholesaleCategories.patchImage(other ?? id, alt)).category,
    onSuccess: (category) => keepCategory(client, category),
    meta: META,
  });
}

export function useRemoveWholesaleCategoryImage(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () =>
      (await api.wholesaleCategories.removeImage(id)).category,
    onSuccess: (category) => keepCategory(client, category),
    meta: META,
  });
}

// --- Products ---------------------------------------------------------------------

/** The answer of a change is the product as it is now: the page shows it at once. */
function keepProduct(
  client: QueryClient,
  product: WholesaleProductDetail,
): void {
  client.setQueryData(queryKeys.wholesale.product(product.id), product);
}

export interface CreateWithImagesInput {
  input: WholesaleProductInput;
  /** The pictures chosen before the product existed; uploaded right after. */
  files: File[];
  onProgress?: (fraction: number) => void;
}

export interface CreateWithImagesResult {
  product: WholesaleProductDetail;
  /** `null` when every picture is stored; what the API said otherwise. */
  upload: unknown;
}

/**
 * Creates a product, then uploads its pictures: the API takes pictures only
 * for a product that exists, so they are two requests. A refused upload
 * does not undo the creation.
 */
export function useCreateWholesaleProduct() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      input,
      files,
      onProgress,
    }: CreateWithImagesInput): Promise<CreateWithImagesResult> => {
      const created = (await api.wholesaleProducts.create(input)).product;
      if (files.length === 0) return { product: created, upload: null };
      try {
        const withImages = (
          await api.wholesaleProducts.uploadImages(
            created.id,
            files,
            onProgress,
          )
        ).product;
        return { product: withImages, upload: null };
      } catch (error) {
        return { product: created, upload: error };
      }
    },
    onSuccess: ({ product }) => keepProduct(client, product),
    meta: META,
  });
}

/** A one-time copy of a retail product with the cartons given (section 6). */
export function useCopyFromRetail() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: WholesaleFromRetailInput) =>
      (await api.wholesaleProducts.fromRetail(input)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: META,
  });
}

export function useUpdateWholesaleProduct(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Parameters<typeof api.wholesaleProducts.update>[1],
    ) => (await api.wholesaleProducts.update(id, input)).product,
    onSuccess: (product) => keepProduct(client, product),
    meta: META,
  });
}

export function useDeleteWholesaleProduct() {
  return useMutation({
    mutationFn: (id: Id) => api.wholesaleProducts.remove(id),
    meta: META,
  });
}

/** Sets or adjusts the cartons on hand of a SKU through the ledger (section 8). */
export function useSetWholesaleStock(id: Id, skuId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: WholesaleStockChangeInput) =>
      api.wholesaleProducts.setStock(id, skuId, input),
    onSuccess: ({ product }) => keepProduct(client, product),
    meta: META,
  });
}

/** One request of saving a product: the product itself, or one of its SKUs. */
export interface SaveStep {
  kind: "product" | "remove" | "change" | "add";
  /** "the product details", "5 kg × 4", "a new SKU". */
  label: string;
  /** The SKU of a `remove` or `change` step. */
  skuId?: Id;
  /** The row of the form of an `add` step. */
  row?: number;
}

export interface SaveReport {
  product: WholesaleProductDetail;
  done: SaveStep[];
  failed: { step: SaveStep; error: unknown } | null;
  pending: SaveStep[];
}

/**
 * Saves an existing product: the product fields in one request, then every
 * SKU that is removed, changed or added in a request of its own. The
 * sequence stops at the first refusal; what went through stays saved.
 */
export function useSaveWholesaleProduct(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({
      product,
      plan,
    }: {
      product: WholesaleProductDetail;
      plan: ProductPlan;
    }): Promise<SaveReport> => {
      const steps: {
        step: SaveStep;
        run: () => Promise<WholesaleProductDetail>;
      }[] = [];
      if (Object.keys(plan.patch).length > 0) {
        steps.push({
          step: { kind: "product", label: "the product details" },
          run: async () =>
            (await api.wholesaleProducts.update(id, plan.patch)).product,
        });
      }
      for (const sku of plan.remove) {
        steps.push({
          step: { kind: "remove", label: sku.carton.label, skuId: sku.id },
          run: async () =>
            (await api.wholesaleProducts.removeSku(id, sku.id)).product,
        });
      }
      for (const { sku, patch } of plan.change) {
        steps.push({
          step: { kind: "change", label: sku.carton.label, skuId: sku.id },
          run: async () =>
            (await api.wholesaleProducts.updateSku(id, sku.id, patch)).product,
        });
      }
      for (const { row, label, input } of plan.add) {
        steps.push({
          step: { kind: "add", label, row },
          run: async () =>
            (await api.wholesaleProducts.addSku(id, input)).product,
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
    meta: META,
  });
}

type ProductPage = PageResult<WholesaleProductSummary>;

/** The "available" switch of the list: answers at once, steps back if the API refuses. */
export function useSetWholesaleAvailable() {
  const client = useQueryClient();
  const lists = [...queryKeys.wholesale.all, "products"] as const;
  return useMutation({
    mutationFn: async ({ id, isAvailable }: { id: Id; isAvailable: boolean }) =>
      (await api.wholesaleProducts.update(id, { isAvailable })).product,
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
      void client.invalidateQueries({ queryKey: queryKeys.wholesale.all });
    },
  });
}

/** The pictures of a wholesale product (section 5), for the shared picture manager. */
export function wholesaleImages(id: Id): ImageTarget<WholesaleProductDetail> {
  return {
    id,
    endpoints: api.wholesaleProducts,
    detailKey: queryKeys.wholesale.product(id),
    invalidates: invalidation.wholesale,
    notFound: "WHOLESALE_PRODUCT_NOT_FOUND",
    permission: "wholesale.manage",
    site: "the wholesale site",
  };
}
