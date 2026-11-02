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
import type {
  Id,
  RewardAccountDetail,
  RewardAccountQuery,
  RewardAdjustInput,
  RewardTransactionQuery,
  RewardsSettings,
} from "@/lib/api/types";

/** How many rows one request brings (the API allows 1 to 100). */
const PAGE_SIZE = 50;

export function useRewardsSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.rewards.settings,
    queryFn: async ({ signal }) =>
      (await api.rewards.getSettings(signal)).settings,
    enabled,
  });
}

/** `PUT` replaces the whole document; the answer is what the API keeps. */
export function useSaveRewardsSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (settings: RewardsSettings) =>
      (await api.rewards.putSettings(settings)).settings,
    onSuccess: (settings) => {
      client.setQueryData(queryKeys.rewards.settings, settings);
    },
    meta: { invalidates: [queryKeys.rewards.summary], silent: true },
  });
}

export function useRewardsSummary() {
  return useQuery({
    queryKey: queryKeys.rewards.summary,
    queryFn: ({ signal }) => api.rewards.summary(signal),
  });
}

export type RewardAccountFilters = Omit<RewardAccountQuery, "limit" | "cursor">;

/** The accounts, by cursor without a total (0.8): "load more". */
export function useRewardAccounts(filters: RewardAccountFilters) {
  const query: RewardAccountQuery = { ...filters, limit: PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: [...queryKeys.rewards.accounts(query), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      api.rewards.accounts({ ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** One customer's account with its latest rows (`404 CUSTOMER_NOT_FOUND`). */
export function useRewardAccount(customerId: Id, enabled = true) {
  return useQuery({
    queryKey: queryKeys.rewards.account(customerId),
    queryFn: ({ signal }) => api.rewards.account(customerId, signal),
    enabled,
  });
}

/**
 * Coins added or taken by hand. The answer carries the account as it is
 * now; the rows of the account are loaded again with the lists.
 */
export function useAdjustCoins(customerId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: RewardAdjustInput) =>
      api.rewards.adjust(customerId, input),
    onSuccess: (result) => {
      client.setQueryData<RewardAccountDetail>(
        queryKeys.rewards.account(customerId),
        (current) =>
          current
            ? {
                account: result.account,
                transactions: [result.transaction, ...current.transactions],
              }
            : current,
      );
    },
    meta: { invalidates: invalidation.rewards, silent: true },
  });
}

export type RewardTransactionFilters = Omit<
  RewardTransactionQuery,
  "limit" | "cursor"
>;

/** The ledger, newest first, by cursor: "load more". */
export function useRewardTransactions(
  filters: RewardTransactionFilters,
  enabled = true,
) {
  const query: RewardTransactionQuery = { ...filters, limit: PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: [...queryKeys.rewards.transactions(query), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      api.rewards.transactions({ ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRewardTransactionCount(
  filters: Omit<RewardTransactionFilters, "sort">,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.rewards.transactionCount(filters),
    queryFn: ({ signal }) => api.rewards.transactionCount(filters, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}
