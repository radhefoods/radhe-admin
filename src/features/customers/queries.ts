"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
} from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type { CustomerQuery, CustomerStatusInput, Id } from "@/lib/api/types";
import { useCan } from "@/lib/auth/auth-provider";

/** How many customers one request brings (the API allows 1 to 100). */
const PAGE_SIZE = 50;
/** How many of a customer's orders the customer page shows. */
export const NEWEST_ORDERS = 5;

/**
 * Customers, newest first. The API pages them by cursor and gives no total
 * (0.8): the list grows with "load more".
 */
export type CustomerFilters = Pick<
  CustomerQuery,
  "status" | "email" | "q" | "sort"
>;

export function useCustomers(filters: CustomerFilters) {
  const query: CustomerQuery = { ...filters, limit: PAGE_SIZE };
  return useInfiniteQuery({
    queryKey: [...queryKeys.customers.list(query), "pages"] as const,
    queryFn: ({ pageParam, signal }) =>
      api.customers.list({ ...query, cursor: pageParam }, signal),
    initialPageParam: undefined as Id | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
}

/** How many customers the filters match (`GET /customers/count`, 0.8). */
export function useCustomerCount(filters: Omit<CustomerFilters, "sort">) {
  return useQuery({
    queryKey: queryKeys.customers.count(filters),
    queryFn: ({ signal }) => api.customers.count(filters, signal),
    placeholderData: keepPreviousData,
  });
}

export function useCustomer(id: Id) {
  return useQuery({
    queryKey: queryKeys.customers.detail(id),
    queryFn: async ({ signal }) =>
      (await api.customers.get(id, signal)).customer,
  });
}

/** The customer's newest orders, for the customer page. */
export function useCustomerOrders(customerId: Id) {
  const can = useCan();
  const query = { customerId, limit: NEWEST_ORDERS };
  return useQuery({
    queryKey: [...queryKeys.orders.list(query), "newest"] as const,
    queryFn: ({ signal }) => api.orders.list(query, signal),
    enabled: can("orders.read"),
  });
}

/** Blocks or unblocks the account. The dialog shows what the API refuses. */
export function useSetCustomerStatus(id: Id) {
  return useMutation({
    mutationFn: async (input: CustomerStatusInput) =>
      (await api.customers.setStatus(id, input)).customer,
    meta: { invalidates: [queryKeys.customers.all], silent: true },
  });
}
