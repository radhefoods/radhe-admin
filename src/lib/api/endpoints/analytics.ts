// Section 21: analytics, the second tab of the start page. Reads only.

import type { SessionTransport } from "../session";
import type {
  AnalyticsCustomers,
  AnalyticsInventory,
  AnalyticsPayments,
  AnalyticsProducts,
  AnalyticsProductSort,
  AnalyticsQuery,
  AnalyticsSales,
  AnalyticsSummary,
} from "../types";
import type { Query } from "../http";

export function analyticsApi({ request }: SessionTransport) {
  const base = "/v1/admin/analytics";
  const call = <T>(
    part: string,
    query: AnalyticsQuery & { limit?: number; sortBy?: AnalyticsProductSort },
    signal?: AbortSignal,
  ) => request<T>(`${base}/${part}`, { query: query as Query, signal });
  return {
    /** The KPI tiles. */
    summary: (query: AnalyticsQuery, signal?: AbortSignal) =>
      call<AnalyticsSummary>("summary", query, signal),
    /** The main chart: one point per bucket, for the period and the previous one. */
    sales: (query: AnalyticsQuery, signal?: AbortSignal) =>
      call<AnalyticsSales>("sales", query, signal),
    /** Best sellers and the sales by category. `limit` up to 50. */
    products: (
      query: AnalyticsQuery & { limit?: number; sortBy?: AnalyticsProductSort },
      signal?: AbortSignal,
    ) => call<AnalyticsProducts>("products", query, signal),
    customers: (
      query: AnalyticsQuery & { limit?: number },
      signal?: AbortSignal,
    ) => call<AnalyticsCustomers>("customers", query, signal),
    payments: (query: AnalyticsQuery, signal?: AbortSignal) =>
      call<AnalyticsPayments>("payments", query, signal),
    inventory: (
      query: AnalyticsQuery & { limit?: number },
      signal?: AbortSignal,
    ) => call<AnalyticsInventory>("inventory", query, signal),
  };
}
