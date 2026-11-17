// Section 33: the Fulfilment & Returns tracker (doc/FULFILMENT_RETURNS.md).
// Reading needs `orders.read`, adjusting `orders.manage`.

import type { Query } from "../http";
import type { SessionTransport } from "../session";
import type {
  FulfilmentAdjustment,
  FulfilmentAdjustmentInput,
  FulfilmentAdjustmentQuery,
  FulfilmentAdjustmentResult,
  FulfilmentBrands,
  FulfilmentExport,
  FulfilmentExportQuery,
  FulfilmentFilters,
  FulfilmentOrdersQuery,
  FulfilmentReport,
  FulfilmentReportQuery,
  FulfilmentVariantDetail,
  Id,
  PageResult,
} from "../types";

export function fulfilmentApi({ request }: SessionTransport) {
  const base = "/v1/admin/fulfilment-tracker";
  return {
    /** The report: the totals of every row under the filters, and a page of rows. */
    report: (query: FulfilmentReportQuery = {}, signal?: AbortSignal) =>
      request<FulfilmentReport>(base, { query: query as Query, signal }),
    /** The brands under the same filters; the brand filter itself is ignored. */
    brands: (filters: FulfilmentFilters = {}, signal?: AbortSignal) =>
      request<FulfilmentBrands>(`${base}/brands`, {
        query: filters as Query,
        signal,
      }),
    /** The orders and returns behind one row (`404 PRODUCT_VARIANT_NOT_FOUND`). */
    variant: (
      variantId: Id,
      query: FulfilmentOrdersQuery = {},
      signal?: AbortSignal,
    ) =>
      request<FulfilmentVariantDetail>(`${base}/variants/${variantId}`, {
        query: query as Query,
        signal,
      }),
    /** Every row under the filters with the chosen columns; the panel writes the file. */
    export: (
      { columns, ...filters }: FulfilmentExportQuery = {},
      signal?: AbortSignal,
    ) =>
      request<FulfilmentExport>(`${base}/export`, {
        query: {
          ...filters,
          columns: columns?.length ? columns.join(",") : undefined,
        } as Query,
        signal,
      }),
    /** The history of the adjustments, newest first. */
    adjustments: (
      query: FulfilmentAdjustmentQuery = {},
      signal?: AbortSignal,
    ) =>
      request<PageResult<FulfilmentAdjustment>>(`${base}/adjustments`, {
        query: query as Query,
        signal,
      }),
    /** Adds units to, or takes units from, a figure (`409 FULFILMENT_ADJUSTMENT_INVALID`). */
    adjust: (input: FulfilmentAdjustmentInput) =>
      request<FulfilmentAdjustmentResult>(`${base}/adjustments`, {
        method: "POST",
        body: input,
      }),
  };
}
