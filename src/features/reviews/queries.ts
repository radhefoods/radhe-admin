"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { invalidation, queryKeys } from "@/lib/api/query-keys";
import type { Id, Review, ReviewQuery } from "@/lib/api/types";

/** How many reviews one request brings (the API allows 1 to 100). */
const PAGE_SIZE = 25;

export type ReviewFilters = Omit<ReviewQuery, "limit" | "cursor">;

/** Reviews, newest first, by cursor without a total (0.8): "load more". */
export function useReviews(filters: ReviewFilters, enabled = true) {
  const query: ReviewQuery = { ...filters, limit: PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: [...queryKeys.reviews.list(query), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      api.reviews.list({ ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** How many reviews the filters match (`GET /reviews/count`). */
export function useReviewCount(
  filters: Omit<ReviewFilters, "sort">,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.reviews.count(filters),
    queryFn: ({ signal }) => api.reviews.count(filters, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * The review of one order, for the box on the order page (28): one per
 * order, so the first item is the review. Needs `reviews.read`.
 */
export function useOrderReview(orderNumber: string, enabled = true) {
  const query: ReviewQuery = { orderNumber };
  return useQuery({
    queryKey: queryKeys.reviews.list(query),
    queryFn: async ({ signal }) =>
      (await api.reviews.list(query, signal)).items[0] ?? null,
    enabled,
  });
}

export function useReview(id: Id) {
  return useQuery({
    queryKey: queryKeys.reviews.detail(id),
    queryFn: async ({ signal }) => (await api.reviews.get(id, signal)).review,
  });
}

/**
 * Everything the admin does to one review (28). Each answer carries the
 * review as it is now: it replaces the page's copy at once, the lists and
 * the start page follow.
 */
export function useReviewActions(id: Id) {
  const client = useQueryClient();
  const keep = (answer: { review: Review }) => {
    client.setQueryData(queryKeys.reviews.detail(id), answer.review);
    return answer.review;
  };
  const meta = { invalidates: invalidation.review, silent: true } as const;
  return {
    approve: useMutation({
      mutationFn: async () => keep(await api.reviews.approve(id)),
      meta,
    }),
    reject: useMutation({
      mutationFn: async (note: string) =>
        keep(await api.reviews.reject(id, { note })),
      meta,
    }),
    reply: useMutation({
      mutationFn: async (text: string) =>
        keep(await api.reviews.reply(id, { text })),
      meta,
    }),
    removeReply: useMutation({
      mutationFn: async () => keep(await api.reviews.removeReply(id)),
      meta,
    }),
    remove: useMutation({
      mutationFn: () => api.reviews.remove(id),
      meta,
    }),
  };
}

export type ReviewActions = ReturnType<typeof useReviewActions>;
