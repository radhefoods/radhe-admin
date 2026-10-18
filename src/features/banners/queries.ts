"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { hasErrorCode } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import type { Banner, BannerPatch, Id, ListResult } from "@/lib/api/types";

type BannerList = ListResult<Banner>;

/** All banners in display order (20). */
export function useBanners() {
  return useQuery({
    queryKey: queryKeys.banners.list(),
    queryFn: ({ signal }) => api.banners.list(signal),
  });
}

/** The answer of a change is the banner as it is now: the list shows it at once. */
function keepBanner(client: QueryClient, banner: Banner): void {
  client.setQueryData<BannerList>(queryKeys.banners.list(), (list) => {
    if (!list) return list;
    const known = list.items.some((entry) => entry.id === banner.id);
    return {
      ...list,
      items: known
        ? list.items.map((entry) => (entry.id === banner.id ? banner : entry))
        : [...list.items, banner],
    };
  });
}

/** Creates a banner from its picture; it starts switched off and last (20). */
export function useCreateBanner() {
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
    }) => (await api.banners.create(file, onProgress, signal)).banner,
    onSuccess: (banner) => keepBanner(client, banner),
    meta: { invalidates: [queryKeys.banners.all], silent: true },
  });
}

export function useUpdateBanner() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: BannerPatch & { id: Id }) =>
      (await api.banners.update(id, input)).banner,
    onSuccess: (banner) => keepBanner(client, banner),
    meta: { invalidates: [queryKeys.banners.all], silent: true },
  });
}

/** A new picture for a banner; the description stays (20). */
export function useReplaceBannerImage(id: Id) {
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
    }) => (await api.banners.putImage(id, file, onProgress, signal)).banner,
    onSuccess: (banner) => keepBanner(client, banner),
    meta: { invalidates: [queryKeys.banners.all], silent: true },
  });
}

/**
 * The new order of all banners. The API wants every banner exactly once;
 * the list follows at once and is loaded again afterwards.
 */
export function useReorderBanners() {
  const client = useQueryClient();
  const key = queryKeys.banners.list();
  return useMutation({
    mutationFn: (orderedIds: Id[]) => api.banners.reorder({ orderedIds }),
    onMutate: async (orderedIds) => {
      await client.cancelQueries({ queryKey: key });
      const before = client.getQueryData<BannerList>(key);
      if (before) {
        const byId = new Map(before.items.map((entry) => [entry.id, entry]));
        client.setQueryData<BannerList>(key, {
          ...before,
          items: orderedIds
            .map((id, index) => {
              const entry = byId.get(id);
              return entry ? { ...entry, sortOrder: index } : null;
            })
            .filter((entry): entry is Banner => entry !== null),
        });
      }
      return { before };
    },
    onError: (error, _input, context) => {
      // The order the API has is the truth; the stale list is not put back
      // when the API said that it changed.
      if (context?.before && !hasErrorCode(error, "BANNER_ORDER_INVALID")) {
        client.setQueryData(key, context.before);
      }
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: queryKeys.banners.all });
    },
  });
}

export function useDeleteBanner() {
  return useMutation({
    mutationFn: (id: Id) => api.banners.remove(id),
    meta: { invalidates: [queryKeys.banners.all], silent: true },
  });
}
