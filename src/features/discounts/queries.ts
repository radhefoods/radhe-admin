"use client";

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type {
  DiscountCode,
  DiscountInput,
  DiscountPatch,
  DiscountQuery,
  Id,
  PageQuery,
  PageResult,
} from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

// Discount codes (26): every read and every change, each change loading
// the list and the page again. Orders keep what they were made with, so
// nothing of theirs is touched.

const META = { invalidates: invalidation.discount, silent: true } as const;

export function useDiscounts(query: DiscountQuery) {
  const can = useCan();
  return useQuery({
    queryKey: queryKeys.discounts.list(query),
    queryFn: ({ signal }) => api.discounts.list(query, signal),
    placeholderData: keepPreviousData,
    enabled: can("discounts.read"),
  });
}

/** One code. `enabled: false` keeps what is loaded: a code being deleted is not asked for again. */
export function useDiscount(id: Id, enabled = true) {
  return useQuery({
    queryKey: queryKeys.discounts.detail(id),
    queryFn: async ({ signal }) =>
      (await api.discounts.get(id, signal)).discount,
    enabled,
  });
}

/** The orders made with a code, newest first, by page. */
export function useDiscountUses(id: Id, query: PageQuery, enabled = true) {
  return useQuery({
    queryKey: queryKeys.discounts.uses(id, query),
    queryFn: ({ signal }) => api.discounts.uses(id, query, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** The answer of a change is the code as it is now: the page and the lists show it at once. */
function keepDiscount(client: QueryClient, code: DiscountCode): void {
  client.setQueryData(queryKeys.discounts.detail(code.id), code);
  client.setQueriesData<PageResult<DiscountCode>>(
    { queryKey: ["discounts", "list"] },
    (list) =>
      list
        ? {
            ...list,
            items: list.items.map((entry) =>
              entry.id === code.id ? code : entry,
            ),
          }
        : list,
  );
}

export function useCreateDiscount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: DiscountInput) =>
      (await api.discounts.create(input)).discount,
    onSuccess: (code) => keepDiscount(client, code),
    meta: META,
  });
}

/** Any field; the switch of the list sends `isActive` alone. */
export function useUpdateDiscount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...input }: DiscountPatch & { id: Id }) =>
      (await api.discounts.update(id, input)).discount,
    onSuccess: (code) => keepDiscount(client, code),
    meta: META,
  });
}

export function useDeleteDiscount() {
  return useMutation({
    mutationFn: (id: Id) => api.discounts.remove(id),
    meta: META,
  });
}
