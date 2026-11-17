"use client";

import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/query-keys";
import type {
  FulfilmentAdjustmentInput,
  FulfilmentFilters,
  FulfilmentOrdersQuery,
  FulfilmentReportQuery,
  Id,
} from "@/lib/api/types";
import { PAGE_SIZE } from "./fulfilment";

/** The report: the totals of every row under the filters and one page of rows. */
export function useFulfilmentReport(
  query: FulfilmentReportQuery,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.fulfilment.report(query),
    queryFn: ({ signal }) => api.fulfilment.report(query, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** The brands under the same dates and search, for the brand filter. */
export function useFulfilmentBrands(
  filters: FulfilmentFilters,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.fulfilment.brands(filters),
    queryFn: ({ signal }) => api.fulfilment.brands(filters, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** The orders and returns behind one row (`404 PRODUCT_VARIANT_NOT_FOUND`). */
export function useFulfilmentVariant(
  variantId: Id,
  query: FulfilmentOrdersQuery,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.fulfilment.variant(variantId, query),
    queryFn: ({ signal }) => api.fulfilment.variant(variantId, query, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * The figures of one pack size over all dates: what an adjustment is
 * checked against. A pack size nothing ever happened to has no row, which
 * reads as zeros.
 */
export function useFulfilmentFigures(variantId: Id, enabled = true) {
  const query: FulfilmentReportQuery = { variantId, limit: 1 };
  return useQuery({
    // "figures": the same call as a page of the report, kept as three numbers.
    queryKey: [...queryKeys.fulfilment.report(query), "figures"] as const,
    queryFn: async ({ signal }) => {
      const report = await api.fulfilment.report(query, signal);
      const row = report.items[0];
      return {
        dispatched: row?.dispatched ?? 0,
        returned: row?.returned ?? 0,
        net: row?.net ?? 0,
      };
    },
    enabled,
  });
}

/** The adjustments made by hand, newest first: of one pack size, or of all. */
export function useFulfilmentAdjustments(
  query: { variantId?: Id; page: number },
  enabled = true,
) {
  const full = { ...query, limit: PAGE_SIZE };
  return useQuery({
    queryKey: queryKeys.fulfilment.adjustments(full),
    queryFn: ({ signal }) => api.fulfilment.adjustments(full, signal),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/**
 * An adjustment by hand. It changes the report only, so the report, the
 * brands, an open dialog and the history are read again, and nothing else.
 * The form shows the error itself.
 */
export function useAdjustFulfilment() {
  return useMutation({
    mutationFn: (input: FulfilmentAdjustmentInput) =>
      api.fulfilment.adjust(input),
    meta: { invalidates: [queryKeys.fulfilment.all], silent: true },
  });
}
