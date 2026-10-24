"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { AnalyticsProductSort, AnalyticsQuery } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

// The six endpoints of the Analytics tab (21), each loaded on its own and
// in parallel. The API caches nothing; the panel keeps an answer for a
// minute per range, so switching sections and back asks nothing twice.
const KEEP_FOR = 60_000;

function useAnalytics<T>(
  part: string,
  query: AnalyticsQuery & Record<string, unknown>,
  fetcher: (signal?: AbortSignal) => Promise<T>,
  enabled: boolean,
) {
  const can = useCan();
  return useQuery<T>({
    queryKey: queryKeys.analytics.part(part, query),
    queryFn: ({ signal }) => fetcher(signal),
    enabled: enabled && can("analytics.read"),
    staleTime: KEEP_FOR,
    // The old figures stay, dimmed, while the new period loads.
    placeholderData: keepPreviousData,
  });
}

const plain = (query: AnalyticsQuery) => ({ ...query });

export function useAnalyticsSummary(query: AnalyticsQuery, enabled = true) {
  return useAnalytics(
    "summary",
    plain(query),
    (signal) => api.analytics.summary(query, signal),
    enabled,
  );
}

export function useAnalyticsSales(query: AnalyticsQuery, enabled = true) {
  return useAnalytics(
    "sales",
    plain(query),
    (signal) => api.analytics.sales(query, signal),
    enabled,
  );
}

export function useAnalyticsProducts(
  query: AnalyticsQuery,
  sortBy: AnalyticsProductSort,
  enabled = true,
) {
  const full = { ...query, sortBy };
  return useAnalytics(
    "products",
    full,
    (signal) => api.analytics.products(full, signal),
    enabled,
  );
}

export function useAnalyticsCustomers(query: AnalyticsQuery, enabled = true) {
  return useAnalytics(
    "customers",
    plain(query),
    (signal) => api.analytics.customers(query, signal),
    enabled,
  );
}

export function useAnalyticsPayments(query: AnalyticsQuery, enabled = true) {
  return useAnalytics(
    "payments",
    plain(query),
    (signal) => api.analytics.payments(query, signal),
    enabled,
  );
}

export function useAnalyticsInventory(query: AnalyticsQuery, enabled = true) {
  return useAnalytics(
    "inventory",
    plain(query),
    (signal) => api.analytics.inventory(query, signal),
    enabled,
  );
}
