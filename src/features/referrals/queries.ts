"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { Id, ReferralQuery } from "@/lib/api/types";

/** How many referrals one request brings (the API allows 1 to 100). */
const PAGE_SIZE = 50;

export type ReferralFilters = Omit<ReferralQuery, "limit" | "cursor">;

/** Referrals, newest first, by cursor without a total (0.8): "load more". */
export function useReferrals(filters: ReferralFilters, enabled = true) {
  const query: ReferralQuery = { ...filters, limit: PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: [...queryKeys.referrals.list(query), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      api.referrals.list({ ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** How many referrals the filters match (`GET /referrals/count`). */
export function useReferralCount(
  filters: Omit<ReferralFilters, "sort">,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.referrals.count(filters),
    queryFn: ({ signal }) => api.referrals.count(filters, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}
